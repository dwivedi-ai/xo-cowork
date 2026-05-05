"""
Vercel connector — OAuth 2.1 with PKCE (no env vars).

Uses Vercel's dynamic client registration + PKCE flow:
  1. Register a client dynamically (cached in mcp-tokens.json, re-registered
     when the desired redirect URI changes)
  2. Generate PKCE code_verifier + S256 challenge
  3. Send the user to Vercel's authorization endpoint
  4. Receive callback with auth code via either:
       (a) the workspace's public Coder URL (BRIDGE_PUBLIC_URL set) →
           handled by routes/vercel.py:vercel_oauth_callback, OR
       (b) a local 127.0.0.1 HTTP server (laptop fallback when no public URL)
  5. Exchange code for access_token + refresh_token
  6. Store tokens in mcp-tokens.json

No client_secret needed. No environment variables required when running
inside a Coder workspace (we read VSCODE_PROXY_URI for the public URL).
"""

import asyncio
import base64
import hashlib
import json
import logging
import os
import secrets
import time
import uuid
import webbrowser
from dataclasses import dataclass, field
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from threading import Thread
from typing import Any, Literal
from urllib.parse import urlencode, urlparse, parse_qs

import httpx

from config import BRIDGE_PUBLIC_URL

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths & URLs
# ---------------------------------------------------------------------------

