"""
Claude Code → OpenYak Bridge Adapter

Exposes the same API surface as bridge/main.py but drives the `claude` CLI
as a subprocess instead of proxying to OpenClaw.

Architecture:
  Frontend (Next.js 15) ←→ Claude Adapter (FastAPI, :8001) ←→ claude CLI subprocess

Run:
  cd bridge
  uv run uvicorn claude_adapter:app --host 0.0.0.0 --port 8001 --reload

Environment variables:
  CLAUDE_BIN              Path to claude binary (default: auto-detected from PATH)
  CLAUDE_DEFAULT_MODEL    Default Claude model ID (default: claude-sonnet-4-6)
  CLAUDE_PERMISSION_MODE  Permission mode: auto | dontAsk | default (default: auto)
  CLAUDE_CWD              Default working directory for Claude (default: ~)
  CORS_ORIGINS            Comma-separated allowed origins
"""

import asyncio
import json
import mimetypes
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="Claude Code Adapter")

# ── Config ───────────────────────────────────────────────────────────────────

CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Accept-Language"],
)

# Path to the `claude` binary
CLAUDE_BIN: str = os.getenv("CLAUDE_BIN", "") or shutil.which("claude") or "claude"

CLAUDE_DEFAULT_MODEL: str = os.getenv("CLAUDE_DEFAULT_MODEL", "claude-sonnet-4-6")
CLAUDE_PERMISSION_MODE: str = os.getenv("CLAUDE_PERMISSION_MODE", "auto")
CLAUDE_CWD: str = os.getenv("CLAUDE_CWD", str(Path.home()))

# Adapter session storage
ADAPTER_DIR = Path.home() / ".claude-adapter"
SESSIONS_FILE = ADAPTER_DIR / "sessions.json"

# Model name → Claude model ID
MODEL_MAP: dict[str, str] = {
    "claude/sonnet": "claude-sonnet-4-6",
    "claude/opus": "claude-opus-4-6",
    "claude/haiku": "claude-haiku-4-5-20251001",
    "claude-sonnet-4-6": "claude-sonnet-4-6",
    "claude-opus-4-6": "claude-opus-4-6",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5-20251001",
}

# In-memory store: stream_id → { session_id, process, claude_session_id, model }
active_streams: dict[str, dict] = {}


# ── Helpers ──────────────────────────────────────────────────────────────────


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def short_id() -> str:
    return uuid.uuid4().hex[:8]


def resolve_model(raw: str | None) -> str:
    if not raw:
        return CLAUDE_DEFAULT_MODEL
    return MODEL_MAP.get(raw, CLAUDE_DEFAULT_MODEL)


def _ensure_adapter_dir() -> None:
    ADAPTER_DIR.mkdir(parents=True, exist_ok=True)


