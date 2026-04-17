"""Router aggregation for `main.py`.

Every route module exposes a single `router: APIRouter`. `all_routers` is the
ordered list `main.py` uses to mount them onto the FastAPI app.

Order matters only where two modules could claim the same path — in
`sessions.py` the literal `/api/sessions/search` is registered before
`/api/sessions/{session_id}` inside the module, so cross-module ordering
here is purely cosmetic.
"""

from fastapi import APIRouter

from .agents import router as agents_router
from .channels import router as channels_router
from .chat import router as chat_router
from .config_routes import router as config_router
from .files import router as files_router
from .fts import router as fts_router
from .health import router as health_router
from .misc import router as misc_router
from .secrets import router as secrets_router
from .sessions import router as sessions_router
from .usage import router as usage_router
from .workspace_memory import router as workspace_memory_router

all_routers: list[APIRouter] = [
    health_router,
    sessions_router,
    chat_router,
    agents_router,
    config_router,
    channels_router,
    files_router,
    workspace_memory_router,
    secrets_router,
    usage_router,
    fts_router,
    misc_router,
]
