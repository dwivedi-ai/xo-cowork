/** Agent schemas — mirrors backend app/schemas/agent.py */

export interface PermissionRule {
  action: "allow" | "deny" | "ask";
  pattern: string;
}

export interface Ruleset {
  rules: PermissionRule[];
}

export interface AgentInfo {
  name: string;
  description: string;
  mode: "primary" | "subagent" | "hidden";
  tools: string[];
  permissions: Ruleset;
  system_prompt?: string | null;
  temperature?: number | null;
  metadata: Record<string, unknown>;
}

/** POST /api/agents — OpenClaw bridge */
export interface CreateAgentRequest {
  name: string;
  id?: string;
  description?: string;
  workspace?: string;
  backend?: "openclaw" | "claude_code";
}

/** GET/PATCH /api/agents/{id} — OpenClaw bridge (full snapshot) */
export interface AgentIdentityView {
  name: string | null;
  emoji: string | null;
  bio: string | null;
}

export interface AgentFullDetail {
  id: string;
  display_name: string;
  description: string;
  workspace: string;
  model: string | null;
  model_raw: unknown;
  identity: AgentIdentityView;
  config_entry: Record<string, unknown>;
  agents_defaults: Record<string, unknown>;
  workspace_files: Record<string, string | null>;
  on_disk: {
    agent_dir: string;
    models_catalog: unknown;
    auth_state: unknown;
    auth_profiles: unknown;
  };
  sessions: {
    index_path: string;
    count: number;
    session_ids: string[];
  };
  openclaw_global_auth: Record<string, { provider?: unknown; mode?: unknown; credentials?: string }>;
}

export interface UpdateAgentRequest {
  name?: string;
  description?: string;
  workspace?: string;
  model?: string | null;
  identity_name?: string | null;
  identity_emoji?: string | null;
}
