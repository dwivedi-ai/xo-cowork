"""
OpenClaw → OpenYak Bridge API Server

Reads OpenClaw's file-based session/message storage (~/.openclaw/agents/*)
and serves it in the format OpenYak's frontend expects.
Proxies chat messages to OpenClaw's OpenAI-compatible API with SSE translation.
"""

import json
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

import hashlib
import mimetypes

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Request, UploadFile
from pydantic import BaseModel, Field
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
OPENCLAW_JSON = OPENCLAW_DIR / "openclaw.json"
DEFAULT_OPENCLAW_WORKSPACE = OPENCLAW_DIR / "workspace"

_VALID_AGENT_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$", re.IGNORECASE)
_INVALID_AGENT_ID_CHARS = re.compile(r"[^a-z0-9_-]+", re.IGNORECASE)
_LEADING_DASHES = re.compile(r"^-+")
_TRAILING_DASHES = re.compile(r"-+$")

_WORKSPACE_SEED_FILES = (
    "AGENTS.md",
    "SOUL.md",
    "TOOLS.md",
    "USER.md",
    "HEARTBEAT.md",
    "IDENTITY.md",
    "BOOTSTRAP.md",
)

_WORKSPACE_DOC_FILES = (
    "IDENTITY.md",
    "SOUL.md",
    "USER.md",
    "AGENTS.md",
    "TOOLS.md",
    "HEARTBEAT.md",
    "BOOTSTRAP.md",
    "MEMORY.md",
)

_MAX_AGENT_PAYLOAD_BYTES = 256_000

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


def normalize_agent_id(value: str | None) -> str:
    """Match OpenClaw's normalizeAgentId (session-key) rules."""
    if value is None:
        return "main"
    trimmed = value.strip()
    if not trimmed:
        return "main"
    normalized = trimmed.lower()
    if _VALID_AGENT_ID.fullmatch(normalized):
        return normalized
    cleaned = _INVALID_AGENT_ID_CHARS.sub("-", normalized)
    cleaned = _LEADING_DASHES.sub("", cleaned)
    cleaned = _TRAILING_DASHES.sub("", cleaned)
    cleaned = cleaned[:64]
    return cleaned if cleaned else "main"


def list_agent_entries(cfg: dict) -> list[dict]:
    agents = cfg.get("agents")
    if not isinstance(agents, dict):
        return []
    lst = agents.get("list")
    if not isinstance(lst, list):
        return []
    return [e for e in lst if isinstance(e, dict) and e.get("id")]


def resolve_default_agent_id(cfg: dict) -> str:
    entries = list_agent_entries(cfg)
    if not entries:
        return "main"
    defaults = [e for e in entries if e.get("default") is True]
    chosen = (defaults[0] if defaults else entries[0]).get("id", "main")
    return normalize_agent_id(str(chosen))


def resolve_agent_workspace_dir(cfg: dict, agent_id: str) -> Path:
    """Mirror OpenClaw resolveAgentWorkspaceDir for local disk layout."""
    aid = normalize_agent_id(agent_id)
    entry = next(
        (e for e in list_agent_entries(cfg) if normalize_agent_id(str(e.get("id", ""))) == aid),
        None,
    )
    if entry and isinstance(entry.get("workspace"), str) and entry["workspace"].strip():
        return Path(entry["workspace"]).expanduser().resolve()

    default_id = resolve_default_agent_id(cfg)
    agents_defaults = (cfg.get("agents") or {}).get("defaults") or {}
    fallback = agents_defaults.get("workspace")
    if aid == default_id:
        if isinstance(fallback, str) and fallback.strip():
            return Path(fallback).expanduser().resolve()
        return DEFAULT_OPENCLAW_WORKSPACE.resolve()
    if isinstance(fallback, str) and fallback.strip():
        return (Path(fallback).expanduser().resolve() / aid).resolve()
    return (OPENCLAW_DIR / f"workspace-{aid}").resolve()


def load_openclaw_config() -> dict:
    if not OPENCLAW_JSON.exists():
        return {}
    try:
        with open(OPENCLAW_JSON) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_openclaw_config(cfg: dict) -> None:
    OPENCLAW_JSON.parent.mkdir(parents=True, exist_ok=True)
    tmp = OPENCLAW_JSON.with_suffix(".tmp")
    text = json.dumps(cfg, indent=2) + "\n"
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(OPENCLAW_JSON)


def find_agent_entry_index(entries: list[dict], agent_id: str) -> int:
    aid = normalize_agent_id(agent_id)
    for i, e in enumerate(entries):
        if normalize_agent_id(str(e.get("id", ""))) == aid:
            return i
    return -1


def _agent_model_to_display(model_value) -> str | None:
    if model_value is None:
        return None
    if isinstance(model_value, str):
        return model_value
    if isinstance(model_value, dict):
        p = model_value.get("primary")
        if isinstance(p, str):
            return p
    return None


def apply_agent_list_entry(cfg: dict, agent_id: str, name: str, workspace: Path) -> dict:
    """
    Append or update agents.list like OpenClaw applyAgentConfig (add branch).
    When the list is empty and the new id is not the default agent, inserts {id: main} first.
    """
    aid = normalize_agent_id(agent_id)
    default_id = resolve_default_agent_id(cfg)
    agents_block = dict(cfg.get("agents") or {})
    lst = list_agent_entries(cfg)
    next_list = [dict(e) for e in lst]
    idx = find_agent_entry_index(next_list, aid)
    next_entry: dict = {"id": aid, "name": name, "workspace": str(workspace)}
    if idx >= 0:
        next_list[idx] = {**next_list[idx], **next_entry}
    else:
        if len(next_list) == 0 and aid != default_id:
            next_list.append({"id": default_id})
        next_list.append(next_entry)
    agents_block["list"] = next_list
    return {**cfg, "agents": agents_block}


