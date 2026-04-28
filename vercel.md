# Vercel Connector

Connect your AI agent to Vercel to manage deployments, projects, domains, and environment variables — no manual dashboard visits needed.

---

## Overview

| Field | Value |
|-------|-------|
| **MCP URL** | `https://mcp.vercel.com/` |
| **Auth** | OAuth 2.1 with PKCE (native — no env vars required) |
| **Token storage** | Local token store (never sent to cloud) |
| **Setup time** | ~1 minute |

---

## What You Can Do

### Deployments
- List recent deployments across all projects or a specific project
- Inspect deployment status, build logs, and function logs
- Redeploy a specific deployment (promote to production or re-run preview)
- Cancel a running or queued deployment
- Get deployment URLs and aliases

### Projects
- List all projects in a team or personal account
- Inspect project settings (framework, root directory, build command, output directory)
- Create new projects
- Delete projects

### Environment Variables
- List environment variables for a project (all environments: production, preview, development)
- Add, update, or remove environment variables per environment
- Bulk-import environment variables

### Domains
- List domains assigned to a project
- Add a domain to a project
- Remove a domain from a project
- Check domain verification status

### Teams
- List teams and their members
- Get team details and billing info

### Edge Config
- Read Edge Config stores and their items
- Create, update, or delete Edge Config items

---

## How to Connect

1. Go to **Connectors** in your app and find **Vercel**
2. Enable it, then click **Connect**
3. A browser window opens to Vercel's OAuth consent screen
4. Log in to your Vercel account and click **Authorize**
5. The browser closes and the connector is ready

No API key to copy, no env var to set — the OAuth token is stored locally and refreshed automatically.

---

## OAuth Scopes

| Scope | Purpose |
|-------|---------|
| `deployments:read` | List and inspect deployments |
| `deployments:write` | Redeploy and cancel deployments |
| `projects:read` | List and inspect projects |
| `projects:write` | Create/update projects |
| `env:read` | Read environment variables |
| `env:write` | Add/update/delete environment variables |
| `domains:read` | List and inspect domains |
| `domains:write` | Add/remove domains |
| `teams:read` | List teams and members |
| `edge-config:read` | Read Edge Config stores |
| `edge-config:write` | Write to Edge Config stores |

Vercel may present a subset of these depending on your account type (Hobby vs Pro vs Enterprise).

---

## Example Prompts

### Check deployment status
```
What's the latest deployment status for my storefront project?
```

### Inspect a failed build
```
The last deployment of api-service failed. Show me the build logs and tell me what went wrong.
```

### Manage environment variables
```
Add a new environment variable DATABASE_URL to the production environment of my backend project.
```

### Redeploy to production
```
Redeploy the last successful preview deployment of my-app to production.
```

### Audit domains
```
List all domains assigned to each of my Vercel projects and flag any that are unverified.
```

### Cancel a stuck deployment
```
There's a deployment stuck in "Building" for the last 40 minutes. Cancel it.
```

### Review env var diff across environments
```
Compare the environment variables between production and preview for my-app. What's different?
```

---

## Disconnecting

1. Go to **Connectors**, find Vercel, and click **Disconnect**
2. To fully revoke, also go to **Vercel Dashboard** → **Account Settings** → **Integrations** and remove the authorization

---

## Troubleshooting

### Connection doesn't complete

The OAuth callback may have timed out. Click **Reconnect** and complete the browser flow again. If it persists, check that `localhost` is not blocked by a firewall or proxy on your machine.

### "Unauthorized" errors after a successful connect

Your refresh token may have been revoked (e.g., you changed your Vercel password or revoked the app from Vercel's dashboard). Disconnect and reconnect to re-authorize.

### Commands only return data for one team

Vercel's MCP server scopes responses to the team selected during OAuth. If you manage multiple teams, disconnect and reconnect — you can switch the active team context on Vercel's consent screen during the OAuth flow.

### Deployment logs are incomplete

Very large build logs may be truncated by the agent's tool output limit. Ask for a specific section ("show me just the error output") or download the full log from the Vercel dashboard.
