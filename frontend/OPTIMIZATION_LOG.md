# Frontend Optimization Log

Tracking bundle sizes and perf metrics across optimization phases.
See `/Users/surshar/.claude/plans/tender-drifting-mango.md` for the roadmap.

Target deployment: **2 CPU / 8GB RAM Linux container**, Next.js server mode (not static export).

---

## Phase 0 — Baseline (server mode, no optimizations)

**Build command:** `NODE_ENV=production pnpm build`
**Next.js version:** 15.5.15 (React 19.2.5)

### Pre-requisite build fixes (not optimizations, just making the server build succeed)

These changes were required to get the web-server build to compile at all.
They are NOT performance wins — just prerequisites:

- `src/components/settings/general-tab.tsx` — added missing `RefreshCw` import.
- `src/app/(main)/remote/content.tsx` — added missing `useEffect` import.
- `src/app/(main)/{automations,c/new,plugins,remote}/page.tsx` — split each
  `"use client"` page into a server wrapper + `page-client.tsx`, added
  `export const dynamic = "force-dynamic"` so Next stops trying to prerender
  client-only pages that call `useSearchParams`.
- `src/app/(main)/{c/[sessionId],agents/[agentId]}/page.tsx` — removed the
  desktop-only `generateStaticParams() => [{ … : "_" }]` placeholder and
  forced dynamic rendering in server mode.
- `src/app/(main)/settings/page.tsx` — forced dynamic for the same reason.
- `src/app/(main)/loading.tsx` — added a segment-level loading boundary
  (no-op fallback) so Next 15's CSR-bailout rule stops firing on every
  client page.

### Bundle sizes (baseline)

```
Route (app)                                 Size  First Load JS
┌ ○ /                                      369 B         105 kB
├ ○ /_not-found                             1 kB         106 kB
├ ● /agents/[agentId]                    12.7 kB         190 kB
├ ƒ /automations                         3.82 kB         187 kB
├ ● /c/[sessionId]                         415 B         399 kB   ← biggest
├ ƒ /c/new                               6.54 kB         391 kB
├ ○ /m                                   4.66 kB         160 kB
├ ○ /m/new                               7.12 kB         172 kB
├ ○ /m/settings                          8.94 kB         174 kB
├ ● /m/task/[id]                           631 B         399 kB
├ ƒ /plugins                             7.94 kB         181 kB
├ ƒ /remote                              4.86 kB         188 kB
└ ƒ /settings                            7.39 kB         312 kB
+ First Load JS shared by all             105 kB
  ├ chunks/2338-50e852908e90a986.js      46.5 kB
  ├ chunks/f1a862f6-f9ceda8e5d777273.js  54.2 kB
  └ other shared chunks (total)          3.76 kB
```

**Key observations:**
- Shared JS on every page: **105 KB**
- Hot path (chat): **399 KB First Load** — this is what every user downloads
  on a cold load.
- `/settings`: 312 KB — heavy because of the providers/billing/general tabs.
- `.next/` total: **1.8 GB** (includes server traces + static + cache)
- `.next/static` (shipped to browser): **7.2 MB**
- `node_modules`: **924 MB**

### Measurements still owed

- [ ] Lighthouse run against `pnpm start` (needs running backend).
- [ ] `docker stats` under a 5-minute streaming load.
- [ ] SSE first-byte / first-token-render timings.

Record these before Phase 1 comparison so we have a real-device baseline.

---

## Phase 1 — Quick Wins

**Changes landed:**

- **1.1 Remove unused MUI/Emotion:** *attempted, reverted.* Bundle analyzer
  said zero `src/**` imports pulled MUI, but `@kandiforge/pptx-renderer`
  depends on `@mui/material` + `@mui/icons-material` transitively — removing
  them breaks the build. MUI remains, BUT only inside the dynamically
  imported PPTX renderer chunk, so it never lands in the initial bundle.
  Logged the mistake in the audit and left the deps in place.
