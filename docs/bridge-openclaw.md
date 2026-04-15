# OpenClaw Bridge — Architecture & API Reference

> How `bridge/main.py` connects the xo-cowork frontend to the OpenClaw AI agent runtime.

## Overview

```
Frontend (Next.js 15)          Bridge (FastAPI)          OpenClaw API
     :3000              ←→          :8000              ←→    :18789
```

The bridge is a single-file FastAPI server (`bridge/main.py`, ~2080 lines) that does three things:

1. **Reads** OpenClaw's file-based session/message storage from `~/.openclaw/agents/*/sessions/`
2. **Translates** OpenClaw's JSONL record format into the OpenYak API schema the frontend expects
3. **Proxies** outgoing chat messages to OpenClaw's OpenAI-compatible endpoint and translates the streaming response into SSE events

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated allowed origins |
| `OPENCLAW_API_URL` | `http://127.0.0.1:18789/v1/chat/completions` | OpenClaw chat completions endpoint |
| `OPENCLAW_API_KEY` | `xo-cowork` | Bearer token for OpenClaw requests |
| `OPENCLAW_MODEL` | `openclaw/default` | Model string sent to OpenClaw |

---

## On-Disk File Layout

```
~/.openclaw/
├── openclaw.json                     # Agent list + auth profiles + workspace defaults
├── workspace/                        # Default workspace (for "main" agent)
└── agents/
    └── {agent_id}/
        ├── sessions/
        │   ├── sessions.json         # Index: { session_key → { sessionId, directory, updatedAt, … } }
        │   └── {session_id}.jsonl    # Append-only JSONL message log
        └── agent/
            ├── models.json
            ├── auth-state.json
            └── auth-profiles.json
```

### `openclaw.json` Structure

```json
{
  "agents": {
    "list": [
      {
        "id": "main",
        "name": "Main Agent",
        "workspace": "/Users/me/projects",
        "model": "claude-3-5-sonnet-20241022",
        "identity": { "name": "Aria", "emoji": "🤖", "bio": "..." }
      }
    ],
    "defaults": { "workspace": "/Users/me/.openclaw/workspace" }
  },
  "auth": {
    "profiles": {
      "profile_id": {
        "provider": "anthropic",
        "mode": "api_key",
        "key": "sk-ant-…"
      }
    }
  }
}
```

### `sessions.json` Structure

```json
{
  "session-key-uuid": {
    "sessionId": "session-uuid",
    "directory": "/Users/me/projects/my-app",
    "updatedAt": 1713200000000,
    "title": "Optional cached title"
  }
}
```

### JSONL Record Format

Each line in `{session_id}.jsonl` is a JSON object. The bridge only processes records with `"type": "message"`. Key fields:

```json
{
  "type": "message",
  "id": "msg_abc123",
  "role": "user | assistant | toolResult",
  "timestamp": 1713200000000,
  "content": [
    { "type": "text", "text": "Hello" },
    { "type": "thinking", "thinking": "Let me reason…" },
    {
      "type": "toolCall",
      "toolCallId": "call_xyz",
      "toolName": "bash",
      "toolInput": { "command": "ls" }
    },
    {
      "type": "toolResult",
      "toolCallId": "call_xyz",
      "toolResult": "file1.txt\nfile2.txt",
      "isError": false
    }
  ],
  "model": "claude-3-5-sonnet-20241022",
  "usage": {
    "inputTokens": 100,
    "outputTokens": 50,
    "cacheCreationInputTokens": 0,
    "cacheReadInputTokens": 0
  },
  "costUSD": 0.00042
}
```

---

## In-Memory State

```python
active_streams: dict[str, dict] = {}
```

Keyed by `stream_id` (UUID). Two shapes:

**Prefetched (new session):**
```python
{
  "session_id": "...",
  "response_text": "Full response text",
  "prefetched": True
}
```

**Live (existing session):**
```python
{
  "session_id": "...",
  "text": "User's message",
  "session_key": "openclaw-session-key"
}
```

---

## API Endpoints

### Chat

#### `POST /api/chat/prompt`
Send a user message and start a generation stream.

