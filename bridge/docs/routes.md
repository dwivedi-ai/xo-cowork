# Bridge route map

The bridge is a FastAPI server that adapts OpenClaw's file-based storage and
OpenAI-compatible chat API into the shape xo-cowork's frontend expects. This
document maps every route file under `bridge/routes/` to the endpoints and
functions it contains.

Entry point: `main.py` creates the FastAPI app, installs CORS, and mounts
each router. Every route module exposes one `router: APIRouter` and is
collected by `routes/__init__.py` into `all_routers`.

For how requests actually reach the bridge from the browser, see
[`request-flow.md`](./request-flow.md).

## Module layout

```
bridge/
├── main.py                  # app + CORS + mount routers + uvicorn entry
├── config.py                # env vars, paths, constants, shared state
├── helpers.py               # time/id utils, masking, safe readers
├── openclaw_store.py        # openclaw.json + agent entries + disk seeding
├── openclaw_env.py          # ~/.openclaw/.env parser + upsert helpers
├── sessions_io.py           # session JSONL discovery & directory updates
├── messages.py              # OpenClaw record → xo-cowork MessageResponse
├── streaming.py             # SSE stream + new-session bootstrap
└── routes/
    ├── __init__.py          # router aggregation → all_routers list
    ├── health.py
    ├── sessions.py
    ├── chat.py
    ├── agents.py
    ├── config_routes.py
    ├── channels.py
    ├── files.py
    ├── workspace_memory.py
    ├── secrets.py
    ├── usage.py
    ├── fts.py
    └── misc.py
```

Support modules (not under `routes/`) are referenced from multiple route
files. See the short summary at the end of this document for what each one
holds.

---

## `routes/health.py`

Liveness probe. One endpoint.

| Function | Method + path | Purpose |
| --- | --- | --- |
| `health` | `GET /health` | Returns `{"status": "ok"}`. Used by the desktop launcher and CI to confirm the bridge is up. |

---

## `routes/sessions.py`

Covers the `/api/sessions/*` CRUD surface and `/api/messages/{id}`.

> **Ordering note:** `/api/sessions/search` must register before
> `/api/sessions/{session_id}` so FastAPI doesn't match `search` as a
> session id. The module registers the read-side routes in that order
> explicitly.

| Function | Method + path | Purpose |
| --- | --- | --- |
| `list_sessions` | `GET /api/sessions` | Paginated list of all sessions across agents, sorted most-recent first. |
| `search_sessions` | `GET /api/sessions/search` | Title substring search over the session list. |
| `get_session` | `GET /api/sessions/{session_id}` | Single-session lookup; returns 404 if not found. |
| `get_messages` | `GET /api/messages/{session_id}` | Paginated messages for a session. Reads the JSONL file, converts to xo-cowork shape via `messages.convert_messages`. Supports tail-paging when `offset = -1`. |
| `create_session` | `POST /api/sessions` | Returns a synthetic id; real session creation happens via `/api/chat/prompt`. Kept for frontend compatibility. |
| `update_session` | `PATCH /api/sessions/{session_id}` | Persists a new `directory` onto the matching `sessions.json` entry via `sessions_io.update_session_directory`. |
| `delete_session` | `DELETE /api/sessions/{session_id}` | Currently a no-op stub (`{"ok": true}`). |
| `session_todos` | `GET /api/sessions/{session_id}/todos` | Stub returning `{"todos": []}`. |
| `session_files` | `GET /api/sessions/{session_id}/files` | Stub returning `{"files": []}`. |

---

## `routes/chat.py`

Chat prompt / streaming / abort endpoints. Uses `config.active_streams` as
the shared dictionary of in-flight stream state.

| Function | Method + path | Purpose |
| --- | --- | --- |
| `chat_prompt` | `POST /api/chat/prompt` | Branches on whether a `session_id` is supplied. New session: starts a background `create_new_session` task and polls `sessions.json` for the new id, returning a `stream_id` whose SSE stream replays the prefetched response. Existing session: looks up the session key and registers a streaming job. |
| `chat_stream` | `GET /api/chat/stream/{stream_id}` | SSE endpoint consumed by the frontend. Dispatches to `stream_openclaw_to_sse` for regular chats or `emit_prefetched_sse` for prefetched first-message flows. Returns an error event if `stream_id` is unknown. |
| `chat_abort` | `POST /api/chat/abort` | Removes the given `stream_id` from `active_streams`, effectively cancelling it before the SSE consumer reads it. |
| `chat_respond` | `POST /api/chat/respond` | Stub (`{"ok": true}`) kept for frontend compatibility. |