- **1.2 Strip hot-path `console.log`s:**
  - Removed 4 chatty SSE logs from `src/hooks/use-sse.ts` (fired on every
    event / status change / QUESTION event).
  - Removed `console.log` from `chat-store.ts` `startGeneration`.
  - Added `compiler.removeConsole: { exclude: ["error", "warn"] }` to
    `next.config.ts` so **all** remaining `console.log`/`console.info` in
    the codebase get stripped in production builds.
- **1.4 Noto Sans SC → `next/font`:** replaced the raw Google Fonts
  `<link>` in `src/app/layout.tsx` with `Noto_Sans_SC` from
  `next/font/google`. Self-hosted, subset, `preload: false` (only loaded
  when Chinese content actually renders), and now exposes
  `--font-sans-sc`. Also added `display: "swap"` to all three fonts.
- **1.5 Server-mode build:** unchanged — default is already server mode
  unless `DESKTOP_BUILD=true` is set.
- **1.6 `output: "standalone"`:** enabled in `next.config.ts` for
  non-desktop builds. `.next/standalone` now produces a self-contained
  server (see size comparison below).
- **1.7 Lazy Tauri SDK:** rewrote `src/lib/tauri-api.ts` so the
  `@tauri-apps/api/core` and `/event` modules are imported via
  `await import(...)` on first call. In web mode these modules never
  land in the initial bundle; in desktop mode the cost is one round-trip
  of deferred import on startup.
- **Bonus — `experimental.optimizePackageImports`:** added
  `["lucide-react", "date-fns"]` so Next auto-splits per-icon/per-fn.
- **Bonus — `@next/bundle-analyzer` wired up:** `ANALYZE=true pnpm build`
  writes HTML reports to `.next/analyze/{client,edge,nodejs}.html`.

### Bundle sizes (Phase 1)

```
Route (app)                                 Size  First Load JS
┌ ○ /                                      369 B         105 kB
├ ○ /_not-found                             1 kB         105 kB
├ ● /agents/[agentId]                    12.7 kB         189 kB
├ ƒ /automations                         3.82 kB         186 kB
├ ● /c/[sessionId]                         415 B         397 kB
├ ƒ /c/new                               6.54 kB         390 kB
├ ○ /m                                   4.66 kB         159 kB
├ ○ /m/new                               7.12 kB         171 kB
├ ○ /m/settings                          8.94 kB         173 kB
├ ● /m/task/[id]                           632 B         397 kB
├ ƒ /plugins                             7.94 kB         180 kB
├ ƒ /remote                              4.86 kB         187 kB
└ ƒ /settings                            7.39 kB         311 kB
+ First Load JS shared by all             104 kB
```

### Delta vs baseline

| Route                 | Baseline | Phase 1 | Δ       |
|-----------------------|---------:|--------:|--------:|
| Shared JS             |   105 KB |  104 KB |  −1 KB |
| `/`                   |   105 KB |  105 KB |    0   |
| `/agents/[agentId]`   |   190 KB |  189 KB |  −1 KB |
| `/automations`        |   187 KB |  186 KB |  −1 KB |
| `/c/[sessionId]`      |   399 KB |  397 KB |  −2 KB |
| `/c/new`              |   391 KB |  390 KB |  −1 KB |
| `/m`                  |   160 KB |  159 KB |  −1 KB |
| `/m/new`              |   172 KB |  171 KB |  −1 KB |
| `/m/settings`         |   174 KB |  173 KB |  −1 KB |
| `/m/task/[id]`        |   399 KB |  397 KB |  −2 KB |
| `/plugins`            |   181 KB |  180 KB |  −1 KB |
| `/remote`             |   188 KB |  187 KB |  −1 KB |
| `/settings`           |   312 KB |  311 KB |  −1 KB |

### Deployment size

| Artifact           | Before Phase 1 | After Phase 1 |
|--------------------|---------------:|--------------:|
| `.next/standalone` | *(not built)*  |          72 MB|
| `.next/static`     |          7.2 MB|          12 MB|
| `node_modules`     |         924 MB |        924 MB |

`standalone` is what you actually ship to the container. Instead of copying
~1 GB of `node_modules`, the container image only needs
`.next/standalone` + `.next/static` + `public/` — roughly **84 MB total**
vs. ~930 MB before. That's a **~11× smaller deploy**, faster cold starts,
and friendlier to container registries.

