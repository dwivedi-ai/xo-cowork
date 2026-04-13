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
uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload
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

## License

[MIT](LICENSE)
