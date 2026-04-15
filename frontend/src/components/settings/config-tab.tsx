"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  RefreshCw,
  ChevronDown,
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
  FileJson,
  AlertTriangle,
} from "lucide-react";
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

/* ── Primitives ───────────────────────────────────────────────────────────── */

function StatusPill({ enabled, label }: { enabled: boolean; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        enabled
          ? "border-[var(--color-success)]/30 bg-[var(--color-success)]/10 text-[var(--color-success)]"
          : "border-[var(--border-default)] bg-[var(--surface-secondary)] text-[var(--text-tertiary)]",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          enabled ? "bg-[var(--color-success)]" : "bg-[var(--text-tertiary)]",
        )}
      />
      {label ?? (enabled ? "Enabled" : "Disabled")}
    </span>
  );
}

function KeyChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-[var(--border-default)] bg-[var(--surface-secondary)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">
      {children}
    </span>
  );
}

function MaskedValue({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);
  const isMasked = value.includes("****") || /\*{3,}/.test(value);

  if (!isMasked) {
    return (
      <span className="font-mono text-xs text-[var(--text-primary)]">
        {value}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono text-xs text-[var(--text-primary)]">
        {revealed ? value : value.slice(0, 4) + "••••••••"}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
        aria-label={revealed ? "Hide value" : "Reveal value"}
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
    <span className="group/tip relative inline-flex">
      <Info className="h-3 w-3 cursor-help text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]" />
      <span className="pointer-events-none absolute left-5 top-0 z-50 hidden w-64 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] p-2.5 text-[11px] leading-relaxed text-[var(--text-secondary)] shadow-lg group-hover/tip:block">
        {text}
      </span>
    </span>
  );
}

function Row({
  label,
  help,
  children,
  depth = 0,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
  depth?: number;
}) {
  return (
    <div
      className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-[var(--border-default)]/40 py-2 last:border-b-0"
      style={{ paddingLeft: depth * 14 }}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-mono text-[11px] text-[var(--text-secondary)]">
          {label}
        </span>
        {help && <HelpTooltip text={help} />}
      </div>
      <div className="flex items-center justify-end text-right">{children}</div>
    </div>
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

  if (value === null || value === undefined) {
    return (
      <Row label={keyName} help={help} depth={depth}>
        <span className="font-mono text-[11px] italic text-[var(--text-tertiary)]">
          null
        </span>
      </Row>
    );
  }

  if (typeof value === "boolean") {
    return (
      <Row label={keyName} help={help} depth={depth}>
        <StatusPill
          enabled={value}
          label={keyName === "enabled" ? undefined : value ? "True" : "False"}
        />
      </Row>
    );
  }

  if (typeof value === "number") {
    return (
      <Row label={keyName} help={help} depth={depth}>
        <span className="font-mono text-xs tabular-nums text-[var(--text-primary)]">
          {value}
        </span>
      </Row>
    );
  }

  if (typeof value === "string") {
    return (
      <Row label={keyName} help={help} depth={depth}>
        <MaskedValue value={value} />
      </Row>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <Row label={keyName} help={help} depth={depth}>
          <span className="font-mono text-[11px] italic text-[var(--text-tertiary)]">
            [ ]
          </span>
        </Row>
      );
    }

    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      return (
        <div
          className="border-b border-[var(--border-default)]/40 py-2 last:border-b-0"
          style={{ paddingLeft: depth * 14 }}
        >
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] text-[var(--text-secondary)]">
              {keyName}
            </span>
            {help && <HelpTooltip text={help} />}
            <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">
              {value.length}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {value.map((v, i) => (
              <KeyChip key={i}>{String(v)}</KeyChip>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div
        className="border-b border-[var(--border-default)]/40 py-2 last:border-b-0"
        style={{ paddingLeft: depth * 14 }}
      >
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1.5 text-left transition-colors"
          type="button"
        >
          <ChevronDown
            className={cn(
              "h-3 w-3 shrink-0 text-[var(--text-tertiary)] transition-transform",
              !open && "-rotate-90",
            )}
          />
          <span className="font-mono text-[11px] text-[var(--text-secondary)]">
            {keyName}
          </span>
          {help && <HelpTooltip text={help} />}
          <span className="ml-auto font-mono text-[10px] text-[var(--text-tertiary)]">
            {value.length} {value.length === 1 ? "item" : "items"}
          </span>
        </button>
        {open && (
          <div className="mt-2 space-y-2">
            {value.map((item, i) => (
              <div
                key={i}
                className="ml-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)]/60 px-3 py-2"
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

  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return (
        <Row label={keyName} help={help} depth={depth}>
          <span className="font-mono text-[11px] italic text-[var(--text-tertiary)]">
            {"{ }"}
          </span>
        </Row>
      );
    }

    return (
      <div
        className="border-b border-[var(--border-default)]/40 py-1 last:border-b-0"
        style={{ paddingLeft: depth * 14 }}
      >
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1.5"
          type="button"
        >
          <ChevronDown
            className={cn(
              "h-3 w-3 shrink-0 text-[var(--text-tertiary)] transition-transform",
              !open && "-rotate-90",
            )}
          />
          <span className="font-mono text-[11px] text-[var(--text-secondary)]">
            {keyName}
          </span>
          {help && <HelpTooltip text={help} />}
          <span className="ml-auto font-mono text-[10px] text-[var(--text-tertiary)]">
            {entries.length}
          </span>
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
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border bg-[var(--surface-primary)] transition-all",
        enabled
          ? "border-[var(--border-default)]"
          : "border-[var(--border-default)] opacity-70",
      )}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-secondary)]"
        type="button"
      >
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-mono text-[11px] font-bold tracking-wider",
            enabled
              ? "border-[var(--border-default)] bg-[var(--surface-secondary)] text-[var(--text-primary)]"
              : "border-[var(--border-default)] bg-[var(--surface-secondary)] text-[var(--text-tertiary)]",
          )}
        >
          {initials}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold capitalize text-[var(--text-primary)]">
              {name}
            </span>
            <StatusPill enabled={enabled} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">
            {config.dmPolicy && (
              <span className="font-mono">DM · {config.dmPolicy}</span>
            )}
            {config.dmPolicy && config.groupPolicy && (
              <span className="text-[var(--border-default)]">•</span>
            )}
            {config.groupPolicy && (
              <span className="font-mono">Groups · {config.groupPolicy}</span>
            )}
          </div>
        </div>

        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>

      {open && (
        <div className="border-t border-[var(--border-default)] bg-[var(--surface-secondary)]/40 px-4 py-2">
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
  const displayName = agent.name || agent.id;
  const initial = displayName?.slice(0, 1).toUpperCase() || "?";

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-secondary)]"
        type="button"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)]">
          <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">
            {initial}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {displayName}
            </span>
            <KeyChip>{agent.id}</KeyChip>
          </div>
          {agent.workspace && (
            <div
              className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-tertiary)]"
              title={agent.workspace}
            >
              {agent.workspace}
            </div>
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>

      {open && (
        <div className="border-t border-[var(--border-default)] bg-[var(--surface-secondary)]/40 px-4 py-2">
          {Object.entries(agent)
            .filter(([k]) => k !== "id" && k !== "name")
            .map(([k, v]) => (
              <ConfigValue
                key={k}
                keyName={k}
                value={v}
                path={`agents.list.${k}`}
                depth={0}
              />
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
  const enabled = config.enabled !== false;
  const initial = name.slice(0, 1).toUpperCase();

  return (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-secondary)]">
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border font-mono text-[11px] font-bold",
          enabled
            ? "border-[var(--border-default)] bg-[var(--surface-secondary)] text-[var(--text-primary)]"
            : "border-[var(--border-default)] bg-[var(--surface-secondary)] text-[var(--text-tertiary)]",
        )}
      >
        {initial}
      </div>
      <span className="flex-1 text-sm font-medium capitalize text-[var(--text-primary)]">
        {name}
      </span>
      <StatusPill enabled={enabled} />
    </div>
  );
}

/* ── Section card shell ───────────────────────────────────────────────────── */

function SectionShell({
  icon: Icon,
  label,
  description,
  summary,
  defaultOpen = true,
  children,
}: {
  icon: typeof Server;
  label: string;
  description: string;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-4 p-5 text-left transition-colors hover:bg-[var(--surface-secondary)]/50"
        type="button"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)]">
          <Icon className="h-4.5 w-4.5 text-[var(--text-primary)]" />
        </div>

        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold leading-none text-[var(--text-primary)]">
              {label}
            </h3>
            {summary}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">
            {description}
          </p>
        </div>

        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 translate-y-1 text-[var(--text-tertiary)] transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>

      {open && (
        <div className="border-t border-[var(--border-default)] bg-[var(--surface-secondary)]/30 p-5">
          {children}
        </div>
      )}
    </section>
  );
}

function SubHeading({
  label,
  count,
}: {
  label: string;
  count?: number | string;
}) {
  return (
    <div className="mb-2.5 flex items-center gap-2 px-1">
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
        {label}
      </h4>
      {count !== undefined && (
        <span className="rounded-sm bg-[var(--surface-secondary)] px-1 py-px font-mono text-[10px] text-[var(--text-secondary)]">
          {count}
        </span>
      )}
      <div className="h-px flex-1 bg-[var(--border-default)]" />
    </div>
  );
}

/* ── Section rendering variants ───────────────────────────────────────────── */

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
  // Channels: grid of channel cards
  if (sectionKey === "channels" && typeof data === "object" && data !== null) {
    const entries = Object.entries(data);
    const enabledCount = entries.filter(
      ([, cfg]) => (cfg as { enabled?: boolean })?.enabled !== false,
    ).length;
    return (
      <SectionShell
        icon={meta.icon}
        label={meta.label}
        description={meta.description}
        summary={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
            <span className="font-mono">{entries.length}</span>
            <span className="text-[var(--text-tertiary)]">·</span>
            <span className="text-[var(--color-success)]">
              {enabledCount} active
            </span>
          </span>
        }
      >
        <div className="grid gap-2">
          {entries.map(([name, cfg]) => (
            <ChannelCard
              key={name}
              name={name}
              config={cfg as Record<string, unknown>}
            />
          ))}
        </div>
      </SectionShell>
    );
  }

  // Agents: defaults + cards list
  if (sectionKey === "agents" && typeof data === "object" && data !== null) {
    const list = Array.isArray(data.list) ? data.list : [];
    return (
      <SectionShell
        icon={meta.icon}
        label={meta.label}
        description={meta.description}
        summary={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
            <span className="font-mono">{list.length}</span>
            <span>{list.length === 1 ? "agent" : "agents"}</span>
          </span>
        }
      >
        <div className="space-y-5">
          {data.defaults && (
            <div>
              <SubHeading label="Defaults" />
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2">
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

          {list.length > 0 && (
            <div>
              <SubHeading label="Agents" count={list.length} />
              <div className="grid gap-2">
                {list.map(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (agent: Record<string, any>, i: number) => (
                    <AgentCard key={agent.id || i} agent={agent} />
                  ),
                )}
              </div>
            </div>
          )}
        </div>
      </SectionShell>
    );
  }

  // Plugins
  if (
    sectionKey === "plugins" &&
    typeof data === "object" &&
    data !== null &&
    data.entries
  ) {
    const entries = Object.entries(data.entries);
    const enabledCount = entries.filter(
      ([, cfg]) => (cfg as { enabled?: boolean })?.enabled !== false,
    ).length;

    return (
      <SectionShell
        icon={meta.icon}
        label={meta.label}
        description={meta.description}
        summary={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-secondary)]">
            <span className="font-mono">{enabledCount}</span>
            <span>/</span>
            <span className="font-mono">{entries.length}</span>
            <span className="text-[var(--text-tertiary)]">enabled</span>
          </span>
        }
      >
        <div className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] divide-y divide-[var(--border-default)]">
          {entries.map(([name, cfg]) => (
            <PluginRow
              key={name}
              name={name}
              config={cfg as Record<string, unknown>}
            />
          ))}
        </div>
      </SectionShell>
    );
  }

  // Generic
  return (
    <SectionShell
      icon={meta.icon}
      label={meta.label}
      description={meta.description}
    >
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2">
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
    </SectionShell>
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

  const topLevelStats = useMemo(() => {
    if (!config) return { keys: 0, sections: 0 };
    const allKeys = Object.keys(config).filter((k) => !k.startsWith("$"));
    const sections = allKeys.filter(
      (k) => SECTION_ORDER.includes(k) || META_SECTIONS.includes(k),
    );
    return { keys: allKeys.length, sections: sections.length };
  }, [config]);

  const unknownKeys = useMemo(() => {
    if (!config) return [];
    return Object.keys(config).filter(
      (k) =>
        !SECTION_ORDER.includes(k) &&
        !META_SECTIONS.includes(k) &&
        !k.startsWith("$"),
    );
  }, [config]);

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="relative overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-secondary)]">
        <div className="pointer-events-none absolute -right-10 -top-10 opacity-[0.04]">
          <FileJson className="h-56 w-56 text-[var(--text-primary)]" />
        </div>

        <div className="relative flex items-start gap-4 p-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] shadow-sm">
            <FileJson className="h-5 w-5 text-[var(--text-primary)]" />
          </div>

          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <h2 className="text-base font-semibold leading-none text-[var(--text-primary)]">
                OpenClaw Configuration
              </h2>
              <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">
                ~/.openclaw/openclaw.json
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
              Live view of your workspace config. Sensitive values like tokens
              and API keys are masked by default — click the eye icon to reveal.
            </p>

            {config && !loading && (
              <div className="mt-3 flex items-center gap-3 text-[10px] font-mono text-[var(--text-tertiary)]">
                <span>
                  <span className="text-[var(--text-secondary)]">
                    {topLevelStats.sections}
                  </span>{" "}
                  sections
                </span>
                <span className="text-[var(--border-default)]">•</span>
                <span>
                  <span className="text-[var(--text-secondary)]">
                    {topLevelStats.keys}
                  </span>{" "}
                  top-level keys
                </span>
              </div>
            )}
          </div>

          <button
            onClick={load}
            disabled={loading}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 text-xs font-medium text-[var(--text-secondary)] transition-all hover:border-[var(--text-primary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            title="Reload"
            type="button"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", loading && "animate-spin")}
            />
            Reload
          </button>
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((n) => (
            <div
              key={n}
              className="h-[88px] animate-pulse rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)]"
              style={{ animationDelay: `${n * 80}ms` }}
            />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="flex items-start gap-3 rounded-2xl border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/5 p-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/10">
            <AlertTriangle className="h-4 w-4 text-[var(--color-destructive)]" />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-sm font-medium text-[var(--color-destructive)]">
              Failed to load configuration
            </p>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              {error}
            </p>
          </div>
          <button
            onClick={load}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 text-[11px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-secondary)]"
            type="button"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      )}

      {/* Config sections */}
      {config && !loading && (
        <div className="space-y-3">
          {SECTION_ORDER.filter((key) => config[key] !== undefined).map(
            (key) => (
              <ConfigSection
                key={key}
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
            ),
          )}

          {/* Meta info (wizard, meta) */}
          {META_SECTIONS.some((k) => config[k]) && (
            <SectionShell
              icon={Info}
              label="Metadata"
              description="Wizard state and version tracking"
              defaultOpen={false}
            >
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2">
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
            </SectionShell>
          )}

          {/* Unrecognized top-level keys */}
          {unknownKeys.length > 0 && (
            <SectionShell
              icon={AlertTriangle}
              label="Unrecognized keys"
              description="Additional top-level keys not in the standard schema"
              defaultOpen={false}
              summary={
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-secondary)]">
                  {unknownKeys.length}
                </span>
              }
            >
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] px-4 py-2">
                {unknownKeys.map((k) => (
                  <ConfigValue
                    key={k}
                    keyName={k}
                    value={config[k]}
                    path={k}
                    depth={0}
                  />
                ))}
              </div>
            </SectionShell>
          )}
        </div>
      )}
    </div>
  );
}