**Request:**
```json
{
  "text": "What is 2+2?",
  "session_id": "existing-session-uuid",
  "model": "openclaw/main"
}
```
`session_id` is optional. If omitted, a new session is created.

**Response:**
```json
{ "stream_id": "uuid", "session_id": "uuid" }
```

**Internal flow:**
- New session → non-streaming request to OpenClaw, full response stored in `active_streams[stream_id]` as `prefetched`
- Existing session → finds the OpenClaw session key, stores `text` + `session_key` in `active_streams`

#### `GET /api/chat/stream/{stream_id}`
Open the SSE stream for a pending generation.

**Response:** `text/event-stream`

For **prefetched** streams: emits the pre-fetched text in 4-byte chunks as `text-delta` events, then `done`.

For **live** streams: opens `POST {OPENCLAW_API_URL}` with:
```json
{
  "model": "openclaw/default",
  "stream": true,
  "messages": [{ "role": "user", "content": "..." }]
}
```
Headers: `Authorization: Bearer {key}`, `x-openclaw-session-key: {key}`

Reads OpenAI-compatible `data: {...}` chunks, extracts `choices[0].delta.content`, and emits `text-delta` events.

**SSE wire format:**
```
id: 1
event: text-delta
data: {"session_id": "uuid", "text": "Hello"}

id: 2
event: done
data: {"session_id": "uuid", "finish_reason": "stop"}
```

**Event types emitted by current bridge:** `text-delta`, `done`, `agent-error`

**Event types the frontend can handle** (for richer adapters): `text-delta`, `reasoning-delta`, `tool-call`, `tool-result`, `tool-error`, `step-start`, `step-finish`, `permission-request`, `question`, `plan-review`, `title-update`, `compaction-start`, `compaction-phase`, `compacted`, `done`, `agent-error`, `desync`, `model-loading`, `retry`

#### `POST /api/chat/abort`
Cancel an in-progress generation.

**Request:** `{ "stream_id": "uuid" }`
**Response:** `{ "ok": true }`

Internal: removes `stream_id` from `active_streams`. Does not kill any subprocess (OpenClaw handles its own lifecycle).

#### `POST /api/chat/respond` — _stub_
**Response:** `{ "ok": true }`

---

### Sessions

#### `GET /api/sessions?limit=50&offset=0`
List all sessions across all agents, sorted by `updatedAt` descending.

**Response:** Array of `SessionResponse`:
```json
[
  {
    "id": "session-uuid",
    "title": "First user message (truncated)",
    "time_created": "2024-04-15T12:00:00+00:00",
    "time_updated": "2024-04-15T12:05:00+00:00",
    "agent": "main",
    "model": null,
    "directory": "/Users/me/projects"
  }
]
```

Title is derived from the first non-HEARTBEAT user message text in the JSONL file.

#### `GET /api/sessions/search?q=&limit=20&offset=0`
Case-insensitive title filter. Returns `[{ "session": SessionResponse, "snippet": "..." }]`.

#### `GET /api/sessions/{session_id}`
Returns a single `SessionResponse`. 404 if not found.

#### `PATCH /api/sessions/{session_id}`
Update the `directory` associated with a session.

**Request:** `{ "directory": "/path/to/workspace" }`
**Response:** `{ "ok": true, "session_id": "...", "directory": "..." }`

Writes back to `sessions.json`. Maintains history of up to 200 entries.

#### `POST /api/sessions` — _stub_
Returns `{ "id": "uuid", "title": "New Chat" }`. Sessions are actually created on first chat prompt.

#### `DELETE /api/sessions/{session_id}` — _stub_
Returns `{ "ok": true }`.

---

### Messages

#### `GET /api/messages/{session_id}?limit=50&offset=-1`
Load messages for a session. `offset=-1` means tail by `limit`.

**Response:**
```json
{
  "total": 10,
  "offset": 0,
  "messages": [ MessageResponse ]
}
```

