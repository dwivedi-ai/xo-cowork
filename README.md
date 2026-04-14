# XO Cowork

XO Cowork is a web frontend built to interact with OpenClaw. It provides a clean chat interface for communicating with OpenClaw agents, managing sessions, and streaming responses in real time. Connects to OpenClaw via a lightweight bridge API, replacing the need for a standalone backend.

## Architecture

```
Frontend (Next.js)  <-->  Bridge (FastAPI)  <-->  OpenClaw API
     :3000                    :8000                 :18789
```

- **Frontend** — Next.js app with chat UI, session management, and real-time SSE streaming
- **Bridge** — Lightweight FastAPI server that translates between the frontend's expected API format and OpenClaw's OpenAI-compatible endpoint
- **OpenClaw** — Local AI agent runtime that handles model execution, tool use, and agent workflows

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Python](https://www.python.org/) 3.12+
- [OpenClaw](https://github.com/openclaw/openclaw) running locally on port 18789

## Setup

### Frontend

```bash
cd frontend
npm install --legacy-peer-deps
npm run dev
```

The frontend runs on `http://localhost:3000`.

### Bridge

```bash
cd bridge
uv sync
uv run python main.py
```

The bridge runs on `http://localhost:8000` and proxies requests to OpenClaw.

## OpenClaw Gateway Configuration

Make sure your `~/.openclaw/openclaw.json` includes the following `gateway.http` block:

```json
"gateway": {
  "mode": "local",
  "controlUi": {
    "dangerouslyDisableDeviceAuth": true,
    "allowedOrigins": [
      "..."
    ]
  },
  "http": {
    "endpoints": {
      "chatCompletions": {
        "enabled": true
      },
      "responses": {
        "enabled": true
      }
    }
  }
}
```

> **Important:** The `http.endpoints` section above is essential. You must explicitly enable `chatCompletions` and `responses` — without these, the OpenClaw HTTP API endpoints will not be available and the bridge will fail to connect.

## Project Structure

```
xo-cowork/
  frontend/       # Next.js web app (chat UI, session management)
  bridge/         # FastAPI bridge to OpenClaw
  package.json    # Root scripts
```

## Project Section (Sidebar File Explorer)

The **Project Section** is the collapsible file tree in the left sidebar. It lets users browse and open files from the server filesystem directly inside the chat UI. It is not a "project management" feature — there are no project entities, IDs, or CRUD operations. The name comes from the UI label on the sidebar toggle button.

---

### Front-end layout

The sidebar is rendered by `frontend/src/components/layout/sidebar.tsx` and is only visible on desktop-width viewports (lg+). Its stacking order from top to bottom is:

```
Sidebar
├── SidebarHeader       ← logo / collapse button
├── SidebarNav          ← top-level navigation links
├── ProjectExplorer     ← collapsible file tree  ← this section
├── AgentsExplorer      ← agent shortcuts
└── SidebarFooter       ← settings, user info
```

`ProjectExplorer` (`frontend/src/components/layout/project-explorer.tsx`) is composed of three pieces:

| Component | Responsibility |
|-----------|---------------|
| `ProjectExplorer` | Root toggle button labeled "Project". On first expand it fetches `/home/coder` as the tree root. Renders up to 280 px of scrollable content. |
| `FolderNode` | Recursive component for each directory. Lazy-loads children on first expand via `POST /api/files/list-directory`. Maintains its own `isOpen`, `loading`, and `children` state with `useState`. |
| `FileNode` | Leaf node for each file. Clicking it resolves the artifact type from the file extension and calls `useArtifactStore.getState().openArtifact(...)`, which opens the file in the right-side artifact panel. |

**State management** is intentionally local — no global store is involved in the tree expand/collapse logic. The only global side-effect of clicking a file is writing to `useArtifactStore` (Zustand) so the artifact panel can render the file content.

**Hard-coded root:** The tree always seeds from `/home/coder/.openclaw/workspace`. It is not wired to any workspace setting or session directory.

---

### Front-end ↔ bridge communication

All HTTP calls use the thin `fetch` wrapper at `frontend/src/lib/api.ts`.

```
frontend (fetch)  →  Next.js rewrite (/api/* → http://localhost:8000)  →  bridge (FastAPI)
```

- **Web mode** — Next.js rewrites all `/api/*` requests to the bridge URL (default `http://localhost:8000`), configured in `frontend/next.config.ts`.
- **Desktop (Tauri)** — `api.ts` resolves the backend URL dynamically via `getBackendUrl()` instead of relying on the Next.js proxy.
- **Remote tunnel** — `getRemoteConfig()` prepends the tunnel URL and injects `Authorization: Bearer <token>` on every request.
- **No WebSockets** are used for file operations. All file API calls are standard request/response `POST`.

The `api.post<T>(url, body)` helper sets `Content-Type: application/json`, serialises the body, and returns the parsed JSON response. Network errors (connection refused / reset) are retried up to three times with exponential back-off.

---

### Endpoints required to render the Project Section

#### `POST /api/files/list-directory`

Lists the contents of a directory. Called on every expand of `ProjectExplorer` (root) and `FolderNode` (subdirectories).

**Request body:**

```json
{ "path": "/home/coder/some/directory" }
```

Passing `null` or omitting `path` defaults to the user's home directory.

**Response:**

```json
{
  "path": "/home/coder/some/directory",
  "parent": "/home/coder/some",
  "dirs":  [{ "name": "subdir", "path": "/home/coder/some/directory/subdir" }],
  "files": [{ "name": "file.py", "path": "/home/coder/some/directory/file.py" }]
}
```

The bridge sorts entries so directories come before files (alphabetically within each group) and restricts traversal to paths under `Path.home()` (returns HTTP 403 otherwise).

#### `POST /api/files/content`

Reads the text content of a file. Called by `FilePreviewRenderer` after a file is opened from the tree.

**Request body:**

```json
{ "path": "/home/coder/some/directory/file.py" }
```

**Response:**

```json
{ "content": "...file text...", "path": "/home/coder/some/directory/file.py" }
```

Same home-directory restriction applies (HTTP 403 for paths outside it). Binary files should use `POST /api/files/content-binary` instead, which returns a `FileResponse` download; the front-end selects the correct endpoint based on the file extension via `artifactTypeFromExtension`.

---

### End-to-end flow summary

1. User clicks the **"Project"** toggle in the sidebar.
2. `ProjectExplorer.toggle()` fires `POST /api/files/list-directory` with `path: "/home/coder"`.
3. The bridge returns `{ dirs, files }` for that path.
4. The tree renders `FolderNode` entries for each directory and `FileNode` entries for each file.
5. User expands a folder → `FolderNode.toggle()` fires another `POST /api/files/list-directory` for that folder's path (result cached in component state).
6. User clicks a file → `FileNode.handleClick()` calls `useArtifactStore.getState().openArtifact(...)`.
7. The artifact panel mounts `FilePreviewRenderer`, which fires `POST /api/files/content` to load the file text and renders it with syntax highlighting.

## License

[MIT](LICENSE)