def _load_sessions() -> dict:
    _ensure_adapter_dir()
    if SESSIONS_FILE.exists():
        try:
            return json.loads(SESSIONS_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {"sessions": {}}


def _save_sessions(data: dict) -> None:
    _ensure_adapter_dir()
    SESSIONS_FILE.write_text(json.dumps(data, indent=2))


def _get_session(session_id: str) -> dict | None:
    return _load_sessions()["sessions"].get(session_id)


def _upsert_session(session_id: str, fields: dict) -> dict:
    data = _load_sessions()
    existing = data["sessions"].get(session_id, {})
    existing.update(fields)
    data["sessions"][session_id] = existing
    _save_sessions(data)
    return existing


def _session_to_response(session_id: str, meta: dict) -> dict:
    return {
        "id": session_id,
        "title": meta.get("title") or "New Chat",
        "time_created": meta.get("created_at", iso_now()),
        "time_updated": meta.get("updated_at", iso_now()),
        "agent": "claude",
        "model": meta.get("model", CLAUDE_DEFAULT_MODEL),
        "directory": meta.get("cwd"),
    }


def _path_must_be_under_home(p: str) -> Path:
    resolved = Path(p).expanduser().resolve()
    home = Path.home().resolve()
    if not str(resolved).startswith(str(home)):
        raise ValueError(f"Path {p!r} is outside home directory")
    return resolved


# ── SSE Generator ────────────────────────────────────────────────────────────


async def stream_claude_to_sse(stream_id: str):
    """
    Read NDJSON events from a running `claude` subprocess and translate
    them into OpenYak SSE events.

    Claude stream-json → SSE mapping:
      system init          → (internal: save claude_session_id)
      assistant text       → text-delta
      assistant thinking   → reasoning-delta
      assistant tool_use   → tool-call
      assistant tool_result→ tool-result
      result success       → step-finish + done
      result error         → agent-error
    """
    stream_info = active_streams.get(stream_id)
    if not stream_info:
        yield f"id: 1\nevent: error\ndata: {json.dumps({'error_message': 'Stream not found'})}\n\n"
        return

    session_id = stream_info["session_id"]
    process: asyncio.subprocess.Process = stream_info["process"]
    event_id = 0

    def emit(event: str, data: dict) -> str:
        nonlocal event_id
        event_id += 1
        return f"id: {event_id}\nevent: {event}\ndata: {json.dumps(data)}\n\n"

    try:
        while True:
            line_bytes = await process.stdout.readline()
            if not line_bytes:
                break

            line = line_bytes.decode("utf-8", errors="replace").strip()
            if not line:
                continue

            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue

            etype = event.get("type")

            # ── system init: extract and persist claude session_id ──────────
            if etype == "system" and event.get("subtype") == "init":
                claude_sid = event.get("session_id")
                if claude_sid:
                    stream_info["claude_session_id"] = claude_sid
                    _upsert_session(session_id, {"claude_session_id": claude_sid, "updated_at": iso_now()})
                continue

            # ── assistant message: content blocks ───────────────────────────
            if etype == "assistant":
                message = event.get("message", {})
                content_blocks = message.get("content", [])
                for block in content_blocks:
                    btype = block.get("type")

                    if btype == "text":
                        text = block.get("text", "")
                        if text:
                            yield emit("text-delta", {"session_id": session_id, "text": text})

                    elif btype == "thinking":
                        thinking = block.get("thinking", "")
                        if thinking:
                            yield emit("reasoning-delta", {"session_id": session_id, "text": thinking})

                    elif btype == "tool_use":
                        tool_name = block.get("name", "unknown")
                        call_id = block.get("id", short_id())
                        arguments = block.get("input", {})
                        yield emit("tool-call", {
                            "session_id": session_id,
                            "tool": tool_name,
                            "call_id": call_id,
                            "arguments": arguments,
                            "title": tool_name,
                        })

                    elif btype == "tool_result":
                        call_id = block.get("tool_use_id", short_id())
                        raw_content = block.get("content", "")
                        # content can be a string or a list of blocks
                        if isinstance(raw_content, list):
                            output = "\n".join(
                                c.get("text", "") for c in raw_content if c.get("type") == "text"
                            )
                        else:
                            output = str(raw_content)
                        yield emit("tool-result", {
                            "session_id": session_id,
                            "call_id": call_id,
                            "output": output,
                        })

                continue

            # ── result: final summary ───────────────────────────────────────
            if etype == "result":
                subtype = event.get("subtype")

                if subtype == "success":
                    usage = event.get("usage", {})
                    cost = event.get("total_cost_usd", 0.0) or 0.0
                    stop_reason = event.get("stop_reason", "stop")

                    tokens = {
                        "input": usage.get("input_tokens", 0),
                        "output": usage.get("output_tokens", 0),
                        "cache_read": usage.get("cache_read_input_tokens", 0),
                        "cache_write": usage.get("cache_creation_input_tokens", 0),
                        "reasoning": 0,
                    }

                    yield emit("step-finish", {
                        "session_id": session_id,
                        "reason": stop_reason,
                        "tokens": tokens,
                        "cost": cost,
                    })
                    yield emit("done", {
                        "session_id": session_id,
                        "finish_reason": stop_reason,
                    })

                    # Persist token/cost stats to session metadata
                    _upsert_session(session_id, {
                        "updated_at": iso_now(),
                        "last_cost_usd": cost,
                        "last_tokens": tokens,
                    })

                elif subtype == "error":
                    error_msg = event.get("error", "Claude returned an error")
                    yield emit("agent-error", {
                        "session_id": session_id,
                        "error_message": str(error_msg),
                    })

                break  # result is always the final event

            # ── rate_limit_event: ignore ────────────────────────────────────
            if etype == "rate_limit_event":
                continue

    except Exception as exc:
        yield emit("agent-error", {
            "session_id": session_id,
            "error_message": f"Adapter error: {exc}",
        })
    finally:
        # Clean up if process is still running (e.g. frontend closed the SSE)
        try:
            if process.returncode is None:
                process.kill()
                await process.wait()
        except ProcessLookupError:
            pass
        active_streams.pop(stream_id, None)


# ── Routes ───────────────────────────────────────────────────────────────────


@app.get("/health")
def health():
    return {"status": "ok"}


# ── Sessions ─────────────────────────────────────────────────────────────────


@app.get("/api/sessions")
def list_sessions(limit: int = 50, offset: int = 0):
    data = _load_sessions()
    sessions_map = data.get("sessions", {})
    items = [
        _session_to_response(sid, meta)
        for sid, meta in sessions_map.items()
    ]
    # Sort newest first
    items.sort(key=lambda s: s["time_updated"], reverse=True)
    return items[offset: offset + limit]


@app.get("/api/sessions/search")
def search_sessions(q: str = "", limit: int = 20, offset: int = 0):
    data = _load_sessions()
    sessions_map = data.get("sessions", {})
    q_lower = q.lower()
    results = []
    for sid, meta in sessions_map.items():
        title = (meta.get("title") or "").lower()
        if q_lower in title:
            results.append({
                "session": _session_to_response(sid, meta),
                "snippet": None,
            })
    results.sort(key=lambda r: r["session"]["time_updated"], reverse=True)
    return results[offset: offset + limit]


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):
    meta = _get_session(session_id)
    if not meta:
        return JSONResponse(status_code=404, content={"detail": "Session not found"})
    return _session_to_response(session_id, meta)


