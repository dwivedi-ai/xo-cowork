"""
Secrets endpoints backed by the `~/.openclaw/.env` file.

GET parses the file into key/value entries, PUT overwrites it with a new list
of entries. Comments and blank lines are stripped; a trailing newline is
always ensured.
"""

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()

_ENV_FILE = Path.home() / ".openclaw" / ".env"


def _parse_env_file(text: str) -> list[dict]:
    """Parse a .env file into a list of {key, value} dicts (skips blank lines and comments)."""
    entries = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "=" in stripped:
            key, _, value = stripped.partition("=")
            entries.append({"key": key.strip(), "value": value.strip()})
    return entries


def _serialize_env_file(entries: list[dict]) -> str:
    """Serialize a list of {key, value} dicts back to .env file text."""
    lines = [f"{e['key']}={e['value']}" for e in entries if e.get("key", "").strip()]
    return "\n".join(lines) + ("\n" if lines else "")


@router.get("/api/secrets/env")
async def get_env_secrets():
    """Return the OpenClaw .env file as a list of key-value entries."""
    if not _ENV_FILE.exists():
        return {"entries": []}
    try:
        text = _ENV_FILE.read_text(errors="replace")
        return {"entries": _parse_env_file(text)}
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})


@router.put("/api/secrets/env")
async def put_env_secrets(request: Request):
    """Overwrite the OpenClaw .env file with the provided key-value entries."""
    body = await request.json()
    entries = body.get("entries", [])
    try:
        _ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
        _ENV_FILE.write_text(_serialize_env_file(entries))
        return {"ok": True}
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})