---

## `routes/agents.py`

Agent CRUD. Translates OpenClaw's `agents.list` plus on-disk layout into the
xo-cowork `AgentInfo` shape, and persists changes back via
`openclaw_store.write_openclaw_config`.

**Pydantic request bodies**

- `CreateAgentBody` — `name` (required), optional `id`, `description`,
  `workspace`. Used by `POST /api/agents`.
- `UpdateAgentBody` — all fields optional: `name`, `description`,
  `workspace`, `model`, `identity_name`, `identity_emoji`. Used by
  `PATCH /api/agents/{id}`.

**Module-private helpers**

- `_agent_info_for_id(cfg, agent_id, display_name, description)` — builds
  the xo-cowork `AgentInfo` record. `name` is the normalized OpenClaw agent
  id so session grouping matches up.
- `get_agent_detail(agent_id)` — full agent snapshot: openclaw.json entry,
  workspace markdown docs, on-disk `models.json` / `auth-state.json` /
  redacted `auth-profiles.json`, session-index summary, and a non-secret
  view of global auth profiles. Returns `None` if the agent directory
  doesn't exist.
- `patch_agent_into_config(cfg, agent_id, body)` — pure function that
  returns a new `cfg` dict with the requested fields updated. Raises
  `ValueError` when a workspace path escapes the user's home. Callers are
  responsible for persisting with `write_openclaw_config`.

| Function | Method + path | Purpose |
| --- | --- | --- |
| `list_agents` | `GET /api/agents` | Walks `~/.openclaw/agents/*` and emits an `AgentInfo` per directory, enriched with config metadata where present. |
| `create_agent` | `POST /api/agents` | Validates the new id (`main` is reserved, must be unique, must be under `$HOME`), updates `openclaw.json`, seeds the on-disk layout via `ensure_openclaw_agent_disk`, then returns the `AgentInfo`. |
| `get_agent` | `GET /api/agents/{agent_id}` | Returns `get_agent_detail(agent_id)` or 404. |
| `patch_agent` | `PATCH /api/agents/{agent_id}` | Applies `UpdateAgentBody` via `patch_agent_into_config`, writes `openclaw.json`, and returns the updated detail. Empty bodies return the current detail unchanged. |

---

## `routes/config_routes.py`

Named `config_routes.py` (not `config.py`) to avoid shadowing the top-level
`config` module. Covers `/api/config/*` and the model listing at
`/api/models`.

**Helpers**

- `list_openclaw_models()` — emits one `model` row per OpenClaw agent so
  the UI can select `openclaw/<agentId>`. Falls back to a single
  `openclaw/main` entry when no agents exist on disk.

| Function | Method + path | Purpose |
| --- | --- | --- |
| `list_models` | `GET /api/models` | Returns `list_openclaw_models()`. |
| `config_api_key` | `GET /api/config/api-key` | Reports `{"has_key": true, "provider": "openclaw"}` (bridge is always considered configured). |
| `config_providers` | `GET /api/config/providers` | Empty list — bridge exposes OpenClaw only. |
| `openai_subscription` | `GET /api/config/openai-subscription` | Stub reporting no connected OpenAI subscription. |
| `openyak_account` | `GET /api/config/openyak-account` | Stub reporting `{"linked": false}`. |
| `ollama_config` | `GET /api/config/ollama` | Stub reporting `{"installed": false}`. |
| `local_provider` | `GET /api/config/local` | Stub reporting `{"available": false}`. |
| `get_openclaw_config` | `GET /api/config/openclaw` | Returns the full `openclaw.json` with sensitive fields masked by `helpers._mask_sensitive`. 404s if the file is missing. |
| `save_provider_key` | `POST /api/config/providers/{provider_id}/key` | Onboarding "Save Key" target. Looks up `provider_id` in `PROVIDER_PROVISIONING` (currently `anthropic`, `openai`), upserts the provider's env var into `~/.openclaw/.env` via `openclaw_env.upsert_env_entry`, and spawns `_run_provider_provisioning` as a background task. Returns `{"ok": true, "provisioning": "started"}` as soon as the `.env` write completes. The CLI chain (`openclaw models set …`, `openclaw config set …`) runs asynchronously; its stdout/stderr is appended to `~/.openclaw/bridge-provisioning.log` and the chain aborts on the first non-zero exit. Unknown providers → 400. |

---

## `routes/channels.py`