@app.post("/api/sessions")
async def create_session():
    # Sessions are created lazily on first chat prompt
    new_id = str(uuid.uuid4())
    return {"id": new_id, "title": "New Chat"}


@app.patch("/api/sessions/{session_id}")
async def update_session(session_id: str, request: Request):
    body = await request.json()
    meta = _get_session(session_id)
    if not meta:
        return JSONResponse(status_code=404, content={"detail": "Session not found"})
    updates: dict = {}
    if "directory" in body:
        updates["cwd"] = body["directory"]
    if "title" in body:
        updates["title"] = body["title"]
    if updates:
        _upsert_session(session_id, updates)
    return {"ok": True, "session_id": session_id, **updates}


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str):
    data = _load_sessions()
    data["sessions"].pop(session_id, None)
    _save_sessions(data)
    return {"ok": True}


# ── Messages ──────────────────────────────────────────────────────────────────


@app.get("/api/messages/{session_id}")
def get_messages(session_id: str, limit: int = 50, offset: int = -1):
    # Claude Code manages its own session history internally.
    # Returning empty here; the frontend re-renders from streaming parts.
    return {"total": 0, "offset": 0, "messages": []}


# ── Chat ──────────────────────────────────────────────────────────────────────


@app.post("/api/chat/prompt")
async def chat_prompt(request: Request):
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        return JSONResponse(status_code=400, content={"detail": "Empty message"})

    session_id = body.get("session_id")
    model = resolve_model(body.get("model"))
    workspace = body.get("workspace") or CLAUDE_CWD

    # Determine if this is a new or existing session
    is_new = not session_id
    if is_new:
        session_id = str(uuid.uuid4())
        title = text[:60].strip()
        _upsert_session(session_id, {
            "created_at": iso_now(),
            "updated_at": iso_now(),
            "title": title,
            "model": model,
            "cwd": workspace,
        })

    meta = _get_session(session_id)
    claude_session_id = meta.get("claude_session_id") if meta else None
    cwd = (meta.get("cwd") if meta else None) or CLAUDE_CWD

    # Build the claude command
    cmd = [
        CLAUDE_BIN,
        "-p", text,
        "--output-format", "stream-json",
        "--verbose",
        "--permission-mode", CLAUDE_PERMISSION_MODE,
        "--model", model,
    ]

    if claude_session_id:
        cmd += ["--resume", claude_session_id]

    # Spawn subprocess
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
    except FileNotFoundError:
        return JSONResponse(
            status_code=500,
            content={"detail": f"Claude binary not found at: {CLAUDE_BIN}"},
        )
    except Exception as exc:
        return JSONResponse(status_code=500, content={"detail": str(exc)})

    stream_id = str(uuid.uuid4())
    active_streams[stream_id] = {
        "session_id": session_id,
        "process": process,
        "claude_session_id": claude_session_id,
        "model": model,
    }

    return {"stream_id": stream_id, "session_id": session_id}