def _path_must_be_under_home(path: Path) -> bool:
    home = Path.home().resolve()
    try:
        path.resolve().relative_to(home)
        return True
    except ValueError:
        return False


def seed_agent_workspace(workspace_dir: Path, template_dir: Path) -> None:
    workspace_dir.mkdir(parents=True, exist_ok=True)
    if not template_dir.is_dir():
        return
    for fname in _WORKSPACE_SEED_FILES:
        src = template_dir / fname
        dst = workspace_dir / fname
        if src.is_file() and not dst.exists():
            shutil.copy2(src, dst)


def ensure_openclaw_agent_disk(agent_id: str, workspace_dir: Path) -> None:
    """Sessions store + optional workspace bootstrap; matches ~/.openclaw/agents/<id> layout."""
    aid = normalize_agent_id(agent_id)
    sessions_dir = AGENTS_DIR / aid / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    idx_file = sessions_dir / "sessions.json"
    if not idx_file.exists():
        idx_file.write_text("{}", encoding="utf-8")
    (AGENTS_DIR / aid / "agent").mkdir(parents=True, exist_ok=True)
    tpl = DEFAULT_OPENCLAW_WORKSPACE if DEFAULT_OPENCLAW_WORKSPACE.is_dir() else Path()
    seed_agent_workspace(workspace_dir, tpl)


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
                "agent": agent_name,
                "directory": meta.get("directory") or str(OPENCLAW_DIR / "workspace"),
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


def update_session_directory(session_id: str, directory: str) -> bool:
    """Persist selected workspace directory on the matching sessions.json entry."""
    if not AGENTS_DIR.exists():
        return False

    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    for agent_dir in AGENTS_DIR.iterdir():
        if not agent_dir.is_dir():
            continue
        index_path = agent_dir / "sessions" / "sessions.json"
        if not index_path.exists():
            continue
        try:
            with open(index_path, "r", encoding="utf-8") as f:
                index_data = json.load(f)
        except Exception:
            continue

        changed = False
        for meta in index_data.values():
            if not isinstance(meta, dict) or meta.get("sessionId") != session_id:
                continue
            history = meta.get("directoryHistory")
            if not isinstance(history, list):
                history = []
            history.append({"directory": directory, "selectedAt": now_ms})
            meta["directoryHistory"] = history[-200:]
            meta["directory"] = directory
            meta["updatedAt"] = now_ms
            changed = True
            break

        if changed:
            index_path.write_text(json.dumps(index_data, ensure_ascii=False, indent=2), encoding="utf-8")
            return True

    return False


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


def openclaw_agent_id_from_prompt_body(body: dict) -> str:
    """Resolve OpenClaw agent id from `model` (e.g. openclaw/research) for new sessions."""
    model = body.get("model")
    if isinstance(model, str):
        lowered = model.strip().lower()
        if lowered.startswith("openclaw/"):
            rest = model.split("/", 1)[1] if "/" in model else ""
            return normalize_agent_id(rest) if rest.strip() else "main"
        if lowered == "openclaw":
            return "main"
    return "main"


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
            oc_agent = openclaw_agent_id_from_prompt_body(body)
            session_key, new_session_id, response_text = await create_new_session(text, agent_name=oc_agent)
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


OPENCLAW_MODEL_CAPABILITIES: dict = {
    "function_calling": True,
    "vision": False,
    "reasoning": True,
    "json_output": True,
    "max_context": 200000,
    "max_output": 16384,
}


def list_openclaw_models() -> list[dict]:
    """One model row per OpenClaw agent so the UI can target `openclaw/<agentId>`."""
    cfg = load_openclaw_config()
    entries_by_id = {
        normalize_agent_id(str(e.get("id", ""))): e
        for e in list_agent_entries(cfg)
        if e.get("id")
    }
    models: list[dict] = []
    seen: set[str] = set()

    if AGENTS_DIR.exists():
        for agent_dir in sorted(AGENTS_DIR.iterdir()):
            if not agent_dir.is_dir():
                continue
            aid = normalize_agent_id(agent_dir.name)
            seen.add(aid)
            meta = entries_by_id.get(aid, {})
            display = meta.get("name") if isinstance(meta.get("name"), str) else None
            label = (display or "").strip() or aid
            models.append(
                {
                    "id": f"openclaw/{aid}",
                    "name": label,
                    "provider_id": "openclaw",
                    "capabilities": dict(OPENCLAW_MODEL_CAPABILITIES),
                    "pricing": {"prompt": 0, "completion": 0},
                    "metadata": {"openclaw_agent_id": aid},
                }
            )

    if not models:
        models.append(
            {
                "id": "openclaw/main",
                "name": "main",
                "provider_id": "openclaw",
                "capabilities": dict(OPENCLAW_MODEL_CAPABILITIES),
                "pricing": {"prompt": 0, "completion": 0},
                "metadata": {"openclaw_agent_id": "main"},
            }
        )

    return models


