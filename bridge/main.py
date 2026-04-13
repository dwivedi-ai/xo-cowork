"""
OpenClaw → OpenYak Bridge API Server

Reads OpenClaw's file-based session/message storage (~/.openclaw/agents/*)
and serves it in the format OpenYak's frontend expects.
Proxies chat messages to OpenClaw's OpenAI-compatible API with SSE translation.
"""

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

load_dotenv()

app = FastAPI(title="OpenClaw Bridge")

CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Accept-Language"],
)

OPENCLAW_DIR = Path.home() / ".openclaw"
AGENTS_DIR = OPENCLAW_DIR / "agents"

# OpenClaw API config
OPENCLAW_API_URL = os.getenv("OPENCLAW_API_URL", "http://127.0.0.1:18789/v1/chat/completions")
OPENCLAW_API_KEY = os.getenv("OPENCLAW_API_KEY", "xo-cowork")
OPENCLAW_MODEL = os.getenv("OPENCLAW_MODEL", "openclaw/default")

# In-memory store for pending streams
# stream_id -> { session_id, text }
active_streams: dict[str, dict] = {}


# ── Helpers ──────────────────────────────────────────────────────────────────


def ms_to_iso(ms: int | float) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def short_id() -> str:
    return uuid.uuid4().hex[:8]


def parse_jsonl(path: Path) -> list[dict]:
    lines = []
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if line:
                lines.append(json.loads(line))
    return lines


def derive_title(records: list[dict]) -> str:
    """Extract a title from the first user message text."""
    for r in records:
        if r.get("type") == "message" and r.get("message", {}).get("role") == "user":
            content = r["message"].get("content", [])
            for block in content:
                if block.get("type") == "text":
                    text = block["text"].strip()
                    if text.startswith("Read HEARTBEAT.md"):
                        continue
                    return text[:80] + ("..." if len(text) > 80 else "")
    return "Untitled Session"


# ── Load OpenClaw data ───────────────────────────────────────────────────────


def load_all_sessions() -> list[dict]:
    """Scan all agents and build SessionResponse objects."""
    sessions = []

    if not AGENTS_DIR.exists():
        return sessions

    for agent_dir in sorted(AGENTS_DIR.iterdir()):
        if not agent_dir.is_dir():
            continue

        agent_name = agent_dir.name
        sessions_dir = agent_dir / "sessions"
        sessions_index = sessions_dir / "sessions.json"

        if not sessions_index.exists():
            continue

        with open(sessions_index) as f:
            index_data = json.load(f)

        for key, meta in index_data.items():
            session_id = meta.get("sessionId", "")
            session_file = sessions_dir / f"{session_id}.jsonl"

            updated_at = meta.get("updatedAt")
            time_updated = ms_to_iso(updated_at) if updated_at else iso_now()

            time_created = time_updated
            title = "Untitled Session"
            if session_file.exists():
                records = parse_jsonl(session_file)
                if records:
                    ts = records[0].get("timestamp")
                    if ts:
                        time_created = ts
                title = derive_title(records)

            sessions.append({
                "id": session_id,
                "project_id": None,
                "parent_id": None,
                "slug": None,
                "directory": agent_name,
                "title": title,
                "version": 1,
                "summary_additions": 0,
                "summary_deletions": 0,
                "summary_files": 0,
                "summary_diffs": [],
                "is_pinned": False,
                "permission": {},
                "time_created": time_created,
                "time_updated": time_updated,
                "time_compacting": None,
                "time_archived": None,
            })

    sessions.sort(key=lambda s: s["time_updated"], reverse=True)
    return sessions


def find_session_file(session_id: str) -> Path | None:
    """Find the JSONL file for a given session ID across all agents."""
    if not AGENTS_DIR.exists():
        return None
    for agent_dir in AGENTS_DIR.iterdir():
        if not agent_dir.is_dir():
            continue
        path = agent_dir / "sessions" / f"{session_id}.jsonl"
        if path.exists():
            return path
    return None


def find_session_key(session_id: str) -> str | None:
    """Look up the OpenClaw session key for a given session ID."""
    if not AGENTS_DIR.exists():
        return None
    for agent_dir in AGENTS_DIR.iterdir():
        if not agent_dir.is_dir():
            continue
        index_path = agent_dir / "sessions" / "sessions.json"
        if not index_path.exists():
            continue
        with open(index_path) as f:
            index_data = json.load(f)
        for key, meta in index_data.items():
            if meta.get("sessionId") == session_id:
                return key
    return None