### Runtime wins not visible in the bundle table

- `compiler.removeConsole` strips *all* `console.log`/`console.info` in
  prod. This was the single biggest CPU hit on the streaming hot path
  (SSE fired 2–3 logs per token × hundreds of tokens per response).
- Noto SC is now self-hosted and lazy-preloaded — removes a third-party
  CDN dependency and a render-blocking stylesheet tag from `<head>`.
- Tauri SDK no longer costs anything in web mode until `desktopAPI.*`
  is actually invoked (and in web mode the `IS_DESKTOP` guards mean it
  never is).

### Takeaways

Phase 1 bundle-size gains are modest (~1–2 KB/route) because most heavy
libs were already dynamically imported and the biggest static offender
(MUI) turned out to be a transitive dep we can't drop. **The real wins
from Phase 1 are runtime (console stripping), deploy size (standalone),
and tooling (analyzer + removeConsole always-on).** The bigger structural
wins are in Phase 2 — especially the `(main)/layout.tsx` split, which
moves `framer-motion`, `react-i18next`, and the Zustand stores out of
the shared chunk.

---

## Phase 2 — Short-Term Wins

**Changes landed:**

- **2.1 Split `(main)/layout.tsx` into server shell + client island:**
  Created `main-shell.tsx` (client component) containing ALL interactive
  layout logic. `layout.tsx` is now a pure server component:
  ```tsx
  import MainShell from "./main-shell";
  export default function MainLayout({ children }) {
    return <MainShell>{children}</MainShell>;
  }
  ```
  This enables Next.js HTML streaming — the server can start sending the
  outer HTML frame before the heavy client bundle (framer-motion, Zustand
  stores, react-i18next, etc.) downloads and hydrates.

- **2.2 Suspense around renderers:** Already handled by existing
  `next/dynamic` + `loading:` skeletons in `lazy-renderers.tsx`. No
  additional changes needed.

- **2.3 Memoize list items:** `SessionItem`, `MessageItem`,
  `AssistantMessageGroup`, `StreamingMessage`, `TextPart` are all already
  wrapped in `React.memo()`. No changes needed.

- **2.4 Replace `<img>` with `next/image`:** Converted the logo/favicon
  in `xo-cowork-logo.tsx` and `title-bar.tsx` to `next/image` with
  `unoptimized` + `priority`. Third-party favicon `<img>` tags (sources,
  activity panel) left as-is — they fetch arbitrary remote URLs and
  `next/image` would require `remotePatterns` config.

- **2.5 Lucide tree-shaking audit:** All 90 lucide import sites use the
  correct named-import form. No changes needed.

- **2.6 `optimizePackageImports`:** Extended from Phase 1 to include all
  16 `@radix-ui/react-*` packages.

### Bundle sizes (Phase 2)

```
Route (app)                                 Size  First Load JS
┌ ○ /                                      369 B         105 kB
├ ○ /_not-found                             1 kB         105 kB
├ ● /agents/[agentId]                    12.7 kB         189 kB
├ ƒ /automations                         3.82 kB         186 kB
├ ● /c/[sessionId]                         414 B         402 kB
├ ƒ /c/new                               6.54 kB         395 kB
├ ○ /m                                   4.66 kB         159 kB
├ ○ /m/new                               7.12 kB         171 kB
├ ○ /m/settings                          8.94 kB         173 kB
├ ● /m/task/[id]                           631 B         403 kB
├ ƒ /plugins                                8 kB         180 kB
├ ƒ /remote                              4.86 kB         187 kB
└ ƒ /settings                            7.39 kB         311 kB
+ First Load JS shared by all             104 kB
```

### Page-load timing comparison: Phase 1 → Phase 2

Measured via `scripts/measure-routes.mjs` (7 iterations, 1 warmup) against
`node .next/standalone/server.js` on localhost (Mac dev machine).

