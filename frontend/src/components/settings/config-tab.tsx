"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Server,
  MessageSquare,
  Bot,
  Plug,
  Shield,
  Radio,
  Terminal,
  Info,
  Eye,
  EyeOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";
import { cn } from "@/lib/utils";

/* ── Types ────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ConfigData = Record<string, any>;

/* ── Inline help for confusing fields ─────────────────────────────────────── */

const FIELD_HELP: Record<string, string> = {
  "gateway.mode": "How OpenClaw runs: 'local' for self-hosted, 'cloud' for hosted.",
  "gateway.controlUi.dangerouslyDisableDeviceAuth":
    "Skips device-level authentication for the control UI. Only safe on trusted networks.",
  "gateway.controlUi.allowedOrigins":
    "Origins allowed to access the control UI (CORS). Use specific domains in production.",
  "gateway.http.endpoints.chatCompletions":
    "OpenAI-compatible /v1/chat/completions endpoint.",
  "gateway.http.endpoints.responses":
    "OpenAI-compatible /v1/responses endpoint.",
  "channels.*.dmPolicy":
    "'open' = anyone can DM the bot, 'allowlist' = only allowed users.",
  "channels.*.groupPolicy":
    "'allowlist' = bot only responds in explicitly allowed groups.",
  "channels.*.streaming.mode":
    "'partial' = edits messages with partial responses, 'full' = sends complete response.",
  "channels.whatsapp.selfChatMode":
    "When true, treats messages from your own number as commands.",
  "channels.whatsapp.debounceMs":
    "Waits this many ms to batch rapid messages before responding.",
  "channels.whatsapp.mediaMaxMb": "Maximum media file size in megabytes.",
  "agents.defaults.maxConcurrent":
    "Max number of agents that can run simultaneously.",
  "agents.defaults.subagents.maxConcurrent":
    "Max sub-agents each agent can spawn in parallel.",
  "agents.defaults.model.primary":
    "Default model used when no per-agent model is set.",
  "agents.defaults.sandbox.mode":
    "'off' = no sandboxing, 'docker' = isolated containers.",
  "commands.native": "'auto' detects and enables built-in commands.",
  "commands.nativeSkills": "'auto' detects and enables built-in skills.",
  "messages.ackReactionScope":
    "When to show acknowledgment reactions: 'all', 'group-mentions', or 'none'.",
  "plugins.entries.*":
    "Enable or disable individual plugins. Each plugin extends OpenClaw's capabilities.",
};

function getFieldHelp(path: string): string | undefined {
  if (FIELD_HELP[path]) return FIELD_HELP[path];
  // Try wildcard matches
  for (const [pattern, help] of Object.entries(FIELD_HELP)) {
    if (pattern.includes("*")) {
      const regex = new RegExp(
        "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, "[^.]+") + "$",
      );
      if (regex.test(path)) return help;
    }
  }
  return undefined;
}

/* ── Section config ───────────────────────────────────────────────────────── */

interface SectionMeta {
  icon: typeof Server;
  label: string;
  description: string;
}

const SECTION_META: Record<string, SectionMeta> = {
  gateway: {
    icon: Server,
    label: "Gateway",
    description: "Server mode, HTTP endpoints, and control UI settings",
  },
  channels: {
    icon: Radio,
    label: "Channels",
    description:
      "Messaging platform connections (Telegram, WhatsApp, Discord, etc.)",
  },
  agents: {
    icon: Bot,
    label: "Agents",
    description: "Agent definitions, defaults, models, and workspaces",
  },
  plugins: {
    icon: Plug,
    label: "Plugins",
    description: "Enable or disable plugins that extend OpenClaw",
  },
  commands: {
    icon: Terminal,
    label: "Commands",
    description: "Built-in command and skill detection settings",
  },
  messages: {
    icon: MessageSquare,
    label: "Messages",
    description: "Message handling and acknowledgment settings",
  },
  auth: {
    icon: Shield,
    label: "Auth",
    description: "Authentication profiles and provider credentials",
  },
};

