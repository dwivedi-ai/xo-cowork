# Build a UI-Driven Google Drive Connector Using rclone

## Goal

Add a Google Drive connector to the existing **Connectors** tab. End users connect their Google Drive entirely through the UI — no terminal, no Google Cloud Console, no client ID/secret, no service account JSON, no rclone CLI knowledge. The user only does three things: type a name for the remote, click an "Authorize with Google" button, and approve consent on Google's page. Everything else happens in the backend.

This must work whether rclone runs on the user's local machine or inside the container that hosts our service. From the user's perspective this is a "Google Drive connector" — never expose the word "rclone" or any of the other 70+ rclone backends.

## How rclone normally configures Google Drive (the flow we replicate in the UI)

The standard `rclone config` CLI walks the user through: name the remote → pick `drive` as the type → leave `client_id` blank (uses rclone's bundled OAuth credentials) → leave `client_secret` blank → pick scope `drive` (full access) → leave `service_account_file` blank → skip advanced config → answer yes to "use a web browser for auth." rclone then starts a local HTTP server on `127.0.0.1:53682`, prints an auth URL, and blocks until the user completes Google sign-in. After consent, Google redirects back to `127.0.0.1:53682` with an authorization code, rclone exchanges it for a token using its bundled client_id, and writes the result to `rclone.conf`.

We need to drive this same flow programmatically. rclone exposes an HTTP **Remote Control (RC) API** that lets us do everything the CLI does without subprocess parsing.

## Architecture

Three components:

1. **Frontend** — A new "Google Drive" tile in the Connectors tab. Clicking it opens a modal with two states: a form to add a new connection (name input + Connect button), and a list of existing connections with disconnect buttons.

2. **Backend service** — Exposes a small REST API to the frontend. Internally talks to a running `rclone rcd` daemon over its HTTP RC API. Walks the rclone config state machine and surfaces the OAuth URL to the frontend.

3. **rclone rcd** — Long-lived daemon on `localhost:5572`. Started by the backend on demand if not already running.

## The rclone RC API

Start rclone in daemon mode:

```
rclone rcd --rc-no-auth --rc-addr=127.0.0.1:5572
```

This exposes the RC API at `http://127.0.0.1:5572/`. Every endpoint is `POST` with a JSON body. Endpoints we use:

- `POST /config/listremotes` — lists all remote names
- `POST /config/get` body `{"name": "<remote>"}` — returns one remote's full config (use this to filter to drive remotes by checking `type == "drive"`)
- `POST /config/delete` body `{"name": "<remote>"}` — removes a remote
- `POST /config/create` body `{"name": "...", "type": "drive", "parameters": {...}, "opt": {"nonInteractive": true}}` — creates a remote, returns the next state machine question
- `POST /config/update` — used to continue the state machine after the first call
- `POST /rc/noop` — health check, returns 200 if rclone is up
- `POST /core/version` — returns rclone's version

When `nonInteractive: true` is set, rclone returns a JSON blob describing the next question it would have asked the CLI user. Sample shape:

```json
{
  "State": "*oauth-islocal,,,",
  "Option": {
    "Name": "config_is_local",
    "Help": "Use web browser to automatically authenticate rclone with remote?...",
    "Default": true,
    "Type": "bool"
  },
  "Error": "",
  "Result": ""
}
```

The backend answers by calling `/config/update` with the same name plus `continue: true`, `state: "<state from response>"`, and `result: "<answer>"`. When `State` returns as the empty string `""`, the flow is complete and `rclone.conf` has been written.

A reference implementation of this protocol lives in `bin/config.py` in the rclone source tree on GitHub — read it before implementing the state machine loop.

## Pre-supplied parameters for Google Drive

Pass these in the first `/config/create` call so rclone uses them as defaults and skips the matching prompts:

- `scope: "drive"` — full access
- `config_is_local: "true"` — answers the "use a web browser for auth" question
- Leave `client_id`, `client_secret`, `service_account_file` unset → rclone uses its bundled OAuth credentials

After the first call, rclone's OAuth machinery starts a local HTTP server on `127.0.0.1:53682` and produces an auth URL. The backend captures this URL and surfaces it to the frontend.

## Capturing the auth URL

The exact behavior of `/config/create` here depends on rclone version — it may return the auth URL in the response body (look for an `OAuth` or similar field on the returned state object) or it may write it to its own log output as `NOTICE: If your browser doesn't open automatically go to the following link: <URL>`. Implement both:

1. First, parse the response JSON for the auth URL.
2. If absent, tail rclone's stderr (or its `--log-file=<path>` if started by us) and grep for `auth?state=`.

The original `/config/create` call may block until OAuth completes, depending on version. Always run it as a background task on the backend and expose status via a separate polling endpoint.

## OAuth callback — deployment scenarios

rclone's OAuth callback is hardcoded to `http://127.0.0.1:53682/` because that's the redirect URI registered on rclone's bundled OAuth client. We can't change this without registering our own Google OAuth client (which the requirement explicitly excludes).

This means the user's browser must reach `127.0.0.1:53682` on the machine where rclone is running. Three scenarios:

**Scenario A: rclone on the user's local machine.** Works out of the box.

**Scenario B: rclone in a container on the user's local machine.** The container must publish port 53682 to the host:

```
docker run -p 5572:5572 -p 53682:53682 ...
```

User's browser still hits `http://127.0.0.1:53682/...`, Docker forwards into the container. No code changes.

**Scenario C: rclone in a container on a remote host.** User's browser cannot reach the remote's `127.0.0.1`. Document an SSH tunnel as the workaround:

```
ssh -L 53682:localhost:53682 user@remote-host
```

After running this once, the user's browser can hit `http://127.0.0.1:53682/...` and SSH forwards it. Flag this as a known limitation in the UI when the backend detects a non-local rclone host (e.g., `RCLONE_RCD_URL` points at something other than `127.0.0.1` or `localhost`).

## Backend REST API

**`GET /api/connectors/gdrive/remotes`**
Returns `{"remotes": [{"name": "...", "type": "drive", "scope": "drive"}]}`. Implementation: call `/config/listremotes`, then `/config/get` for each, and filter to `type == "drive"`.

**`POST /api/connectors/gdrive/remotes`**
Body: `{"name": "<userInput>"}`. Validates the name (lowercase letters, digits, `_`, `-`; 1–32 chars; not already taken). Kicks off the `config/create` flow as a background task. Returns `{"session_id": "<uuid>", "status": "pending"}` immediately.

**`GET /api/connectors/gdrive/sessions/<session_id>`**
Polled by the frontend every 1–2 seconds. Returns one of:
- `{"status": "pending"}` — auth URL not yet available
- `{"status": "awaiting_oauth", "auth_url": "http://127.0.0.1:53682/auth?state=..."}`
- `{"status": "completed", "remote_name": "..."}`
- `{"status": "failed", "error": "..."}`

**`DELETE /api/connectors/gdrive/remotes/<name>`**
Calls `/config/delete`. Returns 204.

**`POST /api/connectors/gdrive/sessions/<session_id>/cancel`**
Aborts an in-progress flow. Deletes any partial remote rclone created, cancels the background task. Frontend calls this when the user closes the modal mid-flow.

## Backend implementation notes

- **Sessions**: in-memory map `session_id → {status, auth_url, remote_name, error, task_handle}`. Expire after 10 minutes; on expiry cancel the task and delete any partial remote.
- **Concurrency**: only one OAuth flow at a time per rclone instance (the callback port 53682 is fixed). If a session is already `awaiting_oauth`, reject new `POST /remotes` calls with 409 Conflict.
- **Completion detection**: the background task polls `/config/listremotes` every second. When the new remote name appears, mark the session `completed`. Time out after 5 minutes.
- **Starting rclone**: a helper run on backend startup. (a) Check if `127.0.0.1:5572/rc/noop` returns 200. (b) If not, spawn `rclone rcd --rc-no-auth --rc-addr=127.0.0.1:5572` as a child process and wait for the port to be ready. Make the rclone host/port configurable via env vars: `RCLONE_RCD_URL`, `RCLONE_RCD_USER`, `RCLONE_RCD_PASS`.
- **Config file location**: leave it at rclone's default — that way a remote configured via the UI is also usable from the rclone CLI.
- **Version compatibility**: call `/core/version` on backend startup and log the rclone version. If `/config/create` fails with an unknown-method error, surface a clear "your rclone version is too old for the non-interactive config protocol" message and link to rclone's install docs.

## Frontend implementation notes

- **Tile**: in the existing Connectors tab grid, add a "Google Drive" tile. Tile shows a Google Drive icon, the name, and either "Connect" (no remotes) or "N connected" (some exist).
- **Modal**: clicking the tile opens a modal with two sections — a list of existing remotes (each row: name, status indicator, disconnect button) and an "Add new" form (single name input + Connect button).
- **Connect flow**:
  - User types name → clicks Connect → button becomes a spinner with "Preparing authorization..."
  - Backend returns `session_id` → frontend polls
  - When status flips to `awaiting_oauth`, replace the spinner with a card: "Authorize this app to access your Google Drive" and a primary button "Open Google sign-in." Clicking opens `auth_url` in a new tab. Below it: "Waiting for you to complete sign-in..." with a subtle loading animation.
  - Add a small "Having trouble? See deployment notes" disclosure for the SSH tunnel case.
  - When status flips to `completed`, show a brief success state and refresh the remotes list.
  - If the user closes the modal mid-flow, fire `POST /sessions/<id>/cancel`.
- **Validation**: lowercase letters, digits, `_`, `-`. 1–32 chars. Reject duplicates (also enforced server-side).
- **Inline error states** (no alerts):
  - Name already taken → "A remote with this name already exists."
  - OAuth timeout → "Authorization timed out. Please try again."
  - rclone unreachable → "Could not reach rclone. Check that the rclone daemon is running."
  - Concurrent flow → "Another connection is being set up. Please finish or cancel it first."

## Edge cases

- **Stale partial remotes**: if a previous flow crashed before OAuth completed, `rclone.conf` may have a drive remote without a `token` field. On backend startup, log these and surface them as "unfinished — reconnect or remove" in the UI. Do not delete silently.
- **Token revocation**: if the user revokes access from their Google account, subsequent operations fail. Surface as a "reconnect" button on the remote row that runs the same flow with the same name.
- **Multiple Google accounts**: each remote ties to one Google account. Adding a second remote (e.g., `personal-drive` and `work-drive`) just runs the flow again with a new name — no special handling needed.

## Deliverables

1. Backend module/package with the connector logic and REST routes.
2. Frontend tile + modal in the Connectors tab.
3. README section covering all three deployment scenarios with the exact `docker run` and `ssh -L` commands.
4. Integration test that mocks the rclone RC API and walks the full flow: create session → emit auth URL → simulate completion → verify remote in the list.
5. Dev script that starts `rclone rcd` locally with the right flags.

## Out of scope (v1)

- File operations (browse/sync/copy/mount) — this connector only adds and removes remotes.
- Other rclone backends — Google Drive only.
- Custom OAuth client (user's own Google Cloud project).
- Service accounts.
- Encrypted rclone configs.