@app.get("/api/chat/stream/{stream_id}")
async def chat_stream(stream_id: str):
    return StreamingResponse(
        stream_claude_to_sse(stream_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/chat/abort")
async def chat_abort(request: Request):
    body = await request.json()
    stream_id = body.get("stream_id", "")
    info = active_streams.pop(stream_id, None)
    if info:
        process: asyncio.subprocess.Process = info.get("process")
        if process and process.returncode is None:
            try:
                process.kill()
                await process.wait()
            except ProcessLookupError:
                pass
    return {"ok": True}


@app.post("/api/chat/respond")
async def chat_respond():
    return {"ok": True}


@app.get("/api/chat/active")
def chat_active():
    return []


# ── Models ────────────────────────────────────────────────────────────────────


@app.get("/api/models")
def list_models():
    return [
        {
            "id": "claude/sonnet",
            "name": "Claude Sonnet 4.6",
            "capabilities": {
                "function_calling": True,
                "vision": True,
                "reasoning": True,
                "json_output": True,
                "max_context": 200000,
                "max_output": 8192,
            },
        },
        {
            "id": "claude/opus",
            "name": "Claude Opus 4.6",
            "capabilities": {
                "function_calling": True,
                "vision": True,
                "reasoning": True,
                "json_output": True,
                "max_context": 200000,
                "max_output": 8192,
            },
        },
        {
            "id": "claude/haiku",
            "name": "Claude Haiku 4.5",
            "capabilities": {
                "function_calling": True,
                "vision": True,
                "reasoning": False,
                "json_output": True,
                "max_context": 200000,
                "max_output": 8192,
            },
        },
    ]


# ── Agents (stub — adapter exposes a single "claude" agent) ───────────────────


@app.get("/api/agents")
def list_agents():
    return [
        {
            "id": "claude",
            "name": "Claude Code",
            "model": CLAUDE_DEFAULT_MODEL,
            "workspace": CLAUDE_CWD,
            "identity": {"name": "Claude", "emoji": "🤖", "bio": "Claude Code agent"},
        }
    ]


@app.post("/api/agents")
async def create_agent():
    return JSONResponse(status_code=501, content={"detail": "Agent creation not supported in Claude adapter"})


@app.get("/api/agents/{agent_id}")
def get_agent(agent_id: str):
    if agent_id != "claude":
        return JSONResponse(status_code=404, content={"detail": "Agent not found"})
    return {
        "id": "claude",
        "name": "Claude Code",
        "model": CLAUDE_DEFAULT_MODEL,
        "workspace": CLAUDE_CWD,
        "identity": {"name": "Claude", "emoji": "🤖", "bio": "Claude Code agent"},
        "sessions": [],
    }


@app.patch("/api/agents/{agent_id}")
async def update_agent():
    return JSONResponse(status_code=501, content={"detail": "Agent update not supported in Claude adapter"})


# ── Config & Status ───────────────────────────────────────────────────────────


@app.get("/api/config/api-key")
def config_api_key():
    return {"has_key": True, "provider": "claude"}


@app.get("/api/config/providers")
def config_providers():
    return []


@app.get("/api/config/openai-subscription")
def config_openai_subscription():
    return {"is_connected": False, "email": "", "needs_reauth": False}


@app.get("/api/config/ollama")
def config_ollama():
    return {"installed": False}


@app.get("/api/config/local")
def config_local():
    return {"available": False}


@app.get("/api/config/openclaw")
def config_openclaw():
    return JSONResponse(status_code=404, content={"detail": "Not using OpenClaw"})


@app.get("/api/channels/openclaw/status")
def openclaw_status():
    return {"installed": False, "running": False, "port": None, "ws_url": None}


@app.get("/api/channels")
def list_channels():
    return []


@app.get("/api/ollama/status")
def ollama_status():
    return {"binary_installed": False, "running": False}


@app.get("/api/codex/status")
def codex_status():
    return {"is_connected": False, "email": ""}


@app.get("/api/openyak-account")
def openyak_account():
    return {"linked": False}


# ── Tools / Skills / Connectors / Automations (stubs) ────────────────────────


@app.get("/api/tools")
def list_tools():
    return []


@app.get("/api/skills")
def list_skills():
    return []


@app.get("/api/connectors")
def list_connectors():
    return []


@app.get("/api/plugins/status")
def plugins_status():
    return {}


@app.get("/api/automations")
def list_automations():
    return []


@app.get("/api/mcp/status")
def mcp_status():
    return []


# ── Session Todos & Files (stubs) ─────────────────────────────────────────────


@app.get("/api/sessions/{session_id}/todos")
def session_todos(session_id: str):
    return {"todos": []}


@app.get("/api/sessions/{session_id}/files")
def session_files(session_id: str):
    return {"files": []}


# ── Workspace Memory (stubs) ──────────────────────────────────────────────────


@app.get("/api/workspace-memory")
def workspace_memory(workspace_path: str = ""):
    return {"memory": None}


@app.get("/api/workspace-memory/list")
def workspace_memory_list():
    return []


@app.put("/api/workspace-memory")
async def workspace_memory_put():
    return {"ok": True}


@app.delete("/api/workspace-memory")
def workspace_memory_delete(workspace_path: str = ""):
    return {"ok": True}


@app.post("/api/workspace-memory/refresh")
async def workspace_memory_refresh(workspace_path: str = ""):
    return {"ok": True}


@app.post("/api/workspace-memory/export")
async def workspace_memory_export(workspace_path: str = ""):
    return {"ok": True}


# ── FTS (stubs) ───────────────────────────────────────────────────────────────


@app.get("/api/fts/index/{workspace:path}")
def fts_index_get(workspace: str, session_id: str = ""):
    return {"status": "idle", "progress": 0}


@app.post("/api/fts/index/{workspace:path}")
async def fts_index_post(workspace: str, session_id: str = ""):
    return {"status": "idle", "progress": 0}


# ── Files ─────────────────────────────────────────────────────────────────────


@app.post("/api/files/upload")
async def upload_file(file: UploadFile = File(...), workspace: str = Form("")):
    import hashlib

    data = await file.read()
    content_hash = hashlib.sha256(data).hexdigest()

    if workspace:
        try:
            dest_dir = _path_must_be_under_home(workspace)
        except ValueError:
            dest_dir = Path.home() / "uploads"
    else:
        dest_dir = Path.home() / "uploads"

    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / (file.filename or f"upload_{short_id()}")

    # Deduplicate by hash
    for existing in dest_dir.iterdir():
        if existing.is_file():
            try:
                if hashlib.sha256(existing.read_bytes()).hexdigest() == content_hash:
                    dest_path = existing
                    break
            except OSError:
                pass
    else:
        dest_path.write_bytes(data)

    mime_type = mimetypes.guess_type(str(dest_path))[0] or "application/octet-stream"

    return {
        "file_id": str(uuid.uuid4()),
        "name": dest_path.name,
        "path": str(dest_path),
        "size": len(data),
        "mime_type": mime_type,
        "source": "uploaded",
        "content_hash": content_hash,
    }


@app.post("/api/files/list-directory")
async def list_directory(request: Request):
    body = await request.json()
    try:
        target = _path_must_be_under_home(body.get("path", str(Path.home())))
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    if not target.is_dir():
        return JSONResponse(status_code=404, content={"detail": "Not a directory"})

    dirs, files = [], []
    try:
        for entry in sorted(target.iterdir(), key=lambda e: e.name.lower()):
            if entry.name.startswith("."):
                continue
            if entry.is_dir():
                dirs.append({"name": entry.name, "path": str(entry)})
            elif entry.is_file():
                files.append({"name": entry.name, "path": str(entry)})
    except PermissionError:
        pass

    parent = str(target.parent) if target != Path.home() else None
    return {"path": str(target), "parent": parent, "dirs": dirs, "files": files}


@app.post("/api/files/content")
async def file_content(request: Request):
    body = await request.json()
    try:
        target = _path_must_be_under_home(body.get("path", ""))
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    if not target.is_file():
        return JSONResponse(status_code=404, content={"detail": "File not found"})

    try:
        content = target.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return JSONResponse(status_code=500, content={"detail": str(exc)})

    return {"content": content, "path": str(target)}


@app.post("/api/files/content-binary")
async def file_content_binary(request: Request):
    body = await request.json()
    try:
        target = _path_must_be_under_home(body.get("path", ""))
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    if not target.is_file():
        return JSONResponse(status_code=404, content={"detail": "File not found"})

    return FileResponse(str(target))


@app.post("/api/files/mkdir")
async def make_directory(request: Request):
    body = await request.json()
    try:
        target = _path_must_be_under_home(body.get("path", ""))
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    target.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []

    if body.get("scaffold"):
        for fname in ["WORKSPACE.md", "AGENTS.md", "OBJECTIVES.md"]:
            fpath = target / fname
            if not fpath.exists():
                fpath.write_text(f"# {fname.replace('.md', '')}\n")
                copied.append(fname)
        sessions_json = target / "sessions.json"
        if not sessions_json.exists():
            sessions_json.write_text("{}")
            copied.append("sessions.json")

    for extra in body.get("files", []):
        ep = target / extra
        if not ep.exists():
            ep.touch()
            copied.append(extra)

    return {"path": str(target), "name": target.name, "copied": copied}


# ── Secrets (stub — Claude Code manages its own auth) ─────────────────────────


@app.get("/api/secrets/env")
def secrets_env():
    return {"entries": []}


@app.put("/api/secrets/env")
async def secrets_env_put():
    return {"ok": True}


# ── Usage ─────────────────────────────────────────────────────────────────────


@app.get("/api/usage")
def usage(days: int = 30):
    # Usage is tracked inside Claude Code's own storage.
    # Returning zeros here; a future version could parse ~/.claude/ JSONL.
    return {
        "total": {"messages": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0},
        "by_day": [],
        "by_model": [],
        "by_session": [],
    }
