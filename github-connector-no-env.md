# GitHub Connector — Without Environment Variables

## Overview

This document explains how to build a GitHub connector using two approaches
that require zero environment variables. The user's credentials live entirely
on their local machine in a JSON file. Your app ships no pre-configured secrets.

---

## Why No Environment Variables

Traditional GitHub OAuth Apps require a `client_secret` stored in `.env`.
That is a server-side pattern — it means **you** own the Slack/GitHub app
and users authenticate through your app.

The approaches below flip this: **the user owns the token**. Your app is
just a conduit. Nothing secret lives in your codebase or config.

---

## Two Approaches

| | PAT (Personal Access Token) | Device Flow |
|---|---|---|
| User effort | Medium — GitHub settings navigation | Low — enter a short code |
| Build effort | Very low | Medium (polling loop) |
| Pre-config needed | None | One public `client_id` in source code |
| Env variables | None | None |
| Secrets you manage | None | None |
| Token expiry | Never (unless user sets it) | Never |
| Refresh token | No | No |
| Best for | Developer tools | Consumer-facing products |

---

## Approach A — Personal Access Token (PAT)

### How It Works

The user generates a token on GitHub and pastes it into your UI.
Your app stores it in a local JSON file and injects it as a Bearer header
on every request to the GitHub MCP endpoint.

### Step 1 — Define GitHub in Your Catalog

Add to your static connectors catalog:

```
id:          github
name:        GitHub
url:         https://api.githubcopilot.com/mcp/
category:    dev-tools
description: Manage repos, issues, pull requests, and code search
auth_type:   pat
```

### Step 2 — Build the Token Input UI

Show a password input field labelled "Personal Access Token" in your
Settings → Connectors → GitHub row.

Direct users to:
`GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens`

Required scopes to tell the user to select:
- `Contents` — read/write files and repos
- `Issues` — read/write issues
- `Pull requests` — read/write PRs
- `Metadata` — mandatory for all fine-grained tokens

### Step 3 — Store the Token

When the user submits the token via `POST /connectors/github/token`:

Save to `~/.yourapp/mcp-tokens.json`:

```json
{
  "github": {
    "access_token": "github_pat_...",
    "refresh_token": null,
    "expires_at": 0,
    "token_type": "Bearer",
    "scope": ""
  }
}
```

Key points:
- `expires_at: 0` means never treat as expired, never attempt refresh
- `refresh_token: null` — GitHub PATs have no refresh mechanism
- Immediately inject token into in-memory MCP client after saving
- Trigger a reconnect to the GitHub MCP endpoint

### Step 4 — Connect to GitHub MCP

Connect to `https://api.githubcopilot.com/mcp/` with header:

```
Authorization: Bearer github_pat_...
```

Connection sequence:
1. Try Streamable HTTP transport first
2. If non-auth error → fall back to SSE transport
3. If `401` or `403` → mark status as `needs_auth` (token wrong/insufficient)
4. On success → call `tools/list` to discover GitHub tools
5. Register all discovered tools into your tool registry

### Step 5 — On App Restart

1. Load token from `mcp-tokens.json`
2. Check `expires_at === 0` → skip expiry check entirely
3. Inject `access_token` into MCP client
4. Connect

No refresh logic needed. PATs either work or they do not.

### Step 6 — Status Computation

| Situation | Status |
|---|---|
| No token stored | `needs_auth` — show token input |
| Token stored, MCP connected | `connected` |
| Token stored, MCP returned 401/403 | `needs_auth` — token wrong or revoked |
| Token stored, MCP failed for other reason | `failed` — show retry button |
| Connector disabled | `disabled` |

---

## Approach B — GitHub Device Flow (OAuth Without Any Secret)

### How It Works

This is what the GitHub CLI (`gh auth login`) uses internally.
No `client_secret`. No env variable. The only thing in your source code
is a **public `client_id`** — this is not a secret and is safe to commit.

Instead of a browser redirect, you show the user a short code and a URL.
The user enters the code on GitHub. Your backend polls until they approve.

### Step 1 — Register a GitHub OAuth App Once

Go to:
`github.com → Settings → Developer settings → OAuth Apps → New OAuth App`

Fill in:
- Application name: your app name
- Homepage URL: anything (e.g. `http://localhost`)
- Authorization callback URL: `http://localhost` (not used in device flow)

GitHub gives you a `client_id`. This is **not a secret**.
Put it directly in your source code or a non-secret config file.
Do **not** generate a `client_secret` — leave it blank.

### Step 2 — Request a Device Code

When the user clicks "Connect GitHub", your backend POSTs to:

```
POST https://github.com/login/device/code
```

Body:
- `client_id` — your public client_id
- `scope` — `repo user read:org`

GitHub responds with:

```json
{
  "device_code": "3584d83530557fdd1f46af8289938c8ef79f9dc5",
  "user_code": "WDJB-MJHT",
  "verification_uri": "https://github.com/login/device",
  "expires_in": 900,
  "interval": 5
}
```

### Step 3 — Show the User What to Do

Display in your UI:

```
Go to:     github.com/login/device
Enter code: WDJB-MJHT

Waiting for you to approve...  [spinner]
```

The `user_code` expires in 15 minutes (`expires_in: 900`).

### Step 4 — Poll GitHub Until User Approves

Your backend polls `https://github.com/login/oauth/access_token`
every `interval` seconds (exactly — do not poll faster or GitHub
returns `slow_down`).

Each poll sends:
- `client_id`
- `device_code`
- `grant_type: urn:ietf:params:oauth:grant-type:device_code`

Poll responses:

| Response | Meaning | Action |
|---|---|---|
| `authorization_pending` | User hasn't approved yet | Keep polling |
| `slow_down` | Too fast | Increase interval by 5s, keep polling |
| `expired_token` | User took too long | Show error, offer to restart |
| `access_denied` | User clicked deny | Show error |
| `access_token: gho_...` | Success | Save token, connect |

### Step 5 — Store the Token

On success, save to `~/.yourapp/mcp-tokens.json`:

```json
{
  "github": {
    "access_token": "gho_...",
    "refresh_token": null,
    "expires_at": 0,
    "token_type": "Bearer",
    "scope": "repo user read:org"
  }
}
```

Same as PAT — `expires_at: 0` because GitHub OAuth tokens never expire.

### Step 6 — Connect to GitHub MCP

Inject `Authorization: Bearer gho_...` and connect to
`https://api.githubcopilot.com/mcp/` — identical to PAT approach from here.

---

## Token Storage File Format

Both approaches use the same file and format:

**File:** `~/.yourapp/mcp-tokens.json`

```json
{
  "github": {
    "access_token": "github_pat_... or gho_...",
    "refresh_token": null,
    "expires_at": 0,
    "token_type": "Bearer",
    "scope": "repo user read:org"
  }
}
```

Rules:
- Plain JSON — no encryption
- Lives on the user's local machine
- Protected only by OS file permissions
- `expires_at: 0` = never expires, never refresh
- Only the user's token lives here — no developer secrets

---

## API Endpoints to Build

```
POST /connectors/github/token      — receive PAT, store, reconnect (Path A)
POST /connectors/github/device     — start device flow, return user_code (Path B)
GET  /connectors/github/device/poll — poll status (Path B)
POST /connectors/github/enable     — enable connector
POST /connectors/github/disable    — disable connector
POST /connectors/github/disconnect — delete token, close connection
POST /connectors/github/reconnect  — force reconnect with stored token
GET  /connectors                   — list all connectors with status
```

---

## Disconnect / Token Revocation

When the user clicks "Disconnect":

1. Delete `github` key from `mcp-tokens.json`
2. Clear in-memory token from MCP client
3. Close MCP connection
4. Set status to `needs_auth`

Optional — full server-side revocation:
Call `DELETE https://api.github.com/applications/{client_id}/token`
with the token in the request body using Basic Auth
(`client_id:client_secret`). Only relevant if using Device Flow
where you have a registered OAuth App.

---

## Build Order

### Path A (PAT — simpler, build first)

1. Define GitHub in connector catalog
2. Build `mcp-tokens.json` reader/writer (handle `expires_at: 0`)
3. Build MCP client — connect to remote HTTP, inject Bearer header
4. Build `POST /connectors/github/token` — receive PAT, store, reconnect
5. Test end-to-end: paste token → connect → discover tools → call a tool
6. Build status display — indicator dot, tool count, disconnect button

### Path B (Device Flow — add after PAT works)

7. Register GitHub OAuth App, put `client_id` in source
8. Build `POST /connectors/github/device` — request device code, return to frontend
9. Build polling logic — background task per pending auth
10. Build frontend — show `user_code`, verification URL, spinner
11. On poll success — store token, connect, update UI

---

## Key Rules

- `client_id` from Device Flow registration is **not secret** — safe to commit
- `expires_at: 0` means skip all expiry logic for GitHub tokens
- Never attempt token refresh for GitHub — tokens do not expire
- Tool list is discovered at runtime via MCP `tools/list` — not hardcoded
- On `401`/`403` from MCP — always set status `needs_auth`, not `failed`
- Poll interval from GitHub's response must be respected exactly

---

## References

- GitHub Device Flow: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
- GitHub Fine-grained PATs: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- GitHub Copilot MCP: `https://api.githubcopilot.com/mcp/`
- RFC 8628 — OAuth 2.0 Device Authorization Grant
