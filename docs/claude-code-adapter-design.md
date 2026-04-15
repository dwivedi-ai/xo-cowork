# Claude Code Adapter — Architecture Design

> How `bridge/claude_adapter.py` wraps the `claude` CLI to expose the same API surface as the OpenClaw bridge.

## Why Claude Code as a Backend

The xo-cowork frontend speaks a well-defined OpenYak API (SSE streaming, session management, message history). The OpenClaw bridge implements this contract by proxying to a local OpenClaw runtime.

**Claude Code** (`claude` CLI, v2.1+) is a capable AI agent runtime that:
- Runs entirely locally (or against the Anthropic API)
- Supports non-interactive subprocess mode with structured streaming output
- Has built-in session persistence, tool execution, and reasoning traces
- Emits rich structured events that map cleanly onto the OpenYak SSE protocol

The adapter adds zero new UI requirements — the frontend works unchanged.

---

## Architecture

```
Frontend (Next.js 15)          Claude Adapter (FastAPI)          claude CLI
     :3000              ←→          :8001              ←→       subprocess
                                                              (stream-json output)
```

The adapter is a single FastAPI file (`bridge/claude_adapter.py`) that:
1. Accepts the same API surface as `bridge/main.py`
2. Spawns `claude -p` subprocesses for chat generation
3. Reads `claude`'s NDJSON stream-json output and translates it to SSE events
4. Maintains a thin session index mapping frontend session IDs to Claude session IDs

---

## Claude CLI Capabilities Used

### Non-Interactive Print Mode
```bash
claude -p "prompt text" \
  --output-format stream-json \
  --verbose \
  --resume {claude_session_id}
```

- `-p` / `--print`: Exit after one turn (required for subprocess use)
- `--output-format stream-json`: Emit NDJSON events in real-time
- `--verbose`: Required alongside `-p` for stream-json to emit events as they arrive
- `--resume {id}`: Continue an existing conversation by Claude session ID

### Relevant Flags

| Flag | Used For |
|------|---------|
| `--output-format stream-json` | Structured streaming output |
| `--verbose` | Enables real-time event emission in `-p` mode |
| `--resume {claude_session_id}` | Session continuity |
| `--model {model_id}` | Model selection |
| `--permission-mode auto` | Auto-approve tool executions |
| `--cwd {path}` | Working directory for file operations |
| `--max-budget-usd {n}` | Optional spending cap |
| `--bare` | Skip hooks/plugins for faster automation |

### Stream-JSON Event Types (Claude Output)

| `type` | `subtype` | Contents |
|--------|----------|---------|
| `system` | `init` | `session_id`, model, available tools |
| `assistant` | — | `message.content[]` blocks (text, thinking, tool_use, tool_result) |
| `result` | `success` | `session_id`, `total_cost_usd`, `stop_reason`, `usage` |
| `result` | `error` | `error`, `session_id` |
| `rate_limit_event` | — | Rate limit info |

**`assistant.message.content[]` block types:**

```json
{ "type": "text", "text": "Hello world" }
{ "type": "thinking", "thinking": "Let me reason..." }
{ "type": "tool_use", "id": "call_abc", "name": "Bash", "input": { "command": "ls" } }
{ "type": "tool_result", "tool_use_id": "call_abc", "content": "file1.txt" }
```

---

## Session Storage

Claude Code maintains its own session history internally at `~/.claude/projects/`. The adapter needs a thin index that maps frontend session IDs (what the UI tracks) to Claude's internal session IDs (what `--resume` accepts).

**Storage file:** `~/.claude-adapter/sessions.json`

```json
{
  "sessions": {
    "{frontend_session_id}": {
      "claude_session_id": "ae747f7f-6906-42e5-98f3-1b5164152e1a",
      "title": "What is the capital of France?",
      "created_at": "2024-04-15T12:00:00+00:00",
      "updated_at": "2024-04-15T12:05:00+00:00",
      "model": "claude-sonnet-4-6",
      "cwd": "/Users/me/projects"
    }
  }
}
```