@app.get("/api/models")
def list_models():
    return list_openclaw_models()


class CreateAgentBody(BaseModel):
    """Payload for POST /api/agents — persisted to OpenClaw ~/.openclaw/openclaw.json and disk layout."""

    name: str = Field(..., min_length=1, max_length=200)
    id: str | None = Field(None, max_length=80)
    description: str | None = Field(None, max_length=4000)
    workspace: str | None = Field(None, max_length=2048)


def _agent_info_for_id(cfg: dict, agent_id: str, display_name: str | None, description: str) -> dict:
    """OpenYak AgentInfo shape; `name` is the OpenClaw agent id so session.directory grouping matches."""
    aid = normalize_agent_id(agent_id)
    return {
        "name": aid,
        "description": description or display_name or aid,
        "mode": "primary",
        "tools": [],
        "permissions": {"rules": []},
        "system_prompt": None,
        "temperature": None,
        "metadata": {
            "openclaw_id": aid,
            "display_name": display_name or aid,
            "workspace": str(resolve_agent_workspace_dir(cfg, aid)),
        },
    }


@app.get("/api/agents")
def list_agents():
    cfg = load_openclaw_config()
    entries = {normalize_agent_id(str(e.get("id", ""))): e for e in list_agent_entries(cfg)}
    agents: list[dict] = []
    if not AGENTS_DIR.exists():
        return agents
    for d in sorted(AGENTS_DIR.iterdir()):
        if not d.is_dir():
            continue
        aid = d.name
        meta = entries.get(normalize_agent_id(aid), {})
        display = meta.get("name") if isinstance(meta.get("name"), str) else None
        desc = ""
        if isinstance(meta.get("identity"), dict):
            ident = meta["identity"]
            if isinstance(ident.get("bio"), str):
                desc = ident["bio"]
        agents.append(_agent_info_for_id(cfg, aid, display, desc))
    return agents


@app.post("/api/agents")
def create_agent(body: CreateAgentBody):
    """
    Register a new OpenClaw agent: updates agents.list in openclaw.json, creates
    ~/.openclaw/agents/<id>/sessions and workspace dirs (same layout as `openclaw agents add`).
    """
    display_name = body.name.strip()
    agent_id = normalize_agent_id((body.id or body.name).strip())
    if agent_id == "main":
        return JSONResponse(status_code=400, content={"detail": 'Agent id "main" is reserved; choose another id or name.'})

    cfg = load_openclaw_config()
    existing_entries = list_agent_entries(cfg)
    if find_agent_entry_index(existing_entries, agent_id) >= 0:
        return JSONResponse(status_code=409, content={"detail": f'Agent "{agent_id}" already exists in openclaw.json.'})
    if (AGENTS_DIR / agent_id).exists():
        return JSONResponse(status_code=409, content={"detail": f'Agent directory "{agent_id}" already exists under ~/.openclaw/agents.'})

    if body.workspace and body.workspace.strip():
        ws = Path(body.workspace.strip()).expanduser().resolve()
        if not _path_must_be_under_home(ws):
            return JSONResponse(
                status_code=400,
                content={"detail": "workspace must resolve to a path under your home directory."},
            )
        workspace_dir = ws
    else:
        workspace_dir = resolve_agent_workspace_dir(cfg, agent_id)

    try:
        next_cfg = apply_agent_list_entry(cfg, agent_id, display_name, workspace_dir)
        write_openclaw_config(next_cfg)
        ensure_openclaw_agent_disk(agent_id, workspace_dir)
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

    desc = (body.description or "").strip() or display_name
    return _agent_info_for_id(next_cfg, agent_id, display_name, desc)


def _read_text_limited(path: Path, max_bytes: int = _MAX_AGENT_PAYLOAD_BYTES) -> str | None:
    if not path.is_file():
        return None
    try:
        return path.read_text(encoding="utf-8", errors="replace")[:max_bytes]
    except Exception:
        return None


def _read_json_file_safe(path: Path) -> dict | list | None:
    if not path.is_file():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _redact_secrets_nested(obj):
    """Replace obvious credential fields; never return raw API keys."""
    sensitive_keys = frozenset(
        {"key", "token", "secret", "password", "accesstoken", "refreshtoken", "authorization", "apikey"}
    )
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            lk = str(k).lower()
            if lk in sensitive_keys:
                out[k] = "[configured]" if v else None
            else:
                out[k] = _redact_secrets_nested(v)
        return out
    if isinstance(obj, list):
        return [_redact_secrets_nested(x) for x in obj]
    return obj


def _summarize_auth_profiles(profiles_obj) -> dict[str, dict]:
    """Non-secret view of auth profile entries."""
    if not isinstance(profiles_obj, dict):
        return {}
    out: dict[str, dict] = {}
    for pid, p in profiles_obj.items():
        if not isinstance(p, dict):
            continue
        row = {"provider": p.get("provider"), "mode": p.get("mode")}
        if any(p.get(k) for k in ("key", "token", "secret", "password")):
            row["credentials"] = "configured"
        out[str(pid)] = row
    return out


