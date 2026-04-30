"""
REST routes for the Vercel connector (OAuth 2.1 + PKCE).

Endpoints:
  POST /api/connectors/vercel/connect       — start OAuth flow
  GET  /api/connectors/vercel/sessions/{id}  — poll session status
  POST /api/connectors/vercel/sessions/{id}/cancel — cancel OAuth flow
  POST /api/connectors/vercel/sessions/{id}/submit — paste redirect URL/code (laptop fallback)
  GET  /api/connectors/vercel/oauth-callback — public OAuth redirect target
  GET  /api/connectors/vercel/status         — current connection status
  POST /api/connectors/vercel/disconnect     — delete stored token
  POST /api/connectors/vercel/reconnect      — re-validate stored token
"""

import logging
import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

from vercel_connector import (
    cancel_session,
    create_oauth_session,
    deliver_callback,
    delete_vercel_token,
    get_session,
    get_status,
    get_vercel_token,
    render_callback_page,
    validate_vercel_token,
)

log = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# POST /api/connectors/vercel/connect
# ---------------------------------------------------------------------------

@router.post("/api/connectors/vercel/connect")
async def start_vercel_oauth() -> JSONResponse:
    """Start a new Vercel OAuth flow."""
    try:
        session = await create_oauth_session()
    except RuntimeError as exc:
        raise HTTPException(409, detail=str(exc)) from exc

    return JSONResponse(
        {"session_id": session.session_id, "status": "pending"},
        status_code=202,
    )


# ---------------------------------------------------------------------------
# GET /api/connectors/vercel/sessions/{session_id}
# ---------------------------------------------------------------------------

@router.get("/api/connectors/vercel/sessions/{session_id}")
async def poll_vercel_session(session_id: str) -> JSONResponse:
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, detail="Session not found or expired.")

    payload: dict = {"status": session.status}
    if session.status == "awaiting_oauth" and session.auth_url:
        payload["auth_url"] = session.auth_url
        payload["needs_manual_code"] = session.needs_manual_code
    if session.status == "failed" and session.error:
        payload["error"] = session.error

    return JSONResponse(payload)


# ---------------------------------------------------------------------------
# POST /api/connectors/vercel/sessions/{session_id}/cancel
# ---------------------------------------------------------------------------

@router.post("/api/connectors/vercel/sessions/{session_id}/cancel")
async def cancel_vercel_session(session_id: str) -> JSONResponse:
    await cancel_session(session_id)
    return JSONResponse({"ok": True})


# ---------------------------------------------------------------------------
# POST /api/connectors/vercel/sessions/{session_id}/submit
# Body: {"code": "<paste from URL bar>"}
# ---------------------------------------------------------------------------

class SubmitCodeBody(BaseModel):
    code: str


@router.post("/api/connectors/vercel/sessions/{session_id}/submit")
async def submit_vercel_code(session_id: str, body: SubmitCodeBody) -> JSONResponse:
    """Receive the redirect URL / verification code the user pasted from the browser."""
    session = get_session(session_id)
    if not session:
        raise HTTPException(404, detail="Session not found or expired.")
    if session.status != "awaiting_oauth":
        raise HTTPException(400, detail="Session is not waiting for a verification code.")

    # Accept either the full redirect URL or just the bare code
    code = body.code.strip()
    m = re.search(r"[?&]code=([^&]+)", code)
    if m:
        code = m.group(1)

    session.verification_input = code
    return JSONResponse({"ok": True})


# ---------------------------------------------------------------------------
# GET /api/connectors/vercel/oauth-callback
# Public OAuth redirect target. Vercel sends the user's browser here after
# they sign in; we look up the matching session by `state` and store the
# auth code (or error) on it. The OAuth flow's wait loop drains it from there.
# ---------------------------------------------------------------------------

@router.get("/api/connectors/vercel/oauth-callback")
async def vercel_oauth_callback(request: Request) -> HTMLResponse:
    params = request.query_params
    state = (params.get("state") or "").strip()
    code = params.get("code")
    err = params.get("error_description") or params.get("error")

    if not state or (not code and not err):
        return HTMLResponse(
            render_callback_page(False, "Missing state or code in callback URL."),
            status_code=400,
        )

    found = deliver_callback(state, code, err)
    if not found:
        # Stale/expired session, or callback arrived after a server restart.
        return HTMLResponse(
            render_callback_page(False, "Session not found or expired. Try again from xo-cowork."),
            status_code=410,
        )

    if err:
        return HTMLResponse(render_callback_page(False, err), status_code=400)
    return HTMLResponse(render_callback_page(True), status_code=200)


# ---------------------------------------------------------------------------
# GET /api/connectors/vercel/status
# ---------------------------------------------------------------------------

@router.get("/api/connectors/vercel/status")
async def vercel_status() -> JSONResponse:
    """Return the current Vercel connector status."""
    status = await get_status()
    return JSONResponse(status)


# ---------------------------------------------------------------------------
# POST /api/connectors/vercel/disconnect
# ---------------------------------------------------------------------------

@router.post("/api/connectors/vercel/disconnect")
async def disconnect_vercel() -> JSONResponse:
    delete_vercel_token()
    return JSONResponse({"status": "needs_auth"})


# ---------------------------------------------------------------------------
# POST /api/connectors/vercel/reconnect
# ---------------------------------------------------------------------------

@router.post("/api/connectors/vercel/reconnect")
async def reconnect_vercel() -> JSONResponse:
    """Re-validate the stored token and return the new status."""
    entry = get_vercel_token()
    if not entry:
        return JSONResponse({"status": "needs_auth", "error": "No token stored."})

    access_token = entry.get("access_token")
    if not access_token:
        return JSONResponse({"status": "needs_auth", "error": "No access token found."})

    result = await validate_vercel_token(access_token)
    if result.get("valid"):
        return JSONResponse({
            "status": "connected",
            "username": result.get("username", ""),
            "name": result.get("name", ""),
            "email": result.get("email", ""),
        })
    else:
        return JSONResponse(
            {"status": result["status"], "error": result.get("error", "")},
            status_code=502,
        )