def convert_messages(session_id: str, records: list[dict]) -> list[dict]:
    """Convert OpenClaw JSONL message records to OpenYak MessageResponse format."""
    messages = []

    for record in records:
        if record.get("type") != "message":
            continue

        msg = record.get("message", {})
        role = msg.get("role", "")
        record_id = record.get("id", short_id())
        timestamp = record.get("timestamp", iso_now())

        if role == "toolResult":
            _attach_tool_result(messages, msg)
            continue

        if role == "user":
            parts = _convert_user_parts(record_id, session_id, timestamp, msg)
            messages.append({
                "id": record_id,
                "session_id": session_id,
                "time_created": timestamp,
                "data": {"role": "user"},
                "parts": parts,
            })

        elif role == "assistant":
            parts = _convert_assistant_parts(record_id, session_id, timestamp, msg)
            usage = msg.get("usage", {})
            cost = usage.get("cost", {})
            cost_total = cost.get("total") if isinstance(cost, dict) else cost

            messages.append({
                "id": record_id,
                "session_id": session_id,
                "time_created": timestamp,
                "data": {
                    "role": "assistant",
                    "model_id": msg.get("model"),
                    "provider_id": msg.get("provider"),
                    "cost": cost_total,
                    "tokens": {
                        "input": usage.get("input", 0),
                        "output": usage.get("output", 0),
                        "reasoning": 0,
                        "cache_read": usage.get("cacheRead", 0),
                        "cache_write": usage.get("cacheWrite", 0),
                    } if usage else None,
                    "finish": _map_stop_reason(msg.get("stopReason")),
                    "error": None,
                },
                "parts": parts,
            })

    return messages


def _convert_user_parts(msg_id, session_id, timestamp, msg):
    parts = []
    for block in msg.get("content", []):
        if block.get("type") == "text":
            parts.append({
                "id": f"{msg_id}_p{len(parts)}",
                "message_id": msg_id,
                "session_id": session_id,
                "time_created": timestamp,
                "data": {"type": "text", "text": block["text"]},
            })
    return parts


def _convert_assistant_parts(msg_id, session_id, timestamp, msg):
    parts = []
    for block in msg.get("content", []):
        btype = block.get("type")

        if btype == "text":
            text = block.get("text", "")
            if text.startswith("[["):
                closing = text.find("]]")
                if closing != -1:
                    text = text[closing + 2:].strip()
            parts.append({
                "id": f"{msg_id}_p{len(parts)}",
                "message_id": msg_id,
                "session_id": session_id,
                "time_created": timestamp,
                "data": {"type": "text", "text": text},
            })

        elif btype == "thinking":
            thinking_text = block.get("thinking", "")
            if thinking_text:
                parts.append({
                    "id": f"{msg_id}_p{len(parts)}",
                    "message_id": msg_id,
                    "session_id": session_id,
                    "time_created": timestamp,
                    "data": {"type": "reasoning", "text": thinking_text},
                })

        elif btype == "toolCall":
            parts.append({
                "id": f"{msg_id}_p{len(parts)}",
                "message_id": msg_id,
                "session_id": session_id,
                "time_created": timestamp,
                "data": {
                    "type": "tool",
                    "tool": block.get("name", "unknown"),
                    "call_id": block.get("id", ""),
                    "state": {
                        "status": "completed",
                        "input": block.get("arguments", {}),
                        "output": None,
                        "metadata": None,
                        "title": block.get("name", "tool"),
                        "time_start": timestamp,
                        "time_end": timestamp,
                        "time_compacted": None,
                    },
                },
            })

    return parts


def _attach_tool_result(messages, tool_result_msg):
    tool_call_id = tool_result_msg.get("toolCallId", "")
    result_content = tool_result_msg.get("content", [])
    output_text = ""
    for block in result_content:
        if block.get("type") == "text":
            output_text += block.get("text", "")

    for msg in reversed(messages):
        if msg["data"].get("role") != "assistant":
            continue
        for part in msg["parts"]:
            if (
                part["data"].get("type") == "tool"
                and part["data"].get("call_id") == tool_call_id
            ):
                part["data"]["state"]["output"] = output_text
                if tool_result_msg.get("isError"):
                    part["data"]["state"]["status"] = "error"
                return


def _map_stop_reason(reason):
    mapping = {
        "stop": "stop",
        "toolUse": "tool_use",
        "length": "length",
        "error": "error",
    }
    return mapping.get(reason or "", None)