const SECTION_ORDER = [
  "gateway",
  "channels",
  "agents",
  "plugins",
  "commands",
  "messages",
  "auth",
];
const META_SECTIONS = ["wizard", "meta"];

/* ── Value rendering ──────────────────────────────────────────────────────── */

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <Badge variant={enabled ? "success" : "secondary"} className="text-[10px] px-1.5 py-0">
      {enabled ? "Enabled" : "Disabled"}
    </Badge>
  );
}

function MaskedValue({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);
  const isMasked = value.includes("****") || /\*{3,}/.test(value);

  if (!isMasked) {
    return <span className="font-mono text-xs text-[var(--text-primary)]">{value}</span>;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-xs text-[var(--text-primary)]">
        {revealed ? value : value.slice(0, 4) + "****"}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
      >
        {revealed ? (
          <EyeOff className="h-3 w-3" />
        ) : (
          <Eye className="h-3 w-3" />
        )}
      </button>
    </span>
  );
}

function HelpTooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex ml-1">
      <Info className="h-3 w-3 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] cursor-help" />
      <span className="absolute left-5 top-0 z-50 hidden group-hover:block w-64 p-2 text-xs text-[var(--text-secondary)] bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-lg shadow-lg">
        {text}
      </span>
    </span>
  );
}

/* ── Recursive value renderer ─────────────────────────────────────────────── */