_PROJECT_ROOT = Path(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TOKEN_FILE = _PROJECT_ROOT / "mcp-tokens.json"

VERCEL_AUTHORIZE_URL = "https://vercel.com/oauth/authorize"
VERCEL_TOKEN_URL = "https://vercel.com/api/login/oauth/token"
VERCEL_REGISTER_URL = "https://vercel.com/api/login/oauth/register"
VERCEL_REVOKE_URL = "https://vercel.com/api/login/oauth/token/revoke"
VERCEL_USER_URL = "https://api.vercel.com/v2/user"

SESSION_TTL = 600   # 10 min
OAUTH_TIMEOUT = 300  # 5 min

# Fixed callback port so remote dev environments (Coder, Codespaces, etc.)
# can set up a stable port-forward. Override with VERCEL_CALLBACK_PORT.
CALLBACK_PORT = int(os.environ.get("VERCEL_CALLBACK_PORT", "53683"))

# ---------------------------------------------------------------------------
# Token storage (shared with github_connector via mcp-tokens.json)
# ---------------------------------------------------------------------------

def _read_tokens() -> dict[str, Any]:
    if not TOKEN_FILE.exists():
        return {}
    try:
        return json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        log.warning("Could not read %s: %s", TOKEN_FILE, exc)
        return {}


def _write_tokens(data: dict[str, Any]) -> None:
    TOKEN_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def get_vercel_token() -> dict[str, Any] | None:
    """Return the stored Vercel token entry, or None."""
    return _read_tokens().get("vercel") or None


def save_vercel_token(token_data: dict[str, Any]) -> None:
    """Save Vercel OAuth tokens to mcp-tokens.json."""
    data = _read_tokens()
    data["vercel"] = token_data
    _write_tokens(data)
    log.info("Vercel token saved to %s", TOKEN_FILE)


def delete_vercel_token() -> None:
    """Remove the Vercel entry from mcp-tokens.json."""
    data = _read_tokens()
    data.pop("vercel", None)
    # Also remove cached client registration
    data.pop("vercel_client", None)
    _write_tokens(data)
    log.info("Vercel token removed from %s", TOKEN_FILE)


def _get_or_register_client(desired_redirect_uri: str) -> dict[str, Any]:
    """
    Get or create a dynamic OAuth client registration.

    Vercel performs *exact-match* validation of `redirect_uri` against the
    registered `redirect_uris` for non-loopback URIs (loopback URIs use
    port-wildcard matching per RFC 8252). So when the desired redirect URI
    isn't already in the cached registration, we wipe and re-register.
    """
    data = _read_tokens()
    client = data.get("vercel_client") or {}
    cached_uris = set(client.get("redirect_uris") or [])
    if (
        client.get("client_id")
        and (desired_redirect_uri in cached_uris or _is_loopback_wildcard(cached_uris))
    ):
        return client

    if client.get("client_id"):
        log.info(
            "Vercel: cached client redirect_uris=%s does not include %s — re-registering",
            sorted(cached_uris), desired_redirect_uri,
        )

    log.info("Registering new OAuth client with Vercel (redirect_uri=%s)", desired_redirect_uri)
    resp = httpx.post(VERCEL_REGISTER_URL, json={
        "client_name": "xo-cowork",
        "redirect_uris": [desired_redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    }, timeout=15)

    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Client registration failed: {resp.status_code} {resp.text}")

    client = resp.json()
    data["vercel_client"] = client
    _write_tokens(data)
    log.info("Registered Vercel OAuth client: %s", client.get("client_id"))
    return client


def _is_loopback_wildcard(uris: set[str]) -> bool:
    """
    True if the cached registration is the legacy loopback placeholder
    (`http://127.0.0.1:0/callback`) — Vercel's MCP registration treats this
    as port-wildcard, so any 127.0.0.1:<port>/callback is valid.
    """
    return any(u == "http://127.0.0.1:0/callback" for u in uris)


# ---------------------------------------------------------------------------
# PKCE helpers
# ---------------------------------------------------------------------------

def _generate_pkce() -> tuple[str, str]:
    """Generate PKCE code_verifier and code_challenge (S256)."""
    code_verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return code_verifier, code_challenge


# ---------------------------------------------------------------------------
# Callback handlers (public bridge route + legacy local-loopback fallback)
# ---------------------------------------------------------------------------

# Maps OAuth `state` → session_id, populated when a session enters the
# awaiting_oauth phase. Used by both the public bridge route and the legacy
# local HTTP handler to find which VercelSession a callback belongs to.
_state_to_session: dict[str, str] = {}


def render_callback_page(success: bool, message: str = "") -> str:
    """HTML returned to the user's browser after Vercel redirects back."""
    if success:
        return """<!doctype html>
<html><body style="font-family:system-ui;display:flex;align-items:center;
justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fff;">
<div style="text-align:center">
<h1 style="color:#00dc82">&#10003; Connected to Vercel!</h1>
<p style="color:#888">You can close this tab and return to xo-cowork.</p>
<script>setTimeout(() => { try { window.close(); } catch (e) {} }, 1500);</script>
</div></body></html>"""
    safe = (message or "Authorization failed.").replace("<", "&lt;").replace(">", "&gt;")
    return f"""<!doctype html>
<html><body style="font-family:system-ui;display:flex;align-items:center;
justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fff;">
<div style="text-align:center">
<h1 style="color:#ef4444">Authorization Failed</h1>
<p style="color:#888">{safe}</p>
</div></body></html>"""


def deliver_callback(state: str, code: str | None, error: str | None) -> bool:
    """
    Resolve `state` → session and store the callback result on it.
    Returns True if a session was found and updated.
    """
    sid = _state_to_session.get(state)
    if not sid:
        return False
    session = _sessions.get(sid)
    if not session:
        return False
    if error:
        session.oauth_error = error
    elif code:
        session.auth_code = code
    return True


class _CallbackHandler(BaseHTTPRequestHandler):
    """Local 127.0.0.1 OAuth callback (laptop fallback when BRIDGE_PUBLIC_URL is unset)."""

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        state = (params.get("state") or [""])[0]
        code = (params.get("code") or [None])[0]
        err = (params.get("error_description") or params.get("error") or [None])[0]

        if code or err:
            found = deliver_callback(state, code, err)
            self.send_response(200 if (code and found) else 400)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            if not found:
                self.wfile.write(render_callback_page(
                    False, "Session not found or expired."
                ).encode())
            else:
                self.wfile.write(render_callback_page(bool(code), err or "").encode())
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


# ---------------------------------------------------------------------------
# Session model
# ---------------------------------------------------------------------------

SessionStatus = Literal["pending", "awaiting_oauth", "completed", "failed", "cancelled"]


@dataclass
class VercelSession:
    session_id: str
    status: SessionStatus = "pending"
    auth_url: str | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    task: asyncio.Task | None = field(default=None, repr=False)
    # Set by POST /sessions/{id}/submit when user pastes the redirect URL.
    # Only consulted by the laptop-fallback flow; the public-URL flow ignores it.
    verification_input: str | None = None
    # True when the user must manually paste the redirect URL. False when the
    # bridge has a publicly-reachable callback URL (BRIDGE_PUBLIC_URL set), in
    # which case Vercel redirects the user's browser straight back to us.
    needs_manual_code: bool = field(default_factory=lambda: not bool(BRIDGE_PUBLIC_URL))
    # OAuth state token (32 random bytes); also used as the lookup key in
    # `_state_to_session` so an incoming callback can find this session.
    oauth_state: str | None = None
    # Populated by the callback (either via the bridge route or the local
    # _CallbackHandler) when it lands. Drained by _run_oauth_flow's wait loop.
    auth_code: str | None = None
    oauth_error: str | None = None


_sessions: dict[str, VercelSession] = {}


def get_session(session_id: str) -> VercelSession | None:
    return _sessions.get(session_id)


def _active_oauth_session() -> VercelSession | None:
    for s in _sessions.values():
        if s.status == "awaiting_oauth":
            return s
    return None


def _expire_sessions() -> None:
    now = time.time()
    for sid in [k for k, v in _sessions.items() if now - v.created_at > SESSION_TTL]:
        s = _sessions.pop(sid)
        if s.task and not s.task.done():
            s.task.cancel()
        if s.oauth_state:
            _state_to_session.pop(s.oauth_state, None)


# ---------------------------------------------------------------------------
# Token validation
# ---------------------------------------------------------------------------

async def validate_vercel_token(access_token: str) -> dict[str, Any]:
    """Validate a Vercel token by calling /v2/user."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                VERCEL_USER_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )

        if resp.status_code == 200:
            user = resp.json().get("user", resp.json())
            return {
                "valid": True,
                "status": "connected",
                "username": user.get("username", ""),
                "name": user.get("name", ""),
                "email": user.get("email", ""),
                "avatar_url": user.get("avatar") or "",
            }
        elif resp.status_code in (401, 403):
            return {
                "valid": False,
                "status": "needs_auth",
                "error": "Token is invalid or revoked.",
            }
        elif resp.status_code == 404:
            # MCP-scoped OAuth tokens may not have REST API access.
            # Treat 404 as "token works but can't access /v2/user".
            return {
                "valid": True,
                "status": "connected",
                "username": "",
                "name": "",
                "email": "",
                "avatar_url": "",
            }
        else:
            return {
                "valid": False,
                "status": "failed",
                "error": f"Vercel returned HTTP {resp.status_code}.",
            }
    except Exception as exc:
        return {
            "valid": False,
            "status": "failed",
            "error": f"Could not connect to Vercel: {exc}",
        }


async def get_status() -> dict[str, Any]:
    """Compute the current Vercel connector status."""
    entry = get_vercel_token()
    if not entry:
        return {"status": "needs_auth"}

    access_token = entry.get("access_token")
    if not access_token:
        return {"status": "needs_auth"}

    result = await validate_vercel_token(access_token)
    # Merge stored metadata (username, name) if API didn't return them
    if result.get("valid") and not result.get("username"):
        result["username"] = entry.get("username", "")
        result["name"] = entry.get("name", "")
    return result


# ---------------------------------------------------------------------------
# OAuth flow
# ---------------------------------------------------------------------------

async def _run_oauth_flow(session: VercelSession) -> None:
    """
    Run the full OAuth 2.1 + PKCE flow.

    Two callback paths are supported, picked based on BRIDGE_PUBLIC_URL:

      * Public URL set (typical Coder workspace):
        redirect_uri = <BRIDGE_PUBLIC_URL>/api/connectors/vercel/oauth-callback
        Vercel redirects the user's browser straight back to the bridge route
        (auth-walled by Coder, but the user's session cookie passes through).
        No local HTTP server is needed.

      * No public URL (laptop dev):
        redirect_uri = http://127.0.0.1:<CALLBACK_PORT>/callback
        We bind a local HTTPServer on that port; the manual-paste fallback
        delivers the code locally if the browser can't reach it.
    """
    server: HTTPServer | None = None
    state: str | None = None
    redirect_uri: str | None = None
    try:
        # ── 1. Generate PKCE + state ─────────────────────────────────
        code_verifier, code_challenge = _generate_pkce()
        state = secrets.token_urlsafe(32)

        # ── 2. Pick the redirect URI strategy ────────────────────────
        # Try the public URL first if available. If Vercel rejects the
        # registration (its dynamic-client allowlist may not include our
        # workspace's domain), gracefully fall back to local loopback +
        # manual paste — same behavior as a laptop dev environment.
        use_public = bool(BRIDGE_PUBLIC_URL)
        client_info: dict[str, Any] | None = None
        if use_public:
            redirect_uri = f"{BRIDGE_PUBLIC_URL}/api/connectors/vercel/oauth-callback"
            log.info(
                "Vercel %s: trying public callback %s",
                session.session_id, redirect_uri,
            )
            try:
                client_info = _get_or_register_client(redirect_uri)
            except RuntimeError as exc:
                msg = str(exc)
                if "invalid_redirect_uri" in msg or "not approved" in msg:
                    log.warning(
                        "Vercel %s: public redirect URI rejected by Vercel's allowlist; "
                        "falling back to local 127.0.0.1 callback + manual paste.",
                        session.session_id,
                    )
                    # Drop the failed-registration cache so we start clean for loopback
                    data = _read_tokens()
                    data.pop("vercel_client", None)
                    _write_tokens(data)
                    use_public = False
                    client_info = None
                else:
                    raise

        if not use_public:
            server = HTTPServer(("127.0.0.1", CALLBACK_PORT), _CallbackHandler)
            local_port = server.server_address[1]
            redirect_uri = f"http://127.0.0.1:{local_port}/callback"
            server_thread = Thread(target=server.serve_forever, daemon=True)
            server_thread.start()
            log.info(
                "Vercel %s: started local callback server on :%d",
                session.session_id, local_port,
            )
            client_info = _get_or_register_client(redirect_uri)

        client_id = client_info["client_id"]

        # ── 4. Register state→session BEFORE building auth URL ────────
        _state_to_session[state] = session.session_id

        # ── 5. Build authorization URL ───────────────────────────────
        auth_params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "state": state,
        }
        auth_url = f"{VERCEL_AUTHORIZE_URL}?{urlencode(auth_params)}"

        session.auth_url = auth_url
        session.oauth_state = state
        session.needs_manual_code = not use_public  # reflects the path actually chosen
        session.status = "awaiting_oauth"
        log.info(
            "Vercel %s: auth URL ready (public=%s): %s",
            session.session_id, use_public, auth_url[:80],
        )

        # ── 6. Wait for callback (any path: bridge route, local server, or paste) ─
        deadline = time.time() + OAUTH_TIMEOUT
        delivered = False
        while time.time() < deadline:
            if session.status == "cancelled":
                return
            if session.auth_code or session.oauth_error:
                break
            # Laptop-fallback: paste delivers code to our own local server
            if (
                not use_public
                and not delivered
                and session.verification_input
                and server is not None
            ):
                code = session.verification_input
                try:
                    local_port = server.server_address[1]
                    async with httpx.AsyncClient(timeout=15) as http:
                        await http.get(
                            f"http://127.0.0.1:{local_port}/callback",
                            params={"code": code, "state": state},
                        )
                    delivered = True
                    log.info(
                        "Vercel %s: delivered pasted code to local callback",
                        session.session_id,
                    )
                except Exception as exc:
                    log.warning("Vercel %s: delivery failed: %s", session.session_id, exc)
                    session.verification_input = None  # let user retry
            await asyncio.sleep(0.5)
        else:
            session.status = "failed"
            session.error = (
                "Timed out waiting for Vercel sign-in."
                if use_public
                else (
                    "Timed out waiting for paste. Click Cancel and try again."
                    if not delivered
                    else "Timed out after delivering the code."
                )
            )
            return

        if session.oauth_error:
            session.status = "failed"
            session.error = f"Vercel denied access: {session.oauth_error}"
            return

        auth_code = session.auth_code
        log.info("Vercel %s: received auth code", session.session_id)

        # ── 7. Exchange code for tokens ──────────────────────────────
        async with httpx.AsyncClient(timeout=15) as http:
            token_resp = await http.post(
                VERCEL_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "code": auth_code,
                    "redirect_uri": redirect_uri,
                    "client_id": client_id,
                    "code_verifier": code_verifier,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )

        if token_resp.status_code != 200:
            session.status = "failed"
            session.error = f"Token exchange failed: {token_resp.status_code} {token_resp.text}"
            return

        token_data = token_resp.json()
        log.info("Vercel %s: token exchange successful", session.session_id)

        # ── 7. Store token ────────────────────────────────────────────
        access_token = token_data.get("access_token")
        if not access_token:
            session.status = "failed"
            session.error = "No access_token in token response."
            return

        # Try to get user info (may fail with 404 for MCP-scoped tokens)
        username = ""
        display_name = ""
        validation = await validate_vercel_token(access_token)
        if validation.get("valid"):
            username = validation.get("username", "")
            display_name = validation.get("name", "")

        # Save to mcp-tokens.json
        save_vercel_token({
            "access_token": access_token,
            "refresh_token": token_data.get("refresh_token"),
            "expires_at": int(time.time()) + token_data.get("expires_in", 0)
                if token_data.get("expires_in") else 0,
            "token_type": token_data.get("token_type", "Bearer"),
            "scope": token_data.get("scope", ""),
            "username": username,
            "name": display_name,
        })

        session.status = "completed"
        log.info("Vercel %s: connected ✓ (user=%s)", session.session_id, username or "unknown")

    except asyncio.CancelledError:
        session.status = "cancelled"
    except Exception as exc:
        log.exception("Vercel OAuth error in session %s", session.session_id)
        session.status = "failed"
        session.error = str(exc)
    finally:
        if server:
            server.shutdown()
        if state:
            _state_to_session.pop(state, None)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def create_oauth_session() -> VercelSession:
    """Start a new Vercel OAuth flow."""
    _expire_sessions()
    active = _active_oauth_session()
    if active:
        raise RuntimeError("Another Vercel connection is being set up. Please finish or cancel it first.")

    session_id = str(uuid.uuid4())
    session = VercelSession(session_id=session_id)
    _sessions[session_id] = session
    session.task = asyncio.create_task(_run_oauth_flow(session))
    return session


async def cancel_session(session_id: str) -> None:
    session = _sessions.get(session_id)
    if not session:
        return
    session.status = "cancelled"
    if session.task and not session.task.done():
        session.task.cancel()
    if session.oauth_state:
        _state_to_session.pop(session.oauth_state, None)
    _sessions.pop(session_id, None)