Channel provisioning writes. `GET /api/channels` and `GET /api/channels/openclaw/status` still live in `routes/misc.py`; this file owns the write path introduced by the onboarding Channels step.

| Function | Method + path | Purpose |
| --- | --- | --- |
| `add_channel` | `POST /api/channels/add` | Onboarding Channels step target. Body is `{platform, …tokens}`. Looks up `platform` in `CHANNEL_PROVISIONING` (`slack`, `telegram`, `discord`), upserts each required token into `~/.openclaw/.env` via `openclaw_env.upsert_env_entry`, then — if the platform has either a `config_batch` or any `post_commands` — spawns `_run_provisioning_bg` as a **background task** and returns `{ok: true, restart_required: true, provisioning: "started"}` immediately. The CLI chain (`openclaw config set --batch-json <recipe>` followed by each `post_commands` argv, e.g. `openclaw config set plugins.entries.slack.enabled true`) runs asynchronously with a 30 s per-step timeout and aborts on the first non-zero exit so a failed batch doesn't leave plugins half-enabled. Tokens are always referenced by env-var name in the batch (`"ref": {"id": "SLACK_BOT_TOKEN"}`) — their values never enter argv. Stdout/stderr for every step lands in `~/.openclaw/bridge-provisioning.log`. Platforms with no CLI chain (currently Discord) short-circuit after the `.env` write and return `restart_required: false, provisioning: "skipped"`. The handler only returns non-200 for shape errors (400 unknown/missing platform, 400 missing token, 500 failed `.env` write) — CLI failures are only visible in the log, mirroring the provider-key flow in `config_routes.py`. |

---

## `routes/files.py`

Workspace / filesystem endpoints under `/api/files/*`. All reads and writes
are clamped to `$HOME` — any path resolving outside returns `403`.

**Helpers**

- `_PROJECT_SCAFFOLD` — dict of filename → template text used by
  `make_directory` when `scaffold: true` is requested. Includes
  `WORKSPACE.md`, `AGENTS.md`, `OBJECTIVES.md`, and an empty
  `sessions.json`.

| Function | Method + path | Purpose |
| --- | --- | --- |
| `upload_file` | `POST /api/files/upload` | Multipart upload → writes the file into the supplied `workspace` (or `~/uploads` fallback). Collisions with different content get a `_<hash>` suffix. Returns id, path, size, and SHA-256. |
| `list_directory` | `POST /api/files/list-directory` | Lists a directory; dirs sort first, then files. Hides permission errors. Returns `path`, `parent`, `dirs`, `files`. |
| `file_content` | `POST /api/files/content` | Reads a text file with `errors="replace"`. |
| `file_content_binary` | `POST /api/files/content-binary` | Returns a `FileResponse` so the browser can download the file. |
| `file_save` | `POST /api/files/save` | Writes UTF-8 text content to a file under `$HOME`. Body `{path, content}`. Creates parent directories if missing. Used by the onboarding Personality step to persist the agent's `IDENTITY.md` / `SOUL.md` / `AGENTS.md` / `USER.md`. 400 on missing or non-string fields, 403 if the path escapes `$HOME`. |
| `make_directory` | `POST /api/files/mkdir` | Creates a new directory. Optional `scaffold` writes the xo-cowork workspace files; optional `files` copies existing files (validated for existence and home-scope) into the new directory. Returns the created path and the list of copied filenames. |

---

## `routes/workspace_memory.py`

All endpoints are stubs today. The frontend calls them to drive a
per-workspace memory feature (not yet wired up in the bridge).

| Function | Method + path | Purpose |
| --- | --- | --- |
| `workspace_memory` | `GET /api/workspace-memory` | `{"memory": null}`. |
| `workspace_memory_list` | `GET /api/workspace-memory/list` | Empty list. |
| `workspace_memory_update` | `PUT /api/workspace-memory` | `{"ok": true}`. |
| `workspace_memory_delete` | `DELETE /api/workspace-memory` | `{"ok": true}`. |
| `workspace_memory_refresh` | `POST /api/workspace-memory/refresh` | `{"ok": true}`. |
| `workspace_memory_export` | `POST /api/workspace-memory/export` | `{"ok": true}`. |

---

## `routes/secrets.py`

Backed by `~/.openclaw/.env`.

**Helpers**

- `_parse_env_file(text)` — splits into `{key, value}` entries, skipping
  blank lines and `#` comments.
- `_serialize_env_file(entries)` — inverse; always ensures a trailing
  newline when there's at least one entry.

