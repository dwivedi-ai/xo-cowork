# Known issues & open doubts

A rolling log of things that aren't quite right, or that we noticed but haven't
decided on yet. Covers both the **bridge** and the **frontend**. Each entry is
a snapshot — add the date, an `Area:` line, symptom, what we already know, and
(if applicable) candidate fixes. Remove entries once the underlying issue
ships as a real fix.

The file lives under `bridge/docs/` for historical reasons; scope is
project-wide.

---

## 2026-04-16 — Agents explorer under-counts sessions per agent

**Area:** frontend

**Symptom.** The frontend sidebar ("Agents explorer") shows a session count
per agent that's lower than the number of JSONL files in
`~/.openclaw/agents/<id>/sessions/`. Observed: `main` agent shows ~10 when
27 JSONL files exist on disk.

**Root cause (verified).** The bridge is fine — `load_all_sessions()`
returns all 27 main sessions, and `/api/agents/{id}` returns the full
`sessions.count`. The truncation happens in the frontend:

- `frontend/src/hooks/use-sessions.ts` paginates with `PAGE_SIZE = 50`,
  sorted by `time_updated DESC` **globally**, not per-agent.
- `frontend/src/components/layout/agents-explorer.tsx` (~line 293)
  renders `{sessions.length}` from `sessionPages.pages.flat()` and never
  calls `fetchNextPage()`.
- Result: the explorer only ever sees the 50 most-recent sessions
  globally. If an agent has older sessions, they're excluded from the
  count.

Numbers captured on 2026-04-16:

| Agent | On disk | In explorer (page 0 of 50) |
| --- | --- | --- |
| main | 27 | 8 |
| admin | 16 | 16 |
| dev | 11 | 11 |
| design | 8 | 8 |
| agent-dev | 7 | 7 |

**Candidate fixes** (none applied yet — leaving as-is per decision):

1. Read `sessions.count` from `GET /api/agents/{id}` — the bridge already
   returns the unclipped number at `routes/agents.py` `session_count`.
2. Add a lightweight `GET /api/agents/session-counts` that returns
   `{agent_id: count}` in one round-trip without paginating sessions.
3. Have the explorer auto-exhaust `fetchNextPage()` until `!hasNextPage`
   (costly on big installs).

**Where to look later.** `use-sessions.ts`, `agents-explorer.tsx:364-386`,
`routes/agents.py::get_agent_detail`.

---

## 2026-04-16 — Slow first-compile for `/c/new` in dev

**Area:** frontend

**Symptom.** Cold `npm run dev` followed by a request to `/c/new` takes
~33 s to compile under Turbopack. `/` takes ~7 s, `/c/[sessionId]` ~6 s,
`/onboard` ~6 s. Only the `/c/new` (new-chat empty state) route is the
outlier.

Observed timing (pre-refactor, captured 2026-04-16):

```
Compiled / in 6.6s
Compiled /c/new in 33s
Compiled /c/[sessionId] in 5.7s
Compiled /onboard in 6.2s
```

**Suspected cause (not yet verified with a bundle analyzer).** The
`Landing` component on `/c/new` imports `StreamingMessage` and related
message-rendering infrastructure eagerly. That pulls in the full markdown
/ syntax-highlight / artifact-preview pipeline even though `/c/new` has
no messages to render yet. Likely culprits in the dependency graph:
`mermaid`, `pdfjs-dist`, `@kandiforge/pptx-renderer`, `docx-preview`, and
whatever markdown/code-render components sit behind `StreamingMessage`.

**Candidate fixes** (to attempt once we pick this up):

1. Add `@next/bundle-analyzer` as a dev dependency, gate it behind an
   `ANALYZE=true` env flag in `next.config.ts`, run once, and identify
   the top 3–5 heaviest modules on the `/c/new` chunk.
2. Wrap render-only-when-used components in
   `next/dynamic({ ssr: false })` — primary targets are
   `StreamingMessage` and anything artifact-related (`mermaid`, PDF,
   PPTX, DOCX).
3. Replace any barrel imports (e.g. `@/components/messages`) with
   direct imports in the `/c/new` dependency chain.
4. Check CI container CPU limits — the dev pod may be throttled; more
   cores ≈ faster Turbopack without any code changes.

**Why deferred.** Not a correctness issue, affects dev-server cold start
only, and the fix benefits from a bundle-analyzer pass first rather
than guesswork. Revisit once structural refactors are stable.

**Where to look later.** `frontend/src/app/(main)/c/new/page.tsx`,
`frontend/src/components/chat/landing.tsx`,
`frontend/src/components/messages/assistant-message.tsx`,
`frontend/next.config.ts`.