def get_agent_detail(agent_id: str) -> dict | None:
    """
    Full agent snapshot for the UI: OpenClaw config, workspace docs, on-disk models,
    redacted auth, sessions index, and global auth summary.
    """
    aid = normalize_agent_id(agent_id)
    agent_root = AGENTS_DIR / aid
    if not agent_root.is_dir():
        return None

    cfg = load_openclaw_config()
    entries = list_agent_entries(cfg)
    idx = find_agent_entry_index(entries, aid)
    entry = dict(entries[idx]) if idx >= 0 else {}

    display = entry.get("name") if isinstance(entry.get("name"), str) else None
    desc = ""
    identity_cfg: dict = {}
    if isinstance(entry.get("identity"), dict):
        identity_cfg = dict(entry["identity"])
        bio = identity_cfg.get("bio")
        if isinstance(bio, str):
            desc = bio

    ws_path = resolve_agent_workspace_dir(cfg, aid)
    workspace_path_str = str(ws_path)
    workspace_files: dict[str, str | None] = {}
    for fname in _WORKSPACE_DOC_FILES:
        content = _read_text_limited(ws_path / fname)
        if content is not None:
            workspace_files[fname] = content
        elif (ws_path / fname).is_file():
            workspace_files[fname] = ""

    agent_disk = agent_root / "agent"
    models_catalog = _read_json_file_safe(agent_disk / "models.json")
    auth_state = _read_json_file_safe(agent_disk / "auth-state.json")
    auth_profiles_raw = _read_json_file_safe(agent_disk / "auth-profiles.json")
    auth_profiles_safe = None
    if isinstance(auth_profiles_raw, dict):
        auth_profiles_safe = _redact_secrets_nested(auth_profiles_raw)

    sessions_index_path = agent_root / "sessions" / "sessions.json"
    session_ids: list[str] = []
    session_count = 0
    idx_data = _read_json_file_safe(sessions_index_path)
    if isinstance(idx_data, dict):
        seen_ids: set[str] = set()
        for _key, meta in idx_data.items():
            if isinstance(meta, dict):
                sid = meta.get("sessionId")
                if isinstance(sid, str) and sid.strip():
                    seen_ids.add(sid.strip())
        session_count = len(seen_ids)
        session_ids = sorted(seen_ids)[:80]

    global_auth = (cfg.get("auth") or {}).get("profiles")
    global_auth_summary = _summarize_auth_profiles(global_auth) if isinstance(global_auth, dict) else {}

    agents_defaults = cfg.get("agents", {}).get("defaults")
    if not isinstance(agents_defaults, dict):
        agents_defaults = {}

    return {
        "id": aid,
        "display_name": ((display or "").strip() or aid),
        "description": desc,
        "workspace": workspace_path_str,
        "model": _agent_model_to_display(entry.get("model")),
        "model_raw": entry.get("model"),
        "identity": {
            "name": identity_cfg.get("name") if isinstance(identity_cfg.get("name"), str) else None,
            "emoji": identity_cfg.get("emoji") if isinstance(identity_cfg.get("emoji"), str) else None,
            "bio": desc or None,
        },
        "config_entry": entry,
        "agents_defaults": agents_defaults,
        "workspace_files": workspace_files,
        "on_disk": {
            "agent_dir": str(agent_disk.resolve()),
            "models_catalog": models_catalog,
            "auth_state": auth_state,
            "auth_profiles": auth_profiles_safe,
        },
        "sessions": {
            "index_path": str(sessions_index_path.resolve()),
            "count": session_count,
            "session_ids": session_ids,
        },
        "openclaw_global_auth": global_auth_summary,
    }


class UpdateAgentBody(BaseModel):
    """PATCH /api/agents/{id} — only fields present in the JSON body are applied."""

    name: str | None = Field(None, max_length=200)
    description: str | None = Field(None, max_length=4000)
    workspace: str | None = Field(None, max_length=2048)
    model: str | None = Field(None, max_length=400)
    identity_name: str | None = Field(None, max_length=200)
    identity_emoji: str | None = Field(None, max_length=32)


def patch_agent_into_config(cfg: dict, agent_id: str, body: UpdateAgentBody) -> dict:
    aid = normalize_agent_id(agent_id)
    if find_agent_entry_index(list_agent_entries(cfg), aid) < 0:
        ws_dir = resolve_agent_workspace_dir(cfg, aid)
        cfg = apply_agent_list_entry(cfg, aid, aid, ws_dir)
    entries = list_agent_entries(cfg)
    idx = find_agent_entry_index(entries, aid)
    if idx < 0:
        raise RuntimeError("could not resolve agent in openclaw.json")
    next_list = [dict(e) for e in entries]
    entry = dict(next_list[idx])
    if body.name is not None:
        stripped = body.name.strip()
        entry["name"] = stripped or aid
    if body.workspace is not None:
        ws = Path(body.workspace.strip()).expanduser().resolve()
        if not _path_must_be_under_home(ws):
            raise ValueError("workspace must resolve to a path under your home directory")
        entry["workspace"] = str(ws)
    if body.description is not None:
        desc = body.description.strip()
        ident = dict(entry.get("identity") or {})
        if desc:
            ident["bio"] = desc
            entry["identity"] = ident
        else:
            ident.pop("bio", None)
            if ident:
                entry["identity"] = ident
            else:
                entry.pop("identity", None)
    if body.model is not None:
        m = body.model.strip()
        if m:
            entry["model"] = m
        else:
            entry.pop("model", None)
    if body.identity_name is not None or body.identity_emoji is not None:
        ident = dict(entry.get("identity") or {})
        if body.identity_name is not None:
            nv = body.identity_name.strip()
            if nv:
                ident["name"] = nv
            else:
                ident.pop("name", None)
        if body.identity_emoji is not None:
            ev = body.identity_emoji.strip()
            if ev:
                ident["emoji"] = ev
            else:
                ident.pop("emoji", None)
        if ident:
            entry["identity"] = ident
        else:
            entry.pop("identity", None)
    next_list[idx] = entry
    agents_block = dict(cfg.get("agents") or {})
    agents_block["list"] = next_list
    return {**cfg, "agents": agents_block}


