# Build a UI-Driven OneDrive Connector Using rclone

## Goal

Add a Microsoft OneDrive connector to the existing **Connectors** tab. End users connect their OneDrive entirely through the UI — no terminal, no Azure portal, no client ID/secret, no rclone CLI knowledge. The user only does three things: type a name for the remote, click an "Authorize with Microsoft" button, and approve consent on Microsoft's page. Everything else happens in the backend.

This must work whether rclone runs on the user's local machine or inside the container that hosts our service. From the user's perspective this is a "OneDrive connector" — never expose the word "rclone" or any of the other 70+ rclone backends.

OneDrive is **option 41** in `rclone config`'s backend selector and the rclone backend type is `onedrive`. This connector ships alongside the existing Google Drive connector ([rclone-gdrive-connector-prompt-v2.md](rclone-gdrive-connector-prompt-v2.md)) and shares the same rclone daemon, the same `rclone.conf`, and the same OAuth callback port (53682).

## How rclone normally configures OneDrive (the flow we replicate in the UI)

The standard `rclone config` CLI walks the user through: name the remote → pick option 41 (`onedrive`) as the type → leave `client_id` blank (uses rclone's bundled OAuth credentials) → leave `client_secret` blank → leave `region` at default (`global`) → answer yes to "use a web browser for auth." rclone starts a local HTTP server on `127.0.0.1:53682`, prints an auth URL, and blocks until the user completes Microsoft sign-in. After consent, Microsoft redirects back to `127.0.0.1:53682`, rclone exchanges the code for a token, and writes a partial config. **Then** rclone asks: "which drive would you like to use?" — listing the user's drives — and the user picks one (drive_id + drive_type get written too).

We need to drive this entire flow programmatically. Two parts of the standard flow are non-trivial:

1. **OAuth via `rclone authorize`** — same pattern as the gdrive connector: spawn `rclone authorize --auth-no-open-browser onedrive`, parse the auth URL from stderr, wait for the subprocess to exit (rclone handles the :53682 callback itself), capture the resulting token JSON from stdout.
2. **Drive discovery** — `rclone authorize` only returns the OAuth token. To write a working remote we also need `drive_id` and `drive_type`. Instead of running rclone's interactive drive-picker, we call **Microsoft Graph** with the freshly captured token: `GET https://graph.microsoft.com/v1.0/me/drive`. The response gives us the user's default drive (`id` and `driveType`), which is what 99% of users want.

## Architecture

Three components, identical in shape to the gdrive connector:

1. **Frontend** — a "OneDrive" tile in the Connectors tab, sitting below the Google Drive tile in the **Cloud Storage** section. Clicking it opens a modal with two states: a list of existing connections (each row showing `personal` / `business` / `SharePoint`) and an "Add new" form (name input + Connect button).

2. **Backend service** — small REST API at `/api/connectors/onedrive/*`. Drives the rclone authorize subprocess, then resolves the user's drive via Microsoft Graph, then appends a complete INI section to `rclone.conf`.

3. **rclone** — shared with the gdrive connector. The single `rclone rcd` daemon serves both. The single `rclone.conf` holds remotes from both.

## OneDrive-specific config: what `rclone.conf` must contain

A working onedrive remote needs **five** fields:

```ini
[name]
type       = onedrive
region     = global
token      = {"access_token":"...","token_type":"Bearer","refresh_token":"...","expiry":"..."}
drive_id   = b!abcXYZ...
drive_type = personal
```

`drive_type` is one of `personal` / `business` / `documentLibrary`. The Microsoft Graph `/me/drive` response gives us both `id` and `driveType` — read those and write them into the config section as the connector finishes.

If the Graph call fails, **do not** write a half-configured remote (rclone won't be able to use it without `drive_id` anyway). Mark the session as failed and surface the error.

## Backend REST API

**`GET /api/connectors/onedrive/remotes`** — Returns `{"remotes": [{"name", "type": "onedrive", "drive_type", "region", "complete"}]}`. Filters `/config/listremotes` to entries with `type == "onedrive"`. `complete` is `true` only when both `token` and `drive_id` are set.

**`POST /api/connectors/onedrive/remotes`** — Body `{"name": "<userInput>"}`. Validates the name (regex `^[a-z0-9_-]{1,32}$`, not already taken). Returns `{"session_id": "<uuid>", "status": "pending"}` (HTTP 202). Returns 409 if any rclone-OAuth flow is already in `awaiting_oauth` (gdrive or onedrive — see "Shared OAuth lock" below).

**`GET /api/connectors/onedrive/sessions/<session_id>`** — Same shape as gdrive: `{status}` + conditional `auth_url`, `needs_manual_code`, `remote_name`, `error`.

**`DELETE /api/connectors/onedrive/remotes/<name>`** — Calls `/config/delete`. 204.

**`POST /api/connectors/onedrive/sessions/<session_id>/cancel`** — Aborts, deletes any partial remote.

**`POST /api/connectors/onedrive/sessions/<session_id>/submit`** — Body `{"code": "<paste from URL bar>"}`. Manual-paste fallback for when port 53682 is occupied locally.

## Shared OAuth lock

rclone's bundled OAuth client redirects to `http://127.0.0.1:53682/` for **every** backend that uses it (Google Drive, OneDrive, Box, Dropbox, ...). The port is fixed by the redirect URI registered on rclone's bundled OAuth credentials.

If a gdrive flow is in `awaiting_oauth` and a onedrive flow starts, the second `rclone authorize` subprocess will fail to bind :53682 and crash silently. To prevent this, both connectors register their session iterables with a tiny shared module (`bridge/rclone_oauth_lock.py`). On every "create remote" call, the connector checks `has_active_oauth()` across all registered iterables before kicking off a new flow. If any session is `awaiting_oauth`, return 409.

## OAuth callback — deployment scenarios

Identical to the gdrive doc. Three scenarios:

- **Local rclone**: works out of the box.
- **Containerised rclone, same machine**: container must publish 53682 to host (`docker run -p 5572:5572 -p 53682:53682 ...`).
- **Remote rclone**: SSH tunnel `ssh -L 53682:localhost:53682 user@remote-host`, then the user's browser can hit `http://127.0.0.1:53682/`.

## Backend implementation notes

- Reuse `ensure_rclone_running()`, `_rc_post`, `_PipeReader`, `_NAME_RE`, `RCLONE_CONFIG_PATH` from `gdrive_rclone.py` rather than redefining them.
- Auth URL regex matches Microsoft hosts: `https?://\S+(?:login\.microsoftonline\.com|login\.live\.com|oauth2/.+/authorize)\S*`.
- Subprocess args: `["rclone", "authorize", "--auth-no-open-browser", "onedrive", f"--config={RCLONE_CONFIG_PATH}"]`.
- After capturing token JSON, call `https://graph.microsoft.com/v1.0/me/drive` with `Authorization: Bearer <access_token>`. 15s timeout. Read `id` and `driveType`.
- Write the full INI section in one append to `rclone.conf`.
- Verification loop polls `/config/listremotes` + `/config/get` until the new remote shows `type == "onedrive"` AND has both `token` and `drive_id`. Time out after ~10 seconds.

## Frontend implementation notes

- **Tile**: blue Microsoft cloud SVG (`#0078D4`) next to the existing Google Drive tile in Cloud Storage. Same status indicator pattern (dot + "N connected" / "Not connected").
- **Modal**: identical state machine to gdrive (`idle` → `starting` → `waiting_completion` → `awaiting_oauth` → `completed`/`error`, with manual-paste branch). Copy is "Connect OneDrive" / "Authorize OneDrive" / "Open Microsoft sign-in" / "Waiting for Microsoft sign-in to complete…".
- **Remote row**: shows `personal` / `business` / `SharePoint` derived from `drive_type` as a small subtitle next to the connection state.
- **Validation**: lowercase letters, digits, `_`, `-`. 1–32 chars. Reject duplicates (also enforced server-side).

## Edge cases

- **Token expiry / revocation**: rclone refreshes the token automatically on use. If the user revokes from Microsoft account settings, operations fail; surface as a "reconnect" button on the remote row that runs the flow with the same name.
- **Multiple Microsoft accounts**: each remote ties to one account. Add a second by typing a new name (`personal-onedrive`, `work-onedrive`) — no special handling.
- **Business vs personal**: both work through the same `/me/drive` discovery. Business accounts get `drive_type = business`; personal get `drive_type = personal`.
- **SharePoint document libraries**: out of scope for v1. The user gets their default drive only. (In rclone CLI, SharePoint requires picking from a list of drives — we don't surface that.)

## Deliverables

1. Backend module `bridge/onedrive_rclone.py` and routes `bridge/routes/onedrive.py`.
2. Shared OAuth lock `bridge/rclone_oauth_lock.py` (used by both gdrive and onedrive).
3. Frontend hook `frontend/src/hooks/use-onedrive.ts` and component `frontend/src/components/connectors/onedrive-connector.tsx`.
4. Tile registered in the Cloud Storage section of `frontend/src/app/(main)/plugins/content.tsx`.
5. Constants block `API.ONEDRIVE.*` in `frontend/src/lib/constants.ts`.

## Out of scope (v1)

- File operations (browse / sync / mount) — connector only adds and removes remotes.
- Region picker for `de` / `us` / `cn` Microsoft clouds — defaults to `global` only.
- SharePoint document library selection beyond the default drive returned by `/me/drive`.
- Custom Microsoft OAuth client (user-supplied Azure app registration).
- Multi-drive selection on a single Microsoft account.