---

## 2026-04-16 — "Reconnecting to server…" banner during long agent turns

**Area:** frontend + bridge

**Symptom.** During long-running OpenClaw turns (web searches, multi-tool
sequences, big file reads), the yellow `Reconnecting to server…` banner
appears mid-stream. The turn continues in the background and the banner
clears on its own once events start flowing again, but it reads like a
failure to the user.

**Root cause (understood, not yet mitigated).** The frontend's SSE client
in `frontend/src/lib/sse.ts` treats silence as failure:

1. **Heartbeat timeout** — if no SSE event (not even a `heartbeat`) arrives
   within `SSE_HEARTBEAT_TIMEOUT`, the client closes the EventSource and
   calls `scheduleReconnect()`, which flips the connection store status
   to `"reconnecting"` (`sse.ts:339`).
2. **Stale-connection watchdog** — a 15 s poll compares `lastEventTime`
   against the heartbeat threshold and force-reconnects if the timer
   missed (handles suspended laptops, frozen network stack).
3. **Native EventSource close** — browser reports `readyState === CLOSED`,
   which also triggers `scheduleReconnect()`.

The bridge emits `event: heartbeat` every 15 s when idle
(`bridge/streaming.py::stream_openclaw_to_sse`), so normally the client
stays connected. Two plausible ways it still fires:

- **Proxy buffering.** The Next.js dev rewrite (`frontend/next.config.ts`)
  may buffer SSE output under Turbopack, delaying heartbeats past the
  client threshold.
- **Long-running single tool call.** If OpenClaw stalls inside a tool
  (e.g. 60 s web scrape) without emitting any OpenAI-chunk data, the
  bridge's 15 s heartbeat loop keeps going — but if `lastEventTime` on
  the client reflects the last real `text-delta`, the watchdog can still
  trip.

**Candidate fixes.**

1. Audit the client heartbeat accounting — confirm `event: heartbeat`
   resets `lastEventTime`, not just `text-delta` events. If it doesn't,
   this is a one-line fix.
2. Lower the bridge-side heartbeat interval below 15 s (e.g. 10 s) so
   two heartbeats fit inside a single client heartbeat window.
3. Add a `X-Accel-Buffering: no` equivalent to the Next.js rewrite, or
   bypass the proxy for SSE in web mode (currently commented against in
   `src/lib/constants.ts` for port-forwarding reasons — would need a
   different solution).

**Where to look later.** `frontend/src/lib/sse.ts` (client reconnect
logic + heartbeat accounting), `bridge/streaming.py`
(`stream_openclaw_to_sse` + `emit_prefetched_sse` heartbeat emission),
`frontend/next.config.ts` (rewrite config for `/api/chat/stream/*`).

---

## 2026-04-16 — First message of a new session is not truly streamed

**Area:** bridge

**Symptom.** When a user sends the first message of a new chat session,
they see no incremental output — just a long pause followed by the whole
response appearing in a fast simulated "stream". Subsequent messages in
the same session stream token-by-token as expected. Folder/workspace
selection has no effect; the branch is purely new-session vs
existing-session.

**Root cause (intentional workaround).**
`bridge/streaming.py::create_new_session` calls OpenClaw with
`"stream": False`, waits for the full response, then `emit_prefetched_sse`
slices the result into 4-character chunks and emits them as SSE
`text-delta` events to simulate streaming. The comment in
`routes/chat.py::chat_prompt` spells out the reason:
`# Uses stream=False to avoid OpenClaw's bootstrap-duplicate issue.`

When a brand-new session is being bootstrapped, OpenClaw re-appends the
user message after loading context. Under real streaming this caused the
response to appear duplicated; the workaround was to fall back to a
non-streaming first call.

**Candidate fixes.**

1. Solve the upstream bootstrap-duplicate behavior in OpenClaw so the
   first call can use `stream=True`. Then flip the flag and delete
   `emit_prefetched_sse` entirely.
2. Keep streaming but dedupe on the bridge side — detect and drop the
   duplicated user echo in the stream before forwarding to the client.
   Complexity: non-trivial; needs to know exactly what OpenClaw re-emits.
3. Live with the current behavior but improve the UX hint — show a
   spinner with a message like "Starting session…" during the wait so
   the user knows something is happening.

**Where to look later.** `bridge/streaming.py::create_new_session`,
`bridge/streaming.py::emit_prefetched_sse`, `bridge/routes/chat.py`
(the `if not session_id:` branch in `chat_prompt`).