function ConfigValue({
  keyName,
  value,
  path,
  depth = 0,
}: {
  keyName: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  path: string;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  const help = getFieldHelp(path);

  // Primitive values
  if (value === null || value === undefined) {
    return (
      <div className="flex items-center gap-2 py-1" style={{ paddingLeft: depth * 16 }}>
        <span className="text-xs font-medium text-[var(--text-secondary)]">{keyName}</span>
        {help && <HelpTooltip text={help} />}
        <span className="font-mono text-xs text-[var(--text-tertiary)] italic">null</span>
      </div>
    );
  }

  if (typeof value === "boolean") {
    // Special handling for "enabled" fields
    if (keyName === "enabled") {
      return (
        <div className="flex items-center gap-2 py-1" style={{ paddingLeft: depth * 16 }}>
          <span className="text-xs font-medium text-[var(--text-secondary)]">{keyName}</span>
          {help && <HelpTooltip text={help} />}
          <StatusBadge enabled={value} />
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 py-1" style={{ paddingLeft: depth * 16 }}>
        <span className="text-xs font-medium text-[var(--text-secondary)]">{keyName}</span>
        {help && <HelpTooltip text={help} />}
        <Badge variant={value ? "success" : "secondary"} className="text-[10px] px-1.5 py-0">
          {value ? "true" : "false"}
        </Badge>
      </div>
    );
  }

  if (typeof value === "number") {
    return (
      <div className="flex items-center gap-2 py-1" style={{ paddingLeft: depth * 16 }}>
        <span className="text-xs font-medium text-[var(--text-secondary)]">{keyName}</span>
        {help && <HelpTooltip text={help} />}
        <span className="font-mono text-xs text-[var(--brand-primary)]">{value}</span>
      </div>
    );
  }

  if (typeof value === "string") {
    return (
      <div className="flex items-center gap-2 py-1" style={{ paddingLeft: depth * 16 }}>
        <span className="text-xs font-medium text-[var(--text-secondary)]">{keyName}</span>
        {help && <HelpTooltip text={help} />}
        <MaskedValue value={value} />
      </div>
    );
  }

  // Arrays
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div className="flex items-center gap-2 py-1" style={{ paddingLeft: depth * 16 }}>
          <span className="text-xs font-medium text-[var(--text-secondary)]">{keyName}</span>
          {help && <HelpTooltip text={help} />}
          <span className="font-mono text-xs text-[var(--text-tertiary)] italic">[]</span>
        </div>
      );
    }

    // Simple string/number arrays shown inline
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      return (
        <div className="py-1" style={{ paddingLeft: depth * 16 }}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--text-secondary)]">{keyName}</span>
            {help && <HelpTooltip text={help} />}
          </div>
          <div className="flex flex-wrap gap-1 mt-1 ml-4">
            {value.map((v, i) => (
              <Badge key={i} variant="outline" className="text-[10px] font-mono">
                {String(v)}
              </Badge>
            ))}
          </div>
        </div>
      );
    }

    // Complex arrays (like agents.list)
    return (
      <div className="py-1" style={{ paddingLeft: depth * 16 }}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {keyName}
          <span className="text-[10px] text-[var(--text-tertiary)] ml-1">
            ({value.length} {value.length === 1 ? "item" : "items"})
          </span>
        </button>
        {help && <HelpTooltip text={help} />}
        {open && (
          <div className="mt-1 space-y-1">
            {value.map((item, i) => (
              <div
                key={i}
                className="ml-4 border-l-2 border-[var(--border-default)] pl-3"
              >
                {typeof item === "object" && item !== null ? (
                  Object.entries(item).map(([k, v]) => (
                    <ConfigValue
                      key={k}
                      keyName={k}
                      value={v}
                      path={`${path}.${k}`}
                      depth={0}
                    />
                  ))
                ) : (
                  <span className="font-mono text-xs text-[var(--text-primary)]">
                    {String(item)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Objects
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return (
        <div className="flex items-center gap-2 py-1" style={{ paddingLeft: depth * 16 }}>
          <span className="text-xs font-medium text-[var(--text-secondary)]">{keyName}</span>
          <span className="font-mono text-xs text-[var(--text-tertiary)] italic">{"{}"}</span>
        </div>
      );
    }

    return (
      <div className="py-0.5" style={{ paddingLeft: depth * 16 }}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {keyName}
          {help && <HelpTooltip text={help} />}
        </button>
        {open && (
          <div className="mt-0.5">
            {entries.map(([k, v]) => (
              <ConfigValue
                key={k}
                keyName={k}
                value={v}
                path={`${path}.${k}`}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}

/* ── Channel card ─────────────────────────────────────────────────────────── */

function ChannelCard({
  name,
  config,
}: {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>;
}) {
  const [open, setOpen] = useState(false);
  const enabled = config.enabled !== false;

  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition-colors",
        enabled
          ? "border-[var(--border-default)] bg-[var(--surface-primary)]"
          : "border-[var(--border-default)] bg-[var(--surface-secondary)] opacity-60",
      )}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)]" /> : <ChevronRight className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />}
          <span className="text-sm font-medium text-[var(--text-primary)] capitalize">
            {name}
          </span>
          <StatusBadge enabled={enabled} />
        </div>
        <div className="flex items-center gap-2">
          {config.dmPolicy && (
            <Badge variant="outline" className="text-[10px]">
              DM: {config.dmPolicy}
            </Badge>
          )}
          {config.groupPolicy && (
            <Badge variant="outline" className="text-[10px]">
              Groups: {config.groupPolicy}
            </Badge>
          )}
        </div>
      </button>
      {open && (
        <div className="mt-3 pt-2 border-t border-[var(--border-default)]">
          {Object.entries(config)
            .filter(([k]) => k !== "enabled")
            .map(([k, v]) => (
              <ConfigValue
                key={k}
                keyName={k}
                value={v}
                path={`channels.${name}.${k}`}
                depth={0}
              />
            ))}
        </div>
      )}
    </div>
  );
}

/* ── Agent card ───────────────────────────────────────────────────────────── */

function AgentCard({
  agent,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: Record<string, any>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)]" /> : <ChevronRight className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />}
          <span className="text-sm font-medium text-[var(--text-primary)]">
            {agent.name || agent.id}
          </span>
          <Badge variant="outline" className="text-[10px] font-mono">
            {agent.id}
          </Badge>
        </div>
      </button>
      {open && (
        <div className="mt-3 pt-2 border-t border-[var(--border-default)]">
          {Object.entries(agent)
            .filter(([k]) => k !== "id" && k !== "name")
            .map(([k, v]) => (
              <ConfigValue key={k} keyName={k} value={v} path={`agents.list.${k}`} depth={0} />
            ))}
        </div>
      )}
    </div>
  );
}

/* ── Plugin row ───────────────────────────────────────────────────────────── */

function PluginRow({
  name,
  config,
}: {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>;
}) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors">
      <span className="text-xs font-medium text-[var(--text-primary)] capitalize">{name}</span>
      <StatusBadge enabled={config.enabled !== false} />
    </div>
  );
}

/* ── Section wrapper ──────────────────────────────────────────────────────── */

function ConfigSection({
  sectionKey,
  data,
  meta,
}: {
  sectionKey: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  meta: SectionMeta;
}) {
  const [open, setOpen] = useState(true);
  const Icon = meta.icon;

  // Custom rendering for channels
  if (sectionKey === "channels" && typeof data === "object" && data !== null) {
    return (
      <section className="space-y-3">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 w-full"
        >
          {open ? <ChevronDown className="h-4 w-4 text-[var(--text-tertiary)]" /> : <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)]" />}
          <Icon className="h-4 w-4 text-[var(--text-secondary)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {meta.label}
          </h3>
          <span className="text-xs text-[var(--text-tertiary)]">
            {meta.description}
          </span>
        </button>
        {open && (
          <div className="space-y-2 ml-6">
            {Object.entries(data).map(([name, cfg]) => (
              <ChannelCard
                key={name}
                name={name}
                config={cfg as Record<string, unknown>}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  // Custom rendering for agents
  if (sectionKey === "agents" && typeof data === "object" && data !== null) {
    return (
      <section className="space-y-3">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 w-full"
        >
          {open ? <ChevronDown className="h-4 w-4 text-[var(--text-tertiary)]" /> : <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)]" />}
          <Icon className="h-4 w-4 text-[var(--text-secondary)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {meta.label}
          </h3>
          <span className="text-xs text-[var(--text-tertiary)]">
            {meta.description}
          </span>
        </button>
        {open && (
          <div className="ml-6 space-y-4">
            {/* Defaults */}
            {data.defaults && (
              <div>
                <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-2 uppercase tracking-wider">
                  Defaults
                </h4>
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
                  {Object.entries(data.defaults).map(([k, v]) => (
                    <ConfigValue
                      key={k}
                      keyName={k}
                      value={v}
                      path={`agents.defaults.${k}`}
                      depth={0}
                    />
                  ))}
                </div>
              </div>
            )}
            {/* Agent list */}
            {data.list && Array.isArray(data.list) && (
              <div>
                <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-2 uppercase tracking-wider">
                  Agents ({data.list.length})
                </h4>
                <div className="space-y-2">
                  {data.list.map(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (agent: Record<string, any>, i: number) => (
                      <AgentCard key={agent.id || i} agent={agent} />
                    ),
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    );
  }

  // Custom rendering for plugins
  if (
    sectionKey === "plugins" &&
    typeof data === "object" &&
    data !== null &&
    data.entries
  ) {
    return (
      <section className="space-y-3">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 w-full"
        >
          {open ? <ChevronDown className="h-4 w-4 text-[var(--text-tertiary)]" /> : <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)]" />}
          <Icon className="h-4 w-4 text-[var(--text-secondary)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {meta.label}
          </h3>
          <span className="text-xs text-[var(--text-tertiary)]">
            {meta.description}
          </span>
        </button>
        {open && (
          <div className="ml-6 rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] divide-y divide-[var(--border-default)]">
            {Object.entries(data.entries).map(([name, cfg]) => (
              <PluginRow
                key={name}
                name={name}
                config={cfg as Record<string, unknown>}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  // Generic section rendering
  return (
    <section className="space-y-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full"
      >
        {open ? <ChevronDown className="h-4 w-4 text-[var(--text-tertiary)]" /> : <ChevronRight className="h-4 w-4 text-[var(--text-tertiary)]" />}
        <Icon className="h-4 w-4 text-[var(--text-secondary)]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {meta.label}
        </h3>
        <span className="text-xs text-[var(--text-tertiary)]">
          {meta.description}
        </span>
      </button>
      {open && (
        <div className="ml-6 rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
          {typeof data === "object" && data !== null ? (
            Object.entries(data).map(([k, v]) => (
              <ConfigValue
                key={k}
                keyName={k}
                value={v}
                path={`${sectionKey}.${k}`}
                depth={0}
              />
            ))
          ) : (
            <span className="font-mono text-xs text-[var(--text-primary)]">
              {JSON.stringify(data)}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

/* ── Main tab ─────────────────────────────────────────────────────────────── */

export function ConfigTab() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ConfigData>(API.CONFIG.OPENCLAW);
      setConfig(res);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load OpenClaw config",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <section>
        <div className="flex items-start justify-between mb-1">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              OpenClaw Configuration
            </h2>
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
              Visual overview of{" "}
              <code className="font-mono">~/.openclaw/openclaw.json</code>
              {" "}&mdash; sensitive values like tokens and API keys are masked.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors disabled:opacity-40"
            title="Reload"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </section>

      <Separator />

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="space-y-2">
              <div className="h-5 w-32 rounded bg-[var(--surface-secondary)] animate-pulse" />
              <div className="h-20 rounded-xl bg-[var(--surface-secondary)] animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="rounded-xl border border-[var(--color-destructive)] bg-[var(--surface-secondary)] p-4">
          <p className="text-xs text-[var(--color-destructive)]">{error}</p>
        </div>
      )}

      {/* Config sections */}
      {config && !loading && (
        <div className="space-y-6">
          {SECTION_ORDER.filter((key) => config[key] !== undefined).map(
            (key) => (
              <div key={key}>
                <ConfigSection
                  sectionKey={key}
                  data={config[key]}
                  meta={
                    SECTION_META[key] || {
                      icon: Info,
                      label: key,
                      description: "",
                    }
                  }
                />
                <Separator className="mt-6" />
              </div>
            ),
          )}

          {/* Meta info (wizard, meta) */}
          {META_SECTIONS.some((k) => config[k]) && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-[var(--text-secondary)]" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Metadata
                </h3>
                <span className="text-xs text-[var(--text-tertiary)]">
                  Wizard state and version tracking
                </span>
              </div>
              <div className="ml-6 rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
                {META_SECTIONS.filter((k) => config[k]).map((k) => (
                  <ConfigValue
                    key={k}
                    keyName={k}
                    value={config[k]}
                    path={k}
                    depth={0}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Unrecognized top-level keys */}
          {Object.keys(config)
            .filter(
              (k) =>
                !SECTION_ORDER.includes(k) &&
                !META_SECTIONS.includes(k) &&
                !k.startsWith("$"),
            )
            .length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-[var(--color-warning)]" />
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Other
                </h3>
                <span className="text-xs text-[var(--text-tertiary)]">
                  Additional top-level keys not in the standard schema
                </span>
              </div>
              <div className="ml-6 rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-3">
                {Object.entries(config)
                  .filter(
                    ([k]) =>
                      !SECTION_ORDER.includes(k) &&
                      !META_SECTIONS.includes(k) &&
                      !k.startsWith("$"),
                  )
                  .map(([k, v]) => (
                    <ConfigValue key={k} keyName={k} value={v} path={k} depth={0} />
                  ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
