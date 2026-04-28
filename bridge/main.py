"""
OpenClaw → xo-cowork Bridge API Server

Reads OpenClaw's file-based session/message storage (~/.openclaw/agents/*)
and serves it in the format the xo-cowork frontend expects.
Proxies chat messages to OpenClaw's OpenAI-compatible API with SSE translation.

Entry point: creates the FastAPI app, wires CORS, and mounts every router
defined under the `routes/` package. All feature code lives in its own module
(see `docs/routes.md` for the map).
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import CORS_ORIGINS
from routes import all_routers

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    # Start rclone daemon for the Google Drive connector (non-fatal if rclone isn't installed)
    try:
        from gdrive_rclone import ensure_rclone_running
        await ensure_rclone_running()
    except Exception as exc:  # pragma: no cover
        log.warning("rclone startup skipped: %s", exc)
    yield


app = FastAPI(title="OpenClaw Bridge", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Accept-Language"],
)

for router in all_routers:
    app.include_router(router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