@app.get("/api/agents/{agent_id}")
def get_agent(agent_id: str):
    detail = get_agent_detail(agent_id)
    if not detail:
        return JSONResponse(status_code=404, content={"detail": f'Agent "{agent_id}" not found'})
    return detail


@app.patch("/api/agents/{agent_id}")
def patch_agent(agent_id: str, body: UpdateAgentBody):
    aid = normalize_agent_id(agent_id)
    if not (AGENTS_DIR / aid).is_dir():
        return JSONResponse(status_code=404, content={"detail": f'Agent "{aid}" not found'})
    if not body.model_fields_set:
        detail = get_agent_detail(aid)
        return detail if detail else JSONResponse(status_code=404, content={"detail": "Not found"})
    try:
        cfg = load_openclaw_config()
        next_cfg = patch_agent_into_config(cfg, aid, body)
        write_openclaw_config(next_cfg)
    except ValueError as e:
        return JSONResponse(status_code=400, content={"detail": str(e)})
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})
    detail = get_agent_detail(aid)
    return detail if detail else JSONResponse(status_code=500, content={"detail": "Failed to read agent after update"})


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


@app.get("/api/codex/status")
def codex_status():
    """Check whether Codex OAuth credentials exist in openclaw.json."""
    try:
        config = json.loads(OPENCLAW_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"is_connected": False, "email": ""}
    profiles = config.get("auth", {}).get("profiles", {})
    for pid, prof in profiles.items():
        if prof.get("provider") == "openai-codex":
            return {"is_connected": True, "email": prof.get("email", "")}
    return {"is_connected": False, "email": ""}


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


# ── Sensitive-field masking patterns ────────────────────────────────────────
_SENSITIVE_KEYS = {"botToken", "apiKey", "api_key", "token", "secret", "password"}


def _mask_value(v: str) -> str:
    if len(v) <= 8:
        return "****"
    return v[:4] + "*" * (len(v) - 8) + v[-4:]


def _mask_sensitive(obj: object) -> object:
    """Recursively mask sensitive fields in a JSON-like structure."""
    if isinstance(obj, dict):
        return {
            k: (_mask_value(v) if isinstance(v, str) and k in _SENSITIVE_KEYS else _mask_sensitive(v))
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [_mask_sensitive(item) for item in obj]
    return obj


@app.get("/api/config/openclaw")
def get_openclaw_config():
    """Return the full openclaw.json with sensitive fields masked."""
    cfg = load_openclaw_config()
    if not cfg:
        return JSONResponse(status_code=404, content={"detail": "openclaw.json not found"})
    return _mask_sensitive(cfg)


@app.post("/api/sessions")
async def create_session(request: Request):
    # Frontend may call this but we create sessions via chat/prompt instead
    return {"id": str(uuid.uuid4()), "title": "New Chat"}


@app.patch("/api/sessions/{session_id}")
async def update_session(session_id: str, request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}

    directory = body.get("directory")
    if directory is None:
        return {"ok": True}

    directory = str(directory).strip()
    if not directory:
        return JSONResponse(status_code=400, content={"detail": "directory must be a non-empty string"})

    updated = update_session_directory(session_id, directory)
    if not updated:
        return JSONResponse(status_code=404, content={"detail": "Session not found"})

    return {"ok": True, "session_id": session_id, "directory": directory}


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str):
    return {"ok": True}


