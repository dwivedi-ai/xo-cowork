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