**`MessageResponse` shape:**
```json
{
  "id": "msg_abc123",
  "session_id": "session-uuid",
  "time_created": "2024-04-15T12:00:00+00:00",
  "data": {
    "role": "assistant",
    "model_id": "claude-3-5-sonnet-20241022",
    "provider_id": null,
    "cost": 0.00042,
    "tokens": {
      "input": 100,
      "output": 50,
      "reasoning": 0,
      "cache_read": 0,
      "cache_write": 0
    },
    "finish": "stop",
    "error": null
  },
  "parts": [ MessagePart ]
}
```

**`MessagePart` shapes:**

_Text part:_
```json
{ "id": "part-id", "message_id": "...", "session_id": "...", "time_created": "...",
  "data": { "type": "text", "text": "Hello!" } }
```

_Reasoning part:_
```json
{ "data": { "type": "reasoning", "text": "Let me think…" } }
```

_Tool part:_
```json
{
  "data": {
    "type": "tool",
    "tool": "bash",
    "call_id": "call_xyz",
    "state": {
      "status": "completed",
      "input": { "command": "ls" },
      "output": "file1.txt\nfile2.txt",
      "metadata": null,
      "title": "bash",
      "time_start": "2024-04-15T12:00:01+00:00",
      "time_end": "2024-04-15T12:00:02+00:00",
      "time_compacted": null
    }
  }
}
```

---

### Agents

#### `GET /api/agents`
Lists agents from `openclaw.json`. Returns `[AgentInfo]`.

```json
[{ "id": "main", "name": "Main Agent", "model": "...", "workspace": "...", "identity": {...} }]
```

#### `POST /api/agents`
Create a new agent. Request body: `{ "name": "My Agent", "id": "my-agent", "workspace": "/path" }`.

- `id` is validated and normalized (lowercase, alphanumeric + `-_`, max 64 chars)
- `"main"` is reserved
- Creates `~/.openclaw/agents/{id}/sessions/` + `sessions.json`
- Appends to `openclaw.json` agents list

#### `GET /api/agents/{agent_id}`
Full agent snapshot including: config, workspace files (IDENTITY.md, SOUL.md, etc.), auth profiles, sessions index.

#### `PATCH /api/agents/{agent_id}`
Update fields: `name`, `description`, `workspace`, `model`, `identity_name`, `identity_emoji`.

---

### Models

#### `GET /api/models`
Returns one model entry per configured agent.

```json
[{
  "id": "openclaw/main",
  "name": "Main Agent",
  "capabilities": {
    "function_calling": true,
    "vision": true,
    "reasoning": true,
    "json_output": true,
    "max_context": 200000,
    "max_output": 8192
  }
}]
```

---

### Config & Status

#### `GET /api/config/openclaw`
Returns the full `openclaw.json` with secrets masked (API keys, tokens, passwords replaced with `"***"`). 404 if file doesn't exist.

#### `GET /api/channels/openclaw/status`
Probes `OPENCLAW_API_URL` with a GET request to check if OpenClaw is running.

```json
{ "installed": true, "running": true, "port": 18789, "ws_url": null }
```

#### `GET /api/codex/status`
Reads OpenAI Codex auth from `openclaw.json`.

```json
{ "is_connected": true, "email": "user@example.com" }
```

#### Stub config endpoints

| Endpoint | Returns |
|----------|---------|
| `GET /api/config/providers` | `[]` |
| `GET /api/config/openai-subscription` | `{"is_connected": false, "email": "", "needs_reauth": false}` |
| `GET /api/config/ollama` | `{"installed": false}` |
| `GET /api/config/local` | `{"available": false}` |
| `GET /api/config/api-key` | `{"has_key": true, "provider": "openclaw"}` |
| `GET /api/ollama/status` | `{"binary_installed": false, "running": false}` |
| `GET /api/openyak-account` | `{"linked": false}` |

---

### Files

#### `POST /api/files/upload`
Upload a file. Deduplicates by SHA-256 hash. Saves to workspace dir or `~/uploads` as fallback.

**Request:** `multipart/form-data` with `file` + optional `workspace` field.