# ── Chat streaming ───────────────────────────────────────────────────────────


async def stream_openclaw_to_sse(stream_id: str):
    """
    Sends the user message to OpenClaw's OpenAI-compatible API using the
    session key header so OpenClaw continues the existing session.
    Streams the response as OpenYak SSE events (text-delta, done).
    OpenClaw handles persisting messages to its own JSONL files.
    """
    stream_info = active_streams.pop(stream_id, None)
    if not stream_info:
        yield f"id: 1\nevent: error\ndata: {json.dumps({'error_message': 'Stream not found'})}\n\n"
        return

    session_id = stream_info["session_id"]
    text = stream_info["text"]
    session_key = stream_info["session_key"]

    event_id = 0

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0)) as client:
            async with client.stream(
                "POST",
                OPENCLAW_API_URL,
                headers={
                    "Authorization": f"Bearer {OPENCLAW_API_KEY}",
                    "Content-Type": "application/json",
                    "x-openclaw-session-key": session_key,
                },
                json={
                    "model": OPENCLAW_MODEL,
                    "stream": True,
                    "messages": [{"role": "user", "content": text}],
                },
            ) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    event_id += 1
                    yield f"id: {event_id}\nevent: agent-error\ndata: {json.dumps({'error_message': f'OpenClaw API error: {response.status_code} {body.decode()}'})}\n\n"
                    return

                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue

                    data_str = line[6:]
                    if data_str.strip() == "[DONE]":
                        break

                    try:
                        chunk = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    choices = chunk.get("choices", [])
                    if not choices:
                        continue

                    delta = choices[0].get("delta", {})
                    content = delta.get("content")

                    if content:
                        event_id += 1
                        yield f"id: {event_id}\nevent: text-delta\ndata: {json.dumps({'session_id': session_id, 'text': content})}\n\n"

    except httpx.ConnectError:
        event_id += 1
        yield f"id: {event_id}\nevent: agent-error\ndata: {json.dumps({'error_message': 'Cannot connect to OpenClaw API at ' + OPENCLAW_API_URL})}\n\n"
        return
    except Exception as e:
        event_id += 1
        yield f"id: {event_id}\nevent: agent-error\ndata: {json.dumps({'error_message': str(e)})}\n\n"
        return

    event_id += 1
    yield f"id: {event_id}\nevent: done\ndata: {json.dumps({'finish_reason': 'stop', 'session_id': session_id})}\n\n"


# ── Routes ───────────────────────────────────────────────────────────────────


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/sessions")
def list_sessions(limit: int = 50, offset: int = 0):
    all_sessions = load_all_sessions()
    return all_sessions[offset : offset + limit]


@app.get("/api/sessions/search")
def search_sessions(q: str = "", limit: int = 20, offset: int = 0):
    all_sessions = load_all_sessions()
    q_lower = q.lower()
    results = []
    for s in all_sessions:
        if q_lower in (s.get("title") or "").lower():
            results.append({"session": s, "snippet": None})
    return results[offset : offset + limit]


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):
    all_sessions = load_all_sessions()
    for s in all_sessions:
        if s["id"] == session_id:
            return s
    return JSONResponse(status_code=404, content={"detail": "Session not found"})


@app.get("/api/messages/{session_id}")
def get_messages(session_id: str, limit: int = 50, offset: int = -1):
    path = find_session_file(session_id)
    if not path:
        return {"total": 0, "offset": 0, "messages": []}

    records = parse_jsonl(path)
    all_messages = convert_messages(session_id, records)
    total = len(all_messages)

    if offset == -1:
        start = max(0, total - limit)
    else:
        start = offset

    page = all_messages[start : start + limit]

    return {
        "total": total,
        "offset": start,
        "messages": page,
    }


# ── Chat endpoints ───────────────────────────────────────────────────────────


def find_session_id_by_key(session_key: str) -> str | None:
    """Look up the sessionId for a given session key in sessions.json."""
    if not AGENTS_DIR.exists():
        return None
    for agent_dir in AGENTS_DIR.iterdir():
        if not agent_dir.is_dir():
            continue
        index_path = agent_dir / "sessions" / "sessions.json"
        if not index_path.exists():
            continue
        with open(index_path) as f:
            index_data = json.load(f)
        meta = index_data.get(session_key)
        if meta:
            return meta.get("sessionId")
    return None