@app.get("/api/usage")
def usage(days: int = 30):
    """
    Aggregate OpenClaw usage across all agents/sessions within the last `days`.
    Walks ~/.openclaw/agents/*/sessions/*.jsonl and sums assistant message usage.
    Returns the UsageStats shape expected by the frontend (src/types/usage.ts).
    """
    from datetime import timedelta

    days = max(1, min(days, 365))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    total_tokens = {"input": 0, "output": 0, "reasoning": 0, "cache_read": 0, "cache_write": 0}
    total_cost = 0.0
    assistant_messages = 0
    user_messages = 0
    session_ids: set[str] = set()

    by_day: dict[str, dict] = {}
    # (model_id, provider_id) -> ModelUsage dict
    by_model_key: dict[tuple[str, str], dict] = {}
    # session_id -> SessionUsage dict
    session_stats: dict[str, dict] = {}
    # response-time samples: user→assistant latency in seconds
    response_times: list[float] = []

    def _empty_tokens():
        return {"input": 0, "output": 0, "reasoning": 0, "cache_read": 0, "cache_write": 0}

    if AGENTS_DIR.exists():
        for agent_dir in AGENTS_DIR.iterdir():
            if not agent_dir.is_dir():
                continue
            sessions_dir = agent_dir / "sessions"
            if not sessions_dir.is_dir():
                continue

            for session_file in sessions_dir.glob("*.jsonl"):
                session_id = session_file.stem
                try:
                    records = parse_jsonl(session_file)
                except Exception:
                    continue

                session_title: str | None = None
                first_user_time_created: str | None = None
                session_entry = {
                    "session_id": session_id,
                    "title": "Untitled Session",
                    "total_cost": 0.0,
                    "total_tokens": 0,
                    "message_count": 0,
                    "time_created": None,
                }
                last_user_time: datetime | None = None

                for record in records:
                    if record.get("type") != "message":
                        continue
                    msg = record.get("message", {})
                    role = msg.get("role")
                    ts = record.get("timestamp")
                    try:
                        record_time = datetime.fromisoformat(ts.replace("Z", "+00:00")) if ts else None
                    except Exception:
                        record_time = None
                    if record_time is None or record_time < cutoff:
                        continue

                    if role == "user":
                        user_messages += 1
                        session_ids.add(session_id)
                        last_user_time = record_time
                        if session_title is None:
                            for block in msg.get("content", []):
                                if block.get("type") == "text":
                                    text = block["text"].strip()
                                    if text and not text.startswith("Read HEARTBEAT.md"):
                                        session_title = text[:80] + ("..." if len(text) > 80 else "")
                                        break
                        if first_user_time_created is None:
                            first_user_time_created = ts
                        continue

                    if role != "assistant":
                        continue

                    usage_data = msg.get("usage") or {}
                    if not usage_data:
                        continue

                    inp = int(usage_data.get("input", 0) or 0)
                    out = int(usage_data.get("output", 0) or 0)
                    cache_r = int(usage_data.get("cacheRead", 0) or 0)
                    cache_w = int(usage_data.get("cacheWrite", 0) or 0)
                    cost_raw = usage_data.get("cost", 0)
                    if isinstance(cost_raw, dict):
                        cost_val = float(cost_raw.get("total") or 0)
                    else:
                        cost_val = float(cost_raw or 0)

                    total_tokens["input"] += inp
                    total_tokens["output"] += out
                    total_tokens["cache_read"] += cache_r
                    total_tokens["cache_write"] += cache_w
                    total_cost += cost_val
                    assistant_messages += 1
                    session_ids.add(session_id)

                    # response-time: seconds between last user message and this assistant reply
                    if last_user_time is not None:
                        delta = (record_time - last_user_time).total_seconds()
                        if 0 <= delta <= 600:  # sanity cap at 10 min
                            response_times.append(delta)
                        last_user_time = None

                    day_key = record_time.date().isoformat()
                    day = by_day.setdefault(day_key, {
                        "date": day_key, "cost": 0.0, "tokens": 0, "messages": 0,
                    })
                    day["cost"] += cost_val
                    day["tokens"] += inp + out
                    day["messages"] += 1

                    model_id = msg.get("model") or "unknown"
                    provider_id = msg.get("provider") or ""
                    mk = (model_id, provider_id)
                    m = by_model_key.setdefault(mk, {
                        "model_id": model_id,
                        "provider_id": provider_id,
                        "total_cost": 0.0,
                        "total_tokens": _empty_tokens(),
                        "message_count": 0,
                    })
                    m["total_cost"] += cost_val
                    m["total_tokens"]["input"] += inp
                    m["total_tokens"]["output"] += out
                    m["total_tokens"]["cache_read"] += cache_r
                    m["total_tokens"]["cache_write"] += cache_w
                    m["message_count"] += 1

                    session_entry["total_cost"] += cost_val
                    session_entry["total_tokens"] += inp + out
                    session_entry["message_count"] += 1

                if session_entry["message_count"] > 0:
                    if session_title:
                        session_entry["title"] = session_title
                    session_entry["time_created"] = first_user_time_created or iso_now()
                    session_stats[session_id] = session_entry

    # Fill daily series with zeros
    today = datetime.now(timezone.utc).date()
    daily = []
    for i in range(days - 1, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        daily.append(by_day.get(d, {"date": d, "cost": 0.0, "tokens": 0, "messages": 0}))

    by_model = sorted(by_model_key.values(), key=lambda m: m["total_cost"], reverse=True)
    by_session = sorted(session_stats.values(), key=lambda s: s["total_cost"], reverse=True)[:10]

    # Response-time stats
    if response_times:
        sorted_rt = sorted(response_times)
        n = len(sorted_rt)
        rt_stats = {
            "avg": sum(sorted_rt) / n,
            "median": sorted_rt[n // 2],
            "p95": sorted_rt[min(n - 1, int(n * 0.95))],
            "min": sorted_rt[0],
            "max": sorted_rt[-1],
            "count": n,
        }
        avg_response_time = rt_stats["avg"]
    else:
        rt_stats = {"avg": 0, "median": 0, "p95": 0, "min": 0, "max": 0, "count": 0}
        avg_response_time = 0

    total_sessions = len(session_ids)
    flat_tokens = total_tokens["input"] + total_tokens["output"] + total_tokens["reasoning"]
    avg_tokens_per_session = flat_tokens / total_sessions if total_sessions else 0

    return {
        "total_cost": round(total_cost, 6),
        "total_tokens": total_tokens,
        "total_sessions": total_sessions,
        "total_messages": assistant_messages + user_messages,
        "avg_tokens_per_session": round(avg_tokens_per_session, 2),
        "avg_response_time": round(avg_response_time, 3),
        "by_model": by_model,
        "by_session": by_session,
        "daily": daily,
        "response_time": {
            "avg": round(rt_stats["avg"], 3),
            "median": round(rt_stats["median"], 3),
            "p95": round(rt_stats["p95"], 3),
            "min": round(rt_stats["min"], 3),
            "max": round(rt_stats["max"], 3),
            "count": rt_stats["count"],
        },
    }


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


@app.post("/api/files/upload")
async def upload_file(
    file: UploadFile = File(...),
    workspace: str = Form(""),
):
    """Save an uploaded file into the workspace (or ~/uploads fallback)."""
    content = await file.read()
    content_hash = hashlib.sha256(content).hexdigest()

    if workspace:
        dest_dir = Path(workspace).resolve()
    else:
        dest_dir = Path.home() / "uploads"
    dest_dir.mkdir(parents=True, exist_ok=True)

    filename = file.filename or "upload"
    dest = dest_dir / filename

    # Avoid overwriting — append hash suffix if name collides with different content
    if dest.exists():
        existing_hash = hashlib.sha256(dest.read_bytes()).hexdigest()
        if existing_hash != content_hash:
            stem = dest.stem
            suffix = dest.suffix
            dest = dest_dir / f"{stem}_{content_hash[:8]}{suffix}"

    dest.write_bytes(content)

    mime = file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"

    return {
        "file_id": content_hash[:16],
        "name": dest.name,
        "path": str(dest),
        "size": len(content),
        "mime_type": mime,
        "source": "uploaded",
        "content_hash": content_hash,
    }


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


@app.post("/api/files/content")
async def file_content(request: Request):
    """Read text content of a file."""
    body = await request.json()
    raw_path = body.get("path")
    if not raw_path:
        return JSONResponse(status_code=400, content={"detail": "Missing path"})

    base = Path.home()
    target = Path(raw_path).resolve()

    if not str(target).startswith(str(base)):
        return JSONResponse(status_code=403, content={"detail": "Access denied"})

    if not target.is_file():
        return JSONResponse(status_code=404, content={"detail": "File not found"})

    try:
        content = target.read_text(errors="replace")
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

    return {"content": content, "path": str(target)}


@app.post("/api/files/content-binary")
async def file_content_binary(request: Request):
    """Read binary file and return as a downloadable response."""
    from fastapi.responses import FileResponse

    body = await request.json()
    raw_path = body.get("path")
    if not raw_path:
        return JSONResponse(status_code=400, content={"detail": "Missing path"})

    base = Path.home()
    target = Path(raw_path).resolve()

    if not str(target).startswith(str(base)):
        return JSONResponse(status_code=403, content={"detail": "Access denied"})

    if not target.is_file():
        return JSONResponse(status_code=404, content={"detail": "File not found"})

    return FileResponse(str(target), filename=target.name)


# ---------------------------------------------------------------------------
# Secrets — OpenClaw .env file
# ---------------------------------------------------------------------------

_ENV_FILE = Path.home() / ".openclaw" / ".env"


def _parse_env_file(text: str) -> list[dict]:
    """Parse a .env file into a list of {key, value} dicts (skips blank lines and comments)."""
    entries = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "=" in stripped:
            key, _, value = stripped.partition("=")
            entries.append({"key": key.strip(), "value": value.strip()})
    return entries


def _serialize_env_file(entries: list[dict]) -> str:
    """Serialize a list of {key, value} dicts back to .env file text."""
    lines = [f"{e['key']}={e['value']}" for e in entries if e.get("key", "").strip()]
    return "\n".join(lines) + ("\n" if lines else "")


_PROJECT_SCAFFOLD: dict[str, str] = {
    "WORKSPACE.md": """\
# WORKSPACE.md

## Workspace Summary
- **Name:** <project-name>
- **Owner:** <owner-or-team>
- **Last updated:** <YYYY-MM-DD>
- **Primary repository/folder:** <absolute-or-repo-relative-path>

## Mission
<!-- 1-3 lines on why this workspace exists and what success looks like. -->

## Product/Project Context
<!-- Problem statement, users, constraints, and non-goals. -->

## Architecture Snapshot
- **Frontend:** <framework/runtime>
- **Backend:** <framework/runtime>
- **Data layer:** <db/cache/queue>
- **Integrations:** <external APIs/services>

## Working Boundaries
- In-scope:
  - <what can be changed>
- Out-of-scope:
  - <what should not be changed without approval>

## Sources of Truth
- Requirements: <path or link>
- Design docs: <path or link>
- API contracts: <path or link>
- Runbooks: <path or link>

## Current Focus
- Sprint/iteration theme: <theme>
- Active objective IDs: <OBJ-1, OBJ-2>
- Risks/blockers:
  - <risk 1>
  - <risk 2>

## Handover Notes
<!-- Short operational notes future agents should know before they start. -->

---
""",
    "AGENTS.md": """\
# AGENTS.md

## Agent Operating Contract
All agents working in this workspace must:
1. Read `WORKSPACE.md` and `OBJECTIVES.md` before making edits.
2. Align every task to at least one objective ID from `OBJECTIVES.md`.
3. Keep changes inside agreed workspace boundaries.
4. Document findings, decisions, and progress in the logs below.

## Execution Rules
- Prefer small, reversible changes.
- Do not use destructive commands without explicit approval.
- Validate critical changes with available tests/checks.
- Surface assumptions and blockers early.
- Keep documentation in sync with behavior changes.

## Required Logs
### Objective Progress Log
| Date | Agent | Objective ID | Progress | Evidence/PR/Commit | Next Step |
| --- | --- | --- | --- | --- | --- |
| <YYYY-MM-DD> | <agent-name> | <OBJ-1> | <what moved> | <link-or-path> | <next action> |

### Findings Log
| Date | Agent | Area | Finding | Impact | Recommendation |
| --- | --- | --- | --- | --- | --- |
| <YYYY-MM-DD> | <agent-name> | <component> | <observation> | <high/med/low> | <proposal> |

### Decision Log
| Date | Decision | Rationale | Owner | Review Date |
| --- | --- | --- | --- | --- |
| <YYYY-MM-DD> | <decision summary> | <why> | <owner> | <date> |

## Reporting Format (end of task)
- Objective alignment: `<OBJ-ids>`
- What changed: `<files and behavior>`
- Validation: `<tests/checks run>`
- Risks/unknowns: `<open items>`
- Follow-up: `<next suggested step>`

---
""",
    "OBJECTIVES.md": """\
# OBJECTIVES.md

## Objective Framework (OKR)
Use this format for all planning. Every active task should map to one KR.

## Objective Table
| Objective ID | Objective (Outcome) | Owner | Horizon | Status | Confidence |
| --- | --- | --- | --- | --- | --- |
| OBJ-1 | <clear outcome statement> | <owner> | <Qx YYYY> | <on-track/at-risk/off-track> | <high/med/low> |

## Key Results Table
| KR ID | Objective ID | Key Result (Measurable) | Baseline | Target | Current | Due Date | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KR-1.1 | OBJ-1 | <metric target> | <value> | <value> | <value> | <YYYY-MM-DD> | <on-track/at-risk/off-track> |

## Weekly Execution Plan
| Week | KR ID | Planned Actions | Owner | Evidence |
| --- | --- | --- | --- | --- |
| <YYYY-Www> | KR-1.1 | <planned work> | <owner> | <ticket/PR/doc path> |

## Result Log
| Date | KR ID | Result Update | Delta | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| <YYYY-MM-DD> | KR-1.1 | <what changed> | <+/- value> | <link-or-path> | <context> |

## Agent Alignment Notes
- Agents must cite objective and KR IDs when proposing or executing work.
- If work does not map to an objective, classify it as maintenance and justify it.
- Escalate any KR with off-track status in the next progress update.

---
""",
    "sessions.json": "[]\n",
}


@app.post("/api/files/mkdir")
async def make_directory(request: Request):
    """Create a new directory under the user's home directory.

    Body fields:
    - ``path`` (str, required): absolute path of the directory to create.
    - ``scaffold`` (bool, optional): when true, writes WORKSPACE.md, AGENTS.md,
      OBJECTIVES.md, and sessions.json inside the new directory.
    - ``files`` (list[str], optional): additional local file paths to copy into
      the new directory. Each entry must be an absolute path that already exists
      under the user's home directory. The file is copied using its original
      filename; existing scaffold files with the same name are not overwritten.
    """
    body = await request.json()
    raw_path = body.get("path")
    scaffold = bool(body.get("scaffold", False))
    extra_files: list[str] = body.get("files") or []

    if not raw_path:
        return JSONResponse(status_code=400, content={"detail": "Missing path"})

    base = Path.home()
    target = Path(raw_path).resolve()

    if not str(target).startswith(str(base)):
        return JSONResponse(status_code=403, content={"detail": "Access denied"})

    if target.exists():
        return JSONResponse(status_code=409, content={"detail": "Already exists"})

    # Validate extra file paths before creating anything
    resolved_extras: list[Path] = []
    for raw_file in extra_files:
        fp = Path(raw_file).resolve()
        if not str(fp).startswith(str(base)):
            return JSONResponse(
                status_code=403,
                content={"detail": f"Access denied: {raw_file}"},
            )
        if not fp.is_file():
            return JSONResponse(
                status_code=404,
                content={"detail": f"File not found: {raw_file}"},
            )
        resolved_extras.append(fp)

    try:
        target.mkdir(parents=True, exist_ok=False)

        if scaffold:
            for filename, content in _PROJECT_SCAFFOLD.items():
                (target / filename).write_text(content)

        copied = []
        for src in resolved_extras:
            dest = target / src.name
            if not dest.exists():
                shutil.copy2(src, dest)
            copied.append(src.name)
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

    return {"path": str(target), "name": target.name, "copied": copied}


@app.get("/api/secrets/env")
async def get_env_secrets():
    """Return the OpenClaw .env file as a list of key-value entries."""
    if not _ENV_FILE.exists():
        return {"entries": []}
    try:
        text = _ENV_FILE.read_text(errors="replace")
        return {"entries": _parse_env_file(text)}
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})


@app.put("/api/secrets/env")
async def put_env_secrets(request: Request):
    """Overwrite the OpenClaw .env file with the provided key-value entries."""
    body = await request.json()
    entries = body.get("entries", [])
    try:
        _ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
        _ENV_FILE.write_text(_serialize_env_file(entries))
        return {"ok": True}
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})


@app.get("/api/fts/index/{workspace:path}")
def fts_index_get(workspace: str, session_id: str = ""):
    return {"status": "idle", "progress": 0}


@app.post("/api/fts/index/{workspace:path}")
def fts_index_post(workspace: str, session_id: str = ""):
    return {"status": "idle", "progress": 0}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