- On **new session**: no `--resume` flag; extract `session_id` from first `type:"system"` event
- On **existing session**: pass `--resume {claude_session_id}`

---

## Streaming Data Flow

```
1.  POST /api/chat/prompt
    ↓ { stream_id, session_id }

2.  Spawn subprocess:
    claude -p "user text"
      --output-format stream-json
      --verbose
      [--resume {claude_session_id}]   ← if existing session
      [--model {model}]
      [--cwd {workspace_path}]
      --permission-mode auto

3.  Store in active_streams[stream_id]:
    { session_id, process, claude_session_id_future }

4.  GET /api/chat/stream/{stream_id}
    ↓ text/event-stream

5.  Read subprocess stdout line-by-line (NDJSON):

    Line: { "type": "system", "subtype": "init", "session_id": "..." }
          → Save claude_session_id to sessions.json (no SSE emitted)

    Line: { "type": "assistant", "message": { "content": [...] } }
          → For each content block:
            text        → emit SSE: event: text-delta
            thinking    → emit SSE: event: reasoning-delta
            tool_use    → emit SSE: event: tool-call
            tool_result → emit SSE: event: tool-result

    Line: { "type": "result", "subtype": "success", ... }
          → emit SSE: event: step-finish  (with tokens + cost)
          → emit SSE: event: done

    Line: { "type": "result", "subtype": "error", ... }
          → emit SSE: event: agent-error

6.  On subprocess stderr or non-zero exit:
    → emit SSE: event: agent-error

7.  POST /api/chat/abort
    → process.kill()
    → emit SSE: event: done
```

---

## SSE Event Mapping

### Claude → SSE Translation

| Claude event | SSE event | SSE data fields |
|-------------|-----------|----------------|
| `system` init | _(internal only)_ | — |
| `assistant` `text` block | `text-delta` | `session_id`, `text` |
| `assistant` `thinking` block | `reasoning-delta` | `session_id`, `text` |
| `assistant` `tool_use` block | `tool-call` | `session_id`, `tool`, `call_id`, `arguments`, `title` |
| `assistant` `tool_result` block | `tool-result` | `session_id`, `call_id`, `output` |
| `result` success | `step-finish` | `session_id`, `tokens`, `cost`, `reason` |
| `result` success | `done` | `session_id`, `finish_reason` |
| `result` error | `agent-error` | `session_id`, `error_message` |

### SSE Wire Format

```
id: 1
event: text-delta
data: {"session_id": "...", "text": "Hello"}

id: 2
event: tool-call
data: {"session_id": "...", "tool": "Bash", "call_id": "call_abc", "arguments": {"command": "ls"}, "title": "Bash"}

id: 3
event: tool-result
data: {"session_id": "...", "call_id": "call_abc", "output": "file1.txt\nfile2.txt"}

id: 4
event: step-finish
data: {"session_id": "...", "reason": "stop", "tokens": {"input": 100, "output": 50, "cache_read": 0, "cache_write": 0}, "cost": 0.00042}

id: 5
event: done
data: {"session_id": "...", "finish_reason": "stop"}
```

---

## Model Routing

The frontend sends a `model` field in `PromptRequest`. The adapter maps this to Claude model IDs:

| Frontend model string | Claude model ID |
|----------------------|----------------|
| `claude/sonnet` | `claude-sonnet-4-6` |
| `claude/opus` | `claude-opus-4-6` |
| `claude/haiku` | `claude-haiku-4-5-20251001` |
| `claude-sonnet-4-6` (passthrough) | `claude-sonnet-4-6` |
| anything else / omitted | `claude-sonnet-4-6` (default) |

The `/api/models` endpoint returns these as selectable options in the frontend.

---

## Process Management

```python
active_streams: dict[str, dict] = {}

# Entry shape:
{
  "session_id": str,               # Frontend session ID
  "process": asyncio.Process,      # The claude subprocess
  "claude_session_id": str | None, # Extracted from system init event
  "model": str,                    # Claude model ID
}
```