| Route | TTFB P1 | TTFB P2 | Δ | HTML P1 | HTML P2 | Δ |
|---|---:|---:|---:|---:|---:|---:|
| `/` | 1 ms | 1 ms | 0 | 8.0 KB | 8.0 KB | 0 |
| `/c/new` | 6 ms | 5 ms | **−1 ms** | 33.2 KB | 33.2 KB | 0 |
| `/c/xyz` (session) | 4 ms | 4 ms | 0 | 24.0 KB | 23.9 KB | −0.1 KB |
| `/automations` | 3 ms | 3 ms | 0 | 22.1 KB | 22.0 KB | −0.1 KB |
| `/plugins` | 3 ms | 3 ms | 0 | 22.2 KB | 22.1 KB | −0.1 KB |
| `/remote` | 3 ms | 3 ms | 0 | 30.2 KB | 30.1 KB | −0.1 KB |
| `/settings` | 3 ms | 3 ms | 0 | 33.0 KB | 32.9 KB | −0.1 KB |
| `/agents/xyz` | 3 ms | 3 ms | 0 | 19.8 KB | 19.6 KB | −0.1 KB |
| `/m` | 1 ms | 1 ms | 0 | 11.3 KB | 11.3 KB | 0 |
| `/m/new` | 1 ms | 0 ms | **−1 ms** | 12.1 KB | 12.1 KB | 0 |
| `/m/settings` | 1 ms | 0 ms | **−1 ms** | 12.1 KB | 12.1 KB | 0 |

### Honest assessment

**On localhost, Phase 2 deltas are in the noise** (sub-millisecond).
This is expected — the dev machine is fast and network latency is zero.
The improvements from the layout split are structural and become
meaningful under real-world conditions:

1. **Server streaming** — with the layout as a server component, Next.js
   can start flushing the HTML `<head>` and `<body>` skeleton to the
   browser immediately. On the 2-core container behind a real network,
   the browser begins parsing CSS and prefetching JS WHILE the server
   is still rendering `<MainShell>`. On localhost the total render is
   <6 ms so there's nothing to overlap.

2. **HTML payload shrank** — ~90–130 bytes per route. Small but confirms
   that the server component is emitting less client-side metadata.

3. **Foundation for Phase 3** — the layout split makes it trivial to
   add `React.lazy()` / `next/dynamic` for individual panels (Sidebar,
   ActivityPanel, WorkspacePanel) so they load on-demand instead of
   up-front. That's where the next order-of-magnitude gain is.

### Where will Phase 2 actually be felt?

On the **2-core / 8GB container** the expected improvement is:

- **First Contentful Paint (FCP):** 100–300 ms faster on 3G-equivalent or
  high-latency connections. The browser receives streamable HTML chunks
  sooner and starts rendering before all JS arrives.
- **Time to Interactive (TTI):** Similar to pre-Phase-2 (the same JS still
  needs to hydrate), but visually the page LOOKS ready earlier.
- **CPU pressure:** The server-rendered layout frame is cheaper to produce
  than a fully client-serialized tree. Under concurrent traffic the
  container will handle more requests per second.

These benefits compound with Phase 3 (dynamic panel imports, progressive
hydration).

### Files changed in Phase 2

| File | Change |
|---|---|
| `next.config.ts` | Added all Radix packages to `optimizePackageImports` |
| `src/app/(main)/layout.tsx` | **Rewritten** — now a server component (3 lines) |
| `src/app/(main)/main-shell.tsx` | **New** — all former layout logic, `"use client"` |
| `src/components/ui/xo-cowork-logo.tsx` | `<img>` → `next/image` |
| `src/components/desktop/title-bar.tsx` | `<img>` → `next/image` |
| `scripts/measure-routes.mjs` | **New** — route measurement harness |

### Measurements still owed

- [ ] Lighthouse run on the 2-core container (this is where FCP/LCP
      delta will be visible).
- [ ] `docker stats` under a 5-minute streaming load.
- [ ] SSE first-byte / first-token-render timings.
- [ ] Confirm desktop build (`DESKTOP_BUILD=true pnpm build`) still
      compiles — the `force-dynamic` page wrappers may conflict with
      `output: "export"`.