async def create_new_session(text: str, agent_name: str = "main") -> tuple[str, str, str]:
    """
    Create a new OpenClaw session by sending the first message.
    Makes a non-streaming call to establish the session, then returns
    (session_key, session_id, response_text).
    """
    session_key = f"agent:{agent_name}:web:{uuid.uuid4().hex[:8]}"

    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0)) as client:
        response = await client.post(
            OPENCLAW_API_URL,
            headers={
                "Authorization": f"Bearer {OPENCLAW_API_KEY}",
                "Content-Type": "application/json",
                "x-openclaw-session-key": session_key,
            },
            json={
                "model": OPENCLAW_MODEL,
                "stream": False,
                "messages": [{"role": "user", "content": text}],
            },
        )

    if response.status_code != 200:
        raise Exception(f"OpenClaw API error: {response.status_code} {response.text}")

    # Extract response text
    data = response.json()
    response_text = ""
    choices = data.get("choices", [])
    if choices:
        message = choices[0].get("message", {})
        response_text = message.get("content", "")

    # Read sessions.json to find the new session ID
    session_id = find_session_id_by_key(session_key)
    if not session_id:
        raise Exception("Session was created but could not find its ID in sessions.json")

    return session_key, session_id, response_text


async def emit_prefetched_sse(stream_id: str):
    """Emit a pre-fetched response as SSE events (for new sessions)."""
    stream_info = active_streams.pop(stream_id, None)
    if not stream_info:
        yield f"id: 1\nevent: error\ndata: {json.dumps({'error_message': 'Stream not found'})}\n\n"
        return

    session_id = stream_info["session_id"]
    response_text = stream_info["response_text"]

    # Emit in chunks to simulate streaming
    event_id = 0
    chunk_size = 4
    for i in range(0, len(response_text), chunk_size):
        chunk = response_text[i : i + chunk_size]
        event_id += 1
        yield f"id: {event_id}\nevent: text-delta\ndata: {json.dumps({'session_id': session_id, 'text': chunk})}\n\n"

    event_id += 1
    yield f"id: {event_id}\nevent: done\ndata: {json.dumps({'finish_reason': 'stop', 'session_id': session_id})}\n\n"


@app.post("/api/chat/prompt")
async def chat_prompt(request: Request):
    body = await request.json()
    text = body.get("text", "").strip()
    session_id = body.get("session_id")

    if not text:
        return JSONResponse(status_code=400, content={"detail": "Empty message"})

    # New session: create via OpenClaw, get the response immediately
    if not session_id:
        try:
            session_key, new_session_id, response_text = await create_new_session(text)
        except Exception as e:
            return JSONResponse(status_code=500, content={"detail": str(e)})

        stream_id = str(uuid.uuid4())
        active_streams[stream_id] = {
            "session_id": new_session_id,
            "response_text": response_text,
            "prefetched": True,
        }
        return {"stream_id": stream_id, "session_id": new_session_id}

    # Existing session: look up the session key and stream
    session_key = find_session_key(session_id)
    if not session_key:
        return JSONResponse(status_code=404, content={"detail": "Session not found"})

    stream_id = str(uuid.uuid4())
    active_streams[stream_id] = {
        "session_id": session_id,
        "text": text,
        "session_key": session_key,
    }

    return {"stream_id": stream_id, "session_id": session_id}


