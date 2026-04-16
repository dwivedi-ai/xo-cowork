# Request flow

How a frontend API call reaches the bridge.

## Web mode (default)

```
Browser (client, :3000)  →  Next.js server (:3000)  →  Bridge (:8000)
   React UI code              rewrites() proxy            FastAPI app
```

- **Browser (client-side)** runs the React UI and calls **relative**
  paths like `/api/sessions`. Same-origin with the page, so no CORS
  concern on the client side.
- **Next.js Node server (server-side)** on port 3000 receives the
  request and applies `frontend/next.config.ts → rewrites()`, which
  forwards `/api/*` and `/health` to `http://localhost:8000`. Override
  via `NEXT_PUBLIC_API_URL` in `frontend/.env.local`.
- **Bridge (port 8000)** is this FastAPI app — it handles the call and
  returns the response back through the proxy to the browser.

## Desktop (Tauri) mode

No Next.js server in the loop. The Tauri shell resolves the backend URL
via IPC and the webview calls the bridge directly:

```
Webview (client)  →  Bridge (dynamic port)
```

## SSE streaming

Chat streams (`/api/chat/stream/{id}`) follow the same path. In web mode
the frontend deliberately uses a relative URL so the stream goes through
the Next.js proxy — this avoids `localhost:8000` resolving to the wrong
process in port-forwarded dev environments (see
`frontend/src/lib/constants.ts` around `API.CHAT.STREAM`).