| Function | Method + path | Purpose |
| --- | --- | --- |
| `get_env_secrets` | `GET /api/secrets/env` | Returns parsed `.env` entries, or an empty list if the file doesn't exist. |
| `put_env_secrets` | `PUT /api/secrets/env` | Overwrites the `.env` with the serialized entries. Creates the parent directory if needed. |

---

## `routes/usage.py`

Aggregated usage across all OpenClaw agents/sessions within a time window.

| Function | Method + path | Purpose |
| --- | --- | --- |
| `usage` | `GET /api/usage?days=30` | Walks `~/.openclaw/agents/*/sessions/*.jsonl`, sums assistant tokens and cost, buckets by day / model / session, and measures user→assistant latency. `days` is clamped to `[1, 365]`. Returns the `UsageStats` shape consumed by `frontend/src/types/usage.ts`. |

The body contains one local helper, `_empty_tokens()`, used to seed
per-model token counters.

---

## `routes/fts.py`

Full-text search index endpoints; currently stubbed.

| Function | Method + path | Purpose |
| --- | --- | --- |
| `fts_index_get` | `GET /api/fts/index/{workspace:path}` | `{"status": "idle", "progress": 0}`. |
| `fts_index_post` | `POST /api/fts/index/{workspace:path}` | Same stub response — placeholder for "trigger reindex". |

---

## `routes/misc.py`

Grab-bag of small status / listing endpoints. Most are empty-list stubs so
the frontend doesn't error, but a couple do real work.

**Empty-list stubs**

| Function | Method + path | Purpose |
| --- | --- | --- |
| `list_tools` | `GET /api/tools` | `[]` |
| `list_skills` | `GET /api/skills` | `[]` |
| `chat_active` | `GET /api/chat/active` | `[]` |
| `mcp_status` | `GET /api/mcp/status` | `[]` |
| `list_connectors` | `GET /api/connectors` | `[]` |
| `list_channels` | `GET /api/channels` | `[]` |
| `list_automations` | `GET /api/automations` | `[]` |
| `plugins_status` | `GET /api/plugins/status` | `{}` |
| `ollama_status` | `GET /api/ollama/status` | `{"binary_installed": false, "running": false}` |

**Active integration probes**

| Function | Method + path | Purpose |
| --- | --- | --- |
| `openclaw_status` | `GET /api/channels/openclaw/status` | Sends a quick `httpx.get` to the OpenClaw gateway (3 s timeout) and reports whether it's reachable; includes the port when it is. |
| `codex_status` | `GET /api/codex/status` | Scans `openclaw.json` and the `main` agent's `auth-profiles.json` for `openai-codex` profiles. Returns deduplicated account entries. Uses a nested `_collect(profiles_obj)` helper. |

---

## Supporting modules (not in `routes/`)

These files don't expose routes but are imported by most of them. A brief
tour so you know where the building blocks live:

| Module | Holds |
| --- | --- |
| `config.py` | `CORS_ORIGINS`, OpenClaw path/env constants, agent-id regexes, workspace-doc filename tuples, `OPENCLAW_MODEL_CAPABILITIES`, `active_streams` shared dict. |
| `helpers.py` | `ms_to_iso`, `iso_now`, `short_id`, `normalize_agent_id`, `parse_jsonl`, `derive_title`, `_path_must_be_under_home`, bounded-text/json file readers, secret redaction/masking utilities. |
| `openclaw_store.py` | `openclaw.json` load/write, `agents.list` traversal, `resolve_agent_workspace_dir`, `apply_agent_list_entry`, `seed_agent_workspace`, `ensure_openclaw_agent_disk`. |
| `openclaw_env.py` | `~/.openclaw/.env` parser/serializer, `load_env_entries`, `save_env_entries`, `upsert_env_entry` — shared by `routes/secrets.py` (whole-file read/write) and `routes/config_routes.py` (single-key upsert for provider onboarding). |
| `sessions_io.py` | `load_all_sessions`, `find_session_file`, `find_session_key`, `update_session_directory`. |
| `messages.py` | `convert_messages` and private converters for user / assistant / tool-result / stop-reason translation. |
| `streaming.py` | `stream_openclaw_to_sse`, `emit_prefetched_sse`, `create_new_session`, `find_session_id_by_key`, `openclaw_agent_id_from_prompt_body`. |

## Running it

- Dev: `uv run python main.py` (serves on `0.0.0.0:8000`, auto-reload on).
- Prod-style: `uv run uvicorn main:app --host 0.0.0.0 --port 8000`.
- Health check: `curl http://127.0.0.1:8000/health`.