@app.get("/api/chat/stream/{stream_id}")
async def chat_stream(stream_id: str):
    stream_info = active_streams.get(stream_id)
    if stream_info and stream_info.get("prefetched"):
        generator = emit_prefetched_sse(stream_id)
    else:
        generator = stream_openclaw_to_sse(stream_id)

    return StreamingResponse(
        generator,
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
    stream_id = body.get("stream_id")
    if stream_id:
        active_streams.pop(stream_id, None)
    return {"ok": True}


@app.post("/api/chat/respond")
async def chat_respond(request: Request):
    return {"ok": True}


# ── Stub endpoints (prevent frontend errors) ────────────────────────────────


@app.get("/api/config/api-key")
def config_api_key():
    return {"has_key": True, "provider": "openclaw"}


@app.get("/api/config/providers")
def config_providers():
    return []


@app.get("/api/models")
def list_models():
    return [
        {
            "id": "openclaw",
            "name": "OpenClaw Agent",
            "provider_id": "openclaw",
            "capabilities": {
                "function_calling": True,
                "vision": False,
                "reasoning": True,
                "json_output": True,
                "max_context": 200000,
                "max_output": 16384,
            },
            "pricing": {
                "prompt": 0,
                "completion": 0,
            },
            "metadata": {},
        }
    ]


@app.get("/api/agents")
def list_agents():
    agents = []
    if AGENTS_DIR.exists():
        for d in AGENTS_DIR.iterdir():
            if d.is_dir():
                agents.append({"id": d.name, "name": d.name})
    return agents


@app.get("/api/tools")
def list_tools():
    return []


@app.get("/api/skills")
def list_skills():
    return []


@app.get("/api/chat/active")
def chat_active():
    return []


@app.get("/api/mcp/status")
def mcp_status():
    return []


@app.get("/api/connectors")
def list_connectors():
    return []


@app.get("/api/channels")
def list_channels():
    return []


@app.get("/api/channels/openclaw/status")
def openclaw_status():
    """Check if OpenClaw gateway is reachable."""
    from urllib.parse import urlparse
    parsed = urlparse(OPENCLAW_API_URL)
    port = parsed.port or 18789
    try:
        resp = httpx.get(OPENCLAW_API_URL, timeout=3.0)
        running = resp.status_code in (200, 405)
    except Exception:
        running = False
    return {
        "installed": True,
        "running": running,
        "port": port if running else None,
        "ws_url": None,
    }


@app.get("/api/ollama/status")
def ollama_status():
    return {"binary_installed": False, "running": False}


@app.get("/api/config/openai-subscription")
def openai_subscription():
    return {"is_connected": False, "email": "", "needs_reauth": False}


@app.get("/api/plugins/status")
def plugins_status():
    return {}


@app.get("/api/automations")
def list_automations():
    return []


@app.get("/api/config/openyak-account")
def openyak_account():
    return {"linked": False}


@app.get("/api/config/ollama")
def ollama_config():
    return {"installed": False}


@app.get("/api/config/local")
def local_provider():
    return {"available": False}


@app.post("/api/sessions")
async def create_session(request: Request):
    # Frontend may call this but we create sessions via chat/prompt instead
    return {"id": str(uuid.uuid4()), "title": "New Chat"}


@app.patch("/api/sessions/{session_id}")
def update_session(session_id: str):
    return {"ok": True}


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str):
    return {"ok": True}


@app.get("/api/usage")
def usage(days: int = 7):
    return {"days": days, "sessions": 0, "messages": 0, "tokens": 0, "cost": 0}


@app.get("/api/sessions/{session_id}/todos")
def session_todos(session_id: str):
    return {"todos": []}


@app.get("/api/sessions/{session_id}/files")
def session_files(session_id: str):
    return {"files": []}


@app.get("/api/workspace-memory")
def workspace_memory(workspace_path: str = ""):
    return {"memory": None}


@app.get("/api/workspace-memory/list")
def workspace_memory_list():
    return []


@app.put("/api/workspace-memory")
async def workspace_memory_update(request: Request):
    return {"ok": True}


@app.delete("/api/workspace-memory")
def workspace_memory_delete(workspace_path: str = ""):
    return {"ok": True}


@app.post("/api/workspace-memory/refresh")
def workspace_memory_refresh(workspace_path: str = ""):
    return {"ok": True}


@app.post("/api/workspace-memory/export")
def workspace_memory_export(workspace_path: str = ""):
    return {"ok": True}


@app.post("/api/files/list-directory")
async def list_directory(request: Request):
    """List files and directories at a given path."""
    body = await request.json()
    raw_path = body.get("path")
    base = Path.home()

    if raw_path:
        target = Path(raw_path).resolve()
        # Prevent traversal outside home
        if not str(target).startswith(str(base)):
            return JSONResponse(status_code=403, content={"detail": "Access denied"})
    else:
        target = base

    if not target.is_dir():
        return JSONResponse(status_code=404, content={"detail": "Not a directory"})

    dirs = []
    files = []
    try:
        for entry in sorted(target.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
            if entry.is_dir():
                dirs.append({"name": entry.name, "path": str(entry)})
            else:
                files.append({"name": entry.name, "path": str(entry)})
    except PermissionError:
        pass

    parent = str(target.parent) if target != base else None

    return {
        "path": str(target),
        "parent": parent,
        "dirs": dirs,
        "files": files,
    }


@app.get("/api/fts/index/{workspace:path}")
def fts_index_get(workspace: str, session_id: str = ""):
    return {"status": "idle", "progress": 0}


@app.post("/api/fts/index/{workspace:path}")
def fts_index_post(workspace: str, session_id: str = ""):
    return {"status": "idle", "progress": 0}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