**Response:**
```json
{
  "file_id": "uuid",
  "name": "document.pdf",
  "path": "/Users/me/workspace/document.pdf",
  "size": 102400,
  "mime_type": "application/pdf",
  "source": "uploaded",
  "content_hash": "sha256hex"
}
```

#### `POST /api/files/list-directory`
**Request:** `{ "path": "/Users/me/projects" }`
**Response:** `{ "path": "...", "parent": "...", "dirs": [{name, path}], "files": [{name, path}] }`
Path must be within home directory (security check).

#### `POST /api/files/content`
**Request:** `{ "path": "/Users/me/file.txt" }`
**Response:** `{ "content": "...", "path": "..." }`

#### `POST /api/files/content-binary`
**Request:** `{ "path": "/Users/me/image.png" }`
**Response:** `FileResponse` (binary download)

#### `POST /api/files/mkdir`
**Request:** `{ "path": "/new/dir", "scaffold": true, "files": ["extra.md"] }`

If `scaffold=true`, creates: `WORKSPACE.md`, `AGENTS.md`, `OBJECTIVES.md`, `sessions.json`.

#### Stub file endpoints
`GET /api/sessions/{id}/todos`, `GET /api/sessions/{id}/files`, all `/api/workspace-memory/*`, all `/api/fts/index/*`

---

### Secrets

#### `GET /api/secrets/env`
Reads `~/.openclaw/.env`. Returns `{ "entries": [{ "key": "API_KEY", "value": "..." }] }`.

#### `PUT /api/secrets/env`
**Request:** `{ "entries": [{ "key": "API_KEY", "value": "..." }] }`
Overwrites `~/.openclaw/.env` with the provided key-value pairs.

---

### Usage Analytics

#### `GET /api/usage?days=30`
Aggregates token usage and cost from all JSONL files across all agents.

**Response:** (abbreviated)
```json
{
  "total": { "messages": 150, "input_tokens": 50000, "output_tokens": 20000, "cost_usd": 1.23 },
  "by_day": [{ "date": "2024-04-15", "messages": 10, "cost_usd": 0.08, ... }],
  "by_model": [{ "model": "claude-3-5-sonnet-20241022", "messages": 100, "cost_usd": 1.10, ... }],
  "by_session": [{ "session_id": "...", "title": "...", "messages": 5, ... }]
}
```

---

## Message Conversion Pipeline

`convert_messages(session_id, records)` in `bridge/main.py` line ~414.

```
OpenClaw JSONL record (type: "message")
         │
         ├─ role: "user"       → UserMessage  with text parts
         ├─ role: "assistant"  → AssistantMessage with text/reasoning/tool parts
         └─ role: "toolResult" → Attaches output to prior assistant tool part
```

**Thinking block stripping:** Leading `[[...]]` markers are removed from assistant text blocks.

**Tool result attachment:** Finds the last `tool` part in prior assistant messages matching `call_id`, sets `state.output` and `state.status`.

---

## Key Helper Functions

| Function | Lines | Purpose |
|----------|-------|---------|
| `ms_to_iso(ms)` | 90 | `int ms → ISO8601 string` |
| `iso_now()` | 94 | Current UTC ISO timestamp |
| `short_id()` | 98 | 8-char hex from UUID |
| `parse_jsonl(path)` | 254 | Read JSONL file, skip malformed lines |
| `derive_title(records)` | 264 | First non-HEARTBEAT user text (truncated 80 chars) |
| `normalize_agent_id(value)` | 102 | Lowercase, strip invalid chars, max 64 chars |
| `load_openclaw_config()` | 160 | Safe read of `openclaw.json` |
| `write_openclaw_config(cfg)` | 171 | Atomic write to `openclaw.json` |
| `resolve_agent_workspace_dir(cfg, id)` | 138 | Workspace path with fallback chain |
| `find_session_file(session_id)` | 344 | Locate JSONL file across all agents |
| `find_session_key(session_id)` | 357 | Find OpenClaw session key for proxying |
| `_path_must_be_under_home(path)` | 221 | Security: reject paths outside `~` |
| `_redact_secrets_nested(obj)` | 1066 | Mask `key/token/secret/password` fields |
