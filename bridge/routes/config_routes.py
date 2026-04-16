"""
Configuration / provider / model-list endpoints.

Groups `/api/config/*` (api-key, providers, openclaw, openyak-account,
ollama, local, openai-subscription) and the per-agent model listing
(`/api/models`). Responses here shape what the UI sees in provider menus
and the settings screen.
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from config import AGENTS_DIR, OPENCLAW_MODEL_CAPABILITIES
from helpers import _mask_sensitive, normalize_agent_id
from openclaw_store import list_agent_entries, load_openclaw_config

router = APIRouter()


# ── Model listing ────────────────────────────────────────────────────────────


def list_openclaw_models() -> list[dict]:
    """One model row per OpenClaw agent so the UI can target `openclaw/<agentId>`."""
    cfg = load_openclaw_config()
    entries_by_id = {
        normalize_agent_id(str(e.get("id", ""))): e
        for e in list_agent_entries(cfg)
        if e.get("id")
    }
    models: list[dict] = []
    seen: set[str] = set()

    if AGENTS_DIR.exists():
        for agent_dir in sorted(AGENTS_DIR.iterdir()):
            if not agent_dir.is_dir():
                continue
            aid = normalize_agent_id(agent_dir.name)
            seen.add(aid)
            meta = entries_by_id.get(aid, {})
            display = meta.get("name") if isinstance(meta.get("name"), str) else None
            label = (display or "").strip() or aid
            models.append(
                {
                    "id": f"openclaw/{aid}",
                    "name": label,
                    "provider_id": "openclaw",
                    "capabilities": dict(OPENCLAW_MODEL_CAPABILITIES),
                    "pricing": {"prompt": 0, "completion": 0},
                    "metadata": {"openclaw_agent_id": aid},
                }
            )

    if not models:
        models.append(
            {
                "id": "openclaw/main",
                "name": "main",
                "provider_id": "openclaw",
                "capabilities": dict(OPENCLAW_MODEL_CAPABILITIES),
                "pricing": {"prompt": 0, "completion": 0},
                "metadata": {"openclaw_agent_id": "main"},
            }
        )

    return models


@router.get("/api/models")
def list_models():
    return list_openclaw_models()


# ── /api/config/* routes ─────────────────────────────────────────────────────


@router.get("/api/config/api-key")
def config_api_key():
    return {"has_key": True, "provider": "openclaw"}


@router.get("/api/config/providers")
def config_providers():
    return []


@router.get("/api/config/openai-subscription")
def openai_subscription():
    return {"is_connected": False, "email": "", "needs_reauth": False}


@router.get("/api/config/openyak-account")
def openyak_account():
    return {"linked": False}


@router.get("/api/config/ollama")
def ollama_config():
    return {"installed": False}


@router.get("/api/config/local")
def local_provider():
    return {"available": False}


@router.get("/api/config/openclaw")
def get_openclaw_config():
    """Return the full openclaw.json with sensitive fields masked."""
    cfg = load_openclaw_config()
    if not cfg:
        return JSONResponse(status_code=404, content={"detail": "openclaw.json not found"})
    return _mask_sensitive(cfg)
