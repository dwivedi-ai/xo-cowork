"""
Cross-connector OAuth port lock.

rclone's OAuth callback server binds to a single hardcoded port (53682) for
every backend that uses its bundled OAuth client (Google Drive, OneDrive, ...).
Only ONE OAuth flow can be active at a time across ALL connectors — if a
second `rclone authorize` subprocess starts while another is still waiting for
its callback, the second one will fail to bind :53682 and crash silently.

Each connector module (gdrive_rclone, onedrive_rclone, ...) registers a
zero-arg getter that returns its current sessions. `has_active_oauth()` scans
all registered iterables for a session whose `status == "awaiting_oauth"`.
"""

from typing import Any, Callable, Iterable

_session_iterables: list[Callable[[], Iterable[Any]]] = []


def register_sessions(getter: Callable[[], Iterable[Any]]) -> None:
    """Connector modules call this at import time with `lambda: _sessions.values()`."""
    if getter not in _session_iterables:
        _session_iterables.append(getter)


def has_active_oauth() -> bool:
    for getter in _session_iterables:
        try:
            for session in getter():
                if getattr(session, "status", None) == "awaiting_oauth":
                    return True
        except Exception:
            continue
    return False