- Processes are stored on `POST /api/chat/prompt` and cleaned up on `done`/`agent-error`/abort
- `POST /api/chat/abort` calls `process.kill()` followed by `process.wait()`
- Leaked processes (frontend closed without abort) are cleaned up when the SSE generator exits

---

## Endpoints Implemented

### Functional

| Method | Path | Implementation |
|--------|------|---------------|
| GET | `/health` | `{"status": "ok"}` |
| POST | `/api/chat/prompt` | Spawn subprocess, return `{stream_id, session_id}` |
| GET | `/api/chat/stream/{stream_id}` | SSE from subprocess stdout |
| POST | `/api/chat/abort` | Kill subprocess |
| GET | `/api/sessions` | Read `~/.claude-adapter/sessions.json` |
| GET | `/api/sessions/search` | Case-insensitive title filter |
| GET | `/api/sessions/{id}` | Single session lookup |
| PATCH | `/api/sessions/{id}` | Update `directory` or `title` |
| GET | `/api/messages/{session_id}` | _(stub — returns empty)_ |
| GET | `/api/models` | Available Claude models |
| GET | `/api/usage` | _(stub — returns zeros)_ |

### Stub (same 200 responses as OpenClaw bridge)

All remaining endpoints from the OpenClaw bridge surface return identical stub responses so the frontend doesn't error on any page:
`/api/agents`, `/api/tools`, `/api/skills`, `/api/connectors`, `/api/channels`, `/api/config/*`, `/api/files/*`, `/api/secrets/*`, `/api/automations`, `/api/plugins/status`, etc.

---

## Differences from OpenClaw Bridge

| Concern | OpenClaw Bridge | Claude Code Adapter |
|---------|----------------|---------------------|
| Backend runtime | OpenClaw HTTP API | `claude` CLI subprocess |
| Session storage | `~/.openclaw/agents/*/sessions/*.jsonl` | `~/.claude-adapter/sessions.json` index; Claude manages JSONL internally |
| Message history | Read from JSONL, convert to OpenYak | Stub (returns empty; history lives inside Claude's `~/.claude/` storage) |
| Streaming | Proxies OpenAI-compatible SSE | Reads NDJSON from subprocess stdout |
| Tool events | Not emitted (text-delta only) | Full `tool-call` / `tool-result` events emitted |
| Reasoning | Not emitted | `reasoning-delta` emitted from `thinking` blocks |
| Agent management | Full CRUD via `openclaw.json` | Single "claude" agent, model list only |
| Config files | `~/.openclaw/openclaw.json` | `~/.claude-adapter/sessions.json` |

---

## Running the Adapter

```bash
# Start adapter on port 8001
cd bridge
uv run uvicorn claude_adapter:app --host 0.0.0.0 --port 8001 --reload

# Point frontend at adapter
NEXT_PUBLIC_API_URL=http://localhost:8001 npm run dev --prefix ../frontend
```

Environment variables:
```
CLAUDE_BIN=/Users/me/.local/bin/claude   # Path to claude CLI (auto-detected if on PATH)
CLAUDE_DEFAULT_MODEL=claude-sonnet-4-6   # Default model
CLAUDE_PERMISSION_MODE=auto              # auto | dontAsk | default
CLAUDE_CWD=~                             # Default working directory
CORS_ORIGINS=http://localhost:3000       # Same as OpenClaw bridge
```

---

## Verification Checklist

1. `POST /api/chat/prompt` → returns `{stream_id, session_id}`
2. `GET /api/chat/stream/{stream_id}` → `text-delta` events arrive with Claude's response
3. Send follow-up message in same session → `--resume` flag used, context preserved
4. Long generation + click stop → subprocess killed, `done` event emitted
5. `GET /api/sessions` → session list populated after first chat
6. Reasoning model → `reasoning-delta` events appear in UI
7. Tool use (e.g. ask Claude to list files) → `tool-call` + `tool-result` events visible
