"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useAppRouter } from "@/lib/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Building2,
  Cpu,
  Radio,
  FolderKanban,
  Sparkles,
  ChevronRight,
  Eye,
  EyeOff,
  ExternalLink,
  Plus,
  Zap,
  AlertCircle,
  RefreshCw,
  Info,
  Copy,
} from "lucide-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/stores/settings-store";
import { api, ApiError } from "@/lib/api";
import { API, IS_DESKTOP, resolveCoworkApiUrl, queryKeys } from "@/lib/constants";
import { desktopAPI } from "@/lib/tauri-api";
import { consumeCodexSetupStream } from "@/lib/codex-device-auth";
import {
  WhatsAppIcon,
  DiscordIcon,
  TelegramIcon,
  SlackIcon,
} from "@/components/icons/platform-icons";
import { toast } from "sonner";
import { PersonalityStep } from "./personality-step";
import type { PersonalityContent } from "@/hooks/use-personality-files";

const WORKSPACE_ROOT = "/home/coder/.openclaw/workspace";

/* ------------------------------------------------------------------ */
/* Slide animation                                                     */
/* ------------------------------------------------------------------ */

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -60 : 60, opacity: 0 }),
};

const transition = { duration: 0.28, ease: [0.25, 0.1, 0.25, 1] as const };

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Step = "company" | "models" | "channels" | "personality" | "project";

const STEPS: Step[] = ["company", "models", "channels", "personality", "project"];

const STEP_META: Record<Step, { icon: React.ReactNode; label: string; description: string }> = {
  company: {
    icon: <Building2 className="h-5 w-5" />,
    label: "Your Company",
    description: "Name your workspace",
  },
  models: {
    icon: <Cpu className="h-5 w-5" />,
    label: "AI Models",
    description: "Connect an AI provider",
  },
  channels: {
    icon: <Radio className="h-5 w-5" />,
    label: "Channels",
    description: "Link messaging apps",
  },
  personality: {
    icon: <Sparkles className="h-5 w-5" />,
    label: "Personality",
    description: "Shape your agent",
  },
  project: {
    icon: <FolderKanban className="h-5 w-5" />,
    label: "First Project",
    description: "Create your first chat",
  },
};

/* ------------------------------------------------------------------ */
/* Platforms                                                           */
/* ------------------------------------------------------------------ */

interface PlatformField {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
}

interface Platform {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  auth: "token" | "qr";
  help: string;
  helpUrl?: string;
  fields?: PlatformField[];
  hidden?: boolean;
}

const PLATFORMS: Platform[] = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    icon: <WhatsAppIcon size={20} />,
    color: "text-[#25D366]",
    auth: "qr",
    help: "Scan QR with your phone to link WhatsApp",
    hidden: true,
  },
  {
    id: "discord",
    name: "Discord",
    icon: <DiscordIcon size={20} />,
    color: "text-[#5865F2]",
    auth: "token",
    help: "Create a bot at Discord Developer Portal",
    helpUrl: "https://discord.com/developers/applications",
    fields: [{ key: "token", label: "Bot Token", placeholder: "Paste Discord bot token", secret: true }],
  },
  {
    id: "telegram",
    name: "Telegram",
    icon: <TelegramIcon size={20} />,
    color: "text-[#26A5E4]",
    auth: "token",
    help: "Get a token from @BotFather on Telegram",
    helpUrl: "https://t.me/BotFather",
    fields: [{ key: "token", label: "Bot Token", placeholder: "123456:ABC-DEF...", secret: true }],
  },
  {
    id: "slack",
    name: "Slack",
    icon: <SlackIcon size={20} />,
    color: "text-[#E01E5A]",
    auth: "token",
    help: "Create an app at api.slack.com/apps",
    helpUrl: "https://api.slack.com/apps",
    fields: [
      { key: "bot_token", label: "Bot Token", placeholder: "xoxb-...", secret: true },
      { key: "app_token", label: "App Token", placeholder: "xapp-...", secret: true },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Step 1 — Company Name                                               */
/* ------------------------------------------------------------------ */

function CompanyStep({
  value,
  onChange,
  onNext,
}: {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-col">
      <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-1">
        What&apos;s your company called?
      </h2>
      <p className="text-sm text-[var(--text-secondary)] mb-6">
        This name will appear throughout your workspace.
      </p>

      <Input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Acme Corp"
        className="h-11 text-base"
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) onNext();
        }}
      />

      <Button
        className="w-full mt-4"
        disabled={!value.trim()}
        onClick={onNext}
      >
        Continue
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 — AI Models                                                  */
/* ------------------------------------------------------------------ */

type ModelProvider = "anthropic" | "openai" | "other";
type OpenAIMode = "apikey" | "codex";

function ApiKeyField({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10 font-mono text-sm"
        autoFocus={autoFocus}
        spellCheck={false}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function ProviderOption({
  selected,
  onSelect,
  label,
  badge,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  badge?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border transition-all ${
        selected
          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5"
          : "border-[var(--border-default)] bg-[var(--surface-secondary)]"
      }`}
    >
      <button
        onClick={onSelect}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <div
          className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
            selected
              ? "border-[var(--color-primary)] bg-[var(--color-primary)]"
              : "border-[var(--border-strong)]"
          }`}
        >
          {selected && <Check className="h-2.5 w-2.5 text-white" />}
        </div>
        <span className="text-sm font-medium text-[var(--text-primary)] flex-1">{label}</span>
        {badge && (
          typeof badge === "string" ? (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
              {badge}
            </span>
          ) : (
            badge
          )
        )}
      </button>

      <AnimatePresence>
        {selected && children && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function GatewayRestartNotice() {
  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-2.5 py-2">
      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--text-tertiary)]" />
      <p className="text-[11px] leading-snug text-[var(--text-secondary)]">
        Restart the Gateway from{" "}
        <span className="font-medium text-[var(--text-primary)]">Settings → Channels</span>{" "}
        to apply these changes.
      </p>
    </div>
  );
}

function ModelsStep({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip: () => void;
}) {
  const qc = useQueryClient();
  const { setActiveProvider } = useSettingsStore();

  // If OpenClaw's `.env` already has ANTHROPIC_API_KEY or OPENAI_API_KEY,
  // let the user skip this step instead of forcing a re-entry.
  // Reads only the keys (no plaintext values cross the wire) and is
  // prefetched at OnboardingScreen mount, so the cache is hot by the
  // time this step renders.
  const { data: envKeysData } = useQuery({
    queryKey: ["secrets-env-keys"],
    queryFn: () => api.get<{ keys: string[] }>(API.SECRETS.ENV_KEYS),
    staleTime: 30_000,
  });

  const detectedEnvKeys = useMemo<("ANTHROPIC_API_KEY" | "OPENAI_API_KEY")[]>(() => {
    const keys = envKeysData?.keys ?? [];
    const detected: ("ANTHROPIC_API_KEY" | "OPENAI_API_KEY")[] = [];
    if (keys.includes("ANTHROPIC_API_KEY")) detected.push("ANTHROPIC_API_KEY");
    if (keys.includes("OPENAI_API_KEY")) detected.push("OPENAI_API_KEY");
    return detected;
  }, [envKeysData]);

  const [selected, setSelected] = useState<ModelProvider>("anthropic");

  // Anthropic state
  const [anthropicKey, setAnthropicKey] = useState("");
  const [anthropicSaving, setAnthropicSaving] = useState(false);
  const [anthropicSaved, setAnthropicSaved] = useState(false);
  const [anthropicError, setAnthropicError] = useState<string | null>(null);

  // OpenAI state
  const [openaiMode, setOpenaiMode] = useState<OpenAIMode>("apikey");
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiSaving, setOpenaiSaving] = useState(false);
  const [openaiSaved, setOpenaiSaved] = useState(false);
  const [openaiError, setOpenaiError] = useState<string | null>(null);

  // Codex state
  const { data: codexStatus } = useQuery({
    queryKey: queryKeys.codexStatus,
    queryFn: () =>
      api.get<{
        is_connected: boolean;
        email: string;
        accounts?: { id: string; email: string; expires?: number }[];
      }>(API.CODEX.STATUS),
    refetchInterval: 10_000,
  });
  const [codexConnecting, setCodexConnecting] = useState(false);
  const [codexAuthUrl, setCodexAuthUrl] = useState<string | null>(null);
  const [codexUserCode, setCodexUserCode] = useState<string | null>(null);
  const [codexInstalling, setCodexInstalling] = useState(false);
  const [codexCodeCopied, setCodexCodeCopied] = useState(false);
  const [codexError, setCodexError] = useState<string | null>(null);
  const codexAbortRef = useRef<AbortController | null>(null);
  const codexOpenedRef = useRef(false);

  const openCodexUrl = useCallback((u: string) => {
    if (codexOpenedRef.current) return;
    codexOpenedRef.current = true;
    if (IS_DESKTOP) desktopAPI.openExternal(u);
    else window.open(u, "_blank", "noopener,noreferrer");
  }, []);

  const copyCodexCode = useCallback(async () => {
    if (!codexUserCode) return;
    try {
      await navigator.clipboard.writeText(codexUserCode);
      setCodexCodeCopied(true);
      setTimeout(() => setCodexCodeCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }, [codexUserCode]);

  const startCodexSetup = useCallback(async () => {
    setCodexError(null);
    setCodexConnecting(true);
    setCodexInstalling(false);
    setCodexAuthUrl(null);
    setCodexUserCode(null);
    codexOpenedRef.current = false;

    const ctrl = new AbortController();
    codexAbortRef.current = ctrl;

    try {
      const url = resolveCoworkApiUrl(API.CODEX.SETUP);
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
      });
      if (!resp.ok || !resp.body) {
        setCodexError("Codex sign-in failed. Please try again.");
        setCodexConnecting(false);
        return;
      }

      await consumeCodexSetupStream(resp.body, {
        onInstalling: () => setCodexInstalling(true),
        onUrl: (u) => {
          setCodexAuthUrl(u);
          openCodexUrl(u);
        },
        onCode: (c) => setCodexUserCode(c),
        onDone: (rc) => {
          setCodexInstalling(false);
          if (rc === 0) {
            qc.invalidateQueries({ queryKey: queryKeys.codexStatus });
            qc.refetchQueries({ queryKey: queryKeys.codexStatus });
            setCodexConnecting(false);
            setCodexAuthUrl(null);
            setCodexUserCode(null);
          } else {
            setCodexError("Codex sign-in failed. Please try again.");
            setCodexConnecting(false);
          }
        },
        onError: (msg) => {
          setCodexError(msg || "Codex setup error");
          setCodexInstalling(false);
          setCodexConnecting(false);
        },
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setCodexError(String(e));
        setCodexConnecting(false);
      }
    }
  }, [qc, openCodexUrl]);

  const cancelCodexSetup = useCallback(() => {
    codexAbortRef.current?.abort();
    setCodexConnecting(false);
    setCodexInstalling(false);
    setCodexAuthUrl(null);
    setCodexUserCode(null);
    setCodexError(null);
  }, []);

  const codexConnected = codexStatus?.is_connected ?? false;

  // Other (env var) state
  const [envKey, setEnvKey] = useState("");
  const [envValue, setEnvValue] = useState("");
  const [envSaving, setEnvSaving] = useState(false);
  const [envSaved, setEnvSaved] = useState(false);
  const [envError, setEnvError] = useState<string | null>(null);

  const saveAnthropicKey = async () => {
    if (!anthropicKey.trim()) return;
    setAnthropicSaving(true);
    setAnthropicError(null);
    try {
      await api.post(API.CONFIG.PROVIDER_KEY("anthropic"), { api_key: anthropicKey.trim() });
      setActiveProvider("byok");
      qc.invalidateQueries({ queryKey: queryKeys.models });
      setAnthropicSaved(true);
      setAnthropicKey("");
    } catch {
      setAnthropicError("Invalid key or network error. Please try again.");
    } finally {
      setAnthropicSaving(false);
    }
  };

  const saveOpenaiKey = async () => {
    if (!openaiKey.trim()) return;
    setOpenaiSaving(true);
    setOpenaiError(null);
    try {
      await api.post(API.CONFIG.PROVIDER_KEY("openai"), { api_key: openaiKey.trim() });
      setActiveProvider("byok");
      qc.invalidateQueries({ queryKey: queryKeys.models });
      setOpenaiSaved(true);
      setOpenaiKey("");
    } catch {
      setOpenaiError("Invalid key or network error. Please try again.");
    } finally {
      setOpenaiSaving(false);
    }
  };

const saveEnvVar = async () => {
    if (!envKey.trim() || !envValue.trim()) return;
    setEnvSaving(true);
    setEnvError(null);
    try {
      const existing = await api.get<{ entries: { key: string; value: string }[] }>(API.SECRETS.ENV);
      const entries = [
        ...existing.entries.filter((e) => e.key !== envKey.trim()),
        { key: envKey.trim(), value: envValue.trim() },
      ];
      await api.put(API.SECRETS.ENV, { entries });
      setEnvSaved(true);
      setEnvKey("");
      setEnvValue("");
    } catch {
      setEnvError("Failed to save. Please try again.");
    } finally {
      setEnvSaving(false);
    }
  };

  const canContinue =
    selected === "anthropic" ? anthropicSaved :
    selected === "openai" ? (openaiSaved || codexConnected) :
    selected === "other" ? envSaved :
    false;

  return (
    <div className="flex flex-col">
      <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-1">
        Add an AI model
      </h2>
      <p className="text-sm text-[var(--text-secondary)] mb-5">
        Connect a provider to power your assistant.
      </p>

      {detectedEnvKeys.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2">
          <Check className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--color-success)]" />
          <p className="text-[11px] leading-snug text-[var(--text-secondary)]">
            {detectedEnvKeys.map((k, i) => (
              <span key={k}>
                {i > 0 && (i === detectedEnvKeys.length - 1 ? " and " : ", ")}
                <span className="font-mono font-medium text-[var(--text-primary)]">{k}</span>
              </span>
            ))}{" "}
            {detectedEnvKeys.length > 1 ? "are" : "is"} already set in your OpenClaw
            environment. You can skip this step or pick a different provider below.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {/* Anthropic */}
        <ProviderOption
          selected={selected === "anthropic"}
          onSelect={() => setSelected("anthropic")}
          label="Anthropic"
          badge="Recommended"
        >
          <p className="text-xs text-[var(--text-tertiary)] mb-2">
            Paste your Anthropic API key from{" "}
            <a href="https://console.anthropic.com/keys" target="_blank" rel="noopener noreferrer"
              className="text-[var(--color-primary)] hover:underline inline-flex items-center gap-0.5">
              console.anthropic.com <ExternalLink className="h-3 w-3" />
            </a>
          </p>
          <ApiKeyField
            value={anthropicKey}
            onChange={setAnthropicKey}
            placeholder="sk-ant-..."
            autoFocus
          />
          {anthropicError && <p className="text-xs text-[var(--color-destructive)] mt-1.5">{anthropicError}</p>}
          {anthropicSaved && (
            <p className="text-xs text-[var(--color-success)] mt-1.5 flex items-center gap-1">
              <Check className="h-3 w-3" /> Anthropic key saved
            </p>
          )}
          <Button
            size="sm"
            className="w-full mt-2"
            disabled={!anthropicKey.trim() || anthropicSaving || anthropicSaved}
            onClick={saveAnthropicKey}
          >
            {anthropicSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : anthropicSaved ? "Saved" : "Save Key"}
          </Button>
          {anthropicSaved && <GatewayRestartNotice />}
        </ProviderOption>

        {/* OpenAI */}
        <ProviderOption
          selected={selected === "openai"}
          onSelect={() => setSelected("openai")}
          label="OpenAI"
        >
          {/* Sub-mode toggle */}
          <div className="flex gap-1 p-1 rounded-lg bg-[var(--surface-primary)] mb-3">
            {(["apikey", "codex"] as OpenAIMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setOpenaiMode(mode)}
                className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-all ${
                  openaiMode === mode
                    ? "bg-[var(--surface-secondary)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {mode === "apikey" ? "API Key" : "Connect with Codex"}
              </button>
            ))}
          </div>

          {openaiMode === "apikey" ? (
            <>
              <p className="text-xs text-[var(--text-tertiary)] mb-2">
                Get your key from{" "}
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer"
                  className="text-[var(--color-primary)] hover:underline inline-flex items-center gap-0.5">
                  platform.openai.com <ExternalLink className="h-3 w-3" />
                </a>
              </p>
              <ApiKeyField
                value={openaiKey}
                onChange={setOpenaiKey}
                placeholder="sk-..."
                autoFocus
              />
              {openaiError && <p className="text-xs text-[var(--color-destructive)] mt-1.5">{openaiError}</p>}
              {openaiSaved && (
                <p className="text-xs text-[var(--color-success)] mt-1.5 flex items-center gap-1">
                  <Check className="h-3 w-3" /> OpenAI key saved
                </p>
              )}
              <Button
                size="sm"
                className="w-full mt-2"
                disabled={!openaiKey.trim() || openaiSaving || openaiSaved}
                onClick={saveOpenaiKey}
              >
                {openaiSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : openaiSaved ? "Saved" : "Save Key"}
              </Button>
              {openaiSaved && <GatewayRestartNotice />}
            </>
          ) : (
            <>
              {/* Codex connection status */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-[var(--text-tertiary)]">
                  {codexConnected
                    ? "Reconnect anytime to refresh or add another account."
                    : "Sign in with your Codex account. A browser window will open."}
                </p>
                {codexConnected ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--color-success)]/10 text-[var(--color-success)] shrink-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
                    {(codexStatus?.accounts?.length ?? 0) > 1
                      ? `${codexStatus?.accounts?.length} connected`
                      : "Connected"}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--surface-primary)] text-[var(--text-tertiary)] shrink-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--text-tertiary)]" />
                    Not connected
                  </span>
                )}
              </div>

              {codexConnected && (codexStatus?.accounts?.length ?? 0) > 0 && (
                <div className="mb-3 rounded-md bg-[var(--surface-primary)] divide-y divide-[var(--border-default)]">
                  <div className="px-2.5 py-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                      Connected accounts ({codexStatus?.accounts?.length})
                    </span>
                    <span className="text-[10px] font-medium text-[var(--color-success)]">Active</span>
                  </div>
                  {codexStatus?.accounts?.map((acct) => (
                    <div
                      key={acct.id}
                      className="flex items-center gap-2 px-2.5 py-2 text-xs text-[var(--text-secondary)]"
                    >
                      <Check className="h-3.5 w-3.5 text-[var(--color-success)] shrink-0" />
                      <span className="truncate flex-1" title={acct.email}>{acct.email}</span>
                    </div>
                  ))}
                </div>
              )}
              {codexConnected && (codexStatus?.accounts?.length ?? 0) === 0 && (
                <div className="flex items-center justify-between mb-3 px-2.5 py-2 rounded-md bg-[var(--surface-primary)]">
                  <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />
                    <span className="truncate">{codexStatus?.email || "Signed in"}</span>
                  </div>
                  <span className="text-[10px] font-medium text-[var(--color-success)]">Active</span>
                </div>
              )}

              {codexConnecting ? (
                <div className="rounded-lg border border-[var(--border-default)] p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>
                      {codexInstalling
                        ? "Installing Codex CLI…"
                        : !codexAuthUrl || !codexUserCode
                          ? "Preparing Codex sign-in…"
                          : "Waiting for Codex sign-in…"}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--text-tertiary)]">
                    Sign in at the page we opened and enter the one-time code below. It expires in 15 minutes.
                  </p>
                  <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] p-2.5">
                    <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                      One-time code
                    </div>
                    <div className="flex items-center gap-2">
                      <div
                        className="flex-1 select-all rounded border border-[var(--border-default)] bg-[var(--surface-secondary)] px-2.5 py-1.5 font-mono text-base font-semibold tracking-[0.2em] text-[var(--text-primary)]"
                        aria-live="polite"
                      >
                        {codexUserCode ?? "····-·····"}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={copyCodexCode}
                        disabled={!codexUserCode}
                        className="shrink-0 gap-1.5"
                      >
                        {codexCodeCopied ? (
                          <><Check className="h-3 w-3" /> Copied</>
                        ) : (
                          <><Copy className="h-3 w-3" /> Copy</>
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {codexAuthUrl && (
                      <button
                        type="button"
                        onClick={() => openCodexUrl(codexAuthUrl)}
                        className="inline-flex items-center gap-1 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                      >
                        <ExternalLink className="h-2.5 w-2.5" />
                        Re-open login page
                      </button>
                    )}
                    <button
                      onClick={cancelCodexSetup}
                      className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] ml-auto"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant={codexConnected ? "outline" : "default"}
                  className="w-full"
                  onClick={startCodexSetup}
                  disabled={codexConnecting}
                >
                  {codexConnecting ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Waiting for sign-in…</>
                  ) : codexConnected ? (
                    <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Reconnect Codex</>
                  ) : (
                    <><Zap className="h-3.5 w-3.5 mr-1.5" /> Connect Codex</>
                  )}
                </Button>
              )}

              {codexError && (
                <p className="text-xs text-[var(--color-destructive)] mt-2 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 shrink-0" /> {codexError}
                </p>
              )}
            </>
          )}
        </ProviderOption>

        {/* Other */}
        <ProviderOption
          selected={selected === "other"}
          onSelect={() => setSelected("other")}
          label="Other"
        >
          <p className="text-xs text-[var(--text-tertiary)] mb-3">
            Store any API key as an environment variable. It will be available to your agent.
          </p>
          <div className="space-y-2">
            <Input
              value={envKey}
              onChange={(e) => setEnvKey(e.target.value.toUpperCase().replace(/\s/g, "_"))}
              placeholder="ENV_VAR_NAME"
              className="font-mono text-sm"
              spellCheck={false}
              autoFocus
            />
            <ApiKeyField
              value={envValue}
              onChange={setEnvValue}
              placeholder="value"
            />
          </div>
          {envError && <p className="text-xs text-[var(--color-destructive)] mt-1.5">{envError}</p>}
          {envSaved && (
            <p className="text-xs text-[var(--color-success)] mt-1.5 flex items-center gap-1">
              <Check className="h-3 w-3" /> Saved to environment
            </p>
          )}
          <Button
            size="sm"
            className="w-full mt-2"
            disabled={!envKey.trim() || !envValue.trim() || envSaving || envSaved}
            onClick={saveEnvVar}
          >
            {envSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : envSaved ? "Saved" : "Save Variable"}
          </Button>
        </ProviderOption>
      </div>

      <Button className="w-full mt-5" onClick={onNext} disabled={!canContinue}>
        Continue
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
      {detectedEnvKeys.length > 0 && !canContinue && (
        <button
          onClick={onSkip}
          className="mt-3 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
        >
          Skip, I already have a key
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3 — Connect Channels                                           */
/* ------------------------------------------------------------------ */

interface ChannelRowProps {
  platform: Platform;
  isExpanded: boolean;
  isConnected: boolean;
  onToggle: () => void;
  onConnect: (fields: Record<string, string>) => Promise<void>;
}

function ChannelRow({ platform, isExpanded, isConnected, onToggle, onConnect }: ChannelRowProps) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setSaving(true);
    setError(null);
    try {
      await onConnect({ platform: platform.id, ...fields });
    } catch (e) {
      // Surface the bridge's `detail` field when present — generic
      // "API 502: Bad Gateway" tells the user nothing actionable.
      if (e instanceof ApiError) {
        const body = e.body as { detail?: string } | undefined;
        setError(body?.detail || e.message);
      } else if (e instanceof Error) {
        setError(e.message);
      } else {
        setError("Connection failed");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`rounded-xl border transition-all ${
        isConnected
          ? "border-[var(--color-success)]/40 bg-[var(--color-success)]/5"
          : isExpanded
          ? "border-[var(--border-strong)]"
          : "border-[var(--border-default)] bg-[var(--surface-secondary)]"
      }`}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <span className={platform.color}>{platform.icon}</span>
        <span className="text-sm font-medium text-[var(--text-primary)] flex-1">
          {platform.name}
        </span>
        {isConnected ? (
          <span className="flex items-center gap-1 text-xs text-[var(--color-success)]">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        ) : (
          <ChevronRight
            className={`h-4 w-4 text-[var(--text-tertiary)] transition-transform ${isExpanded ? "rotate-90" : ""}`}
          />
        )}
      </button>

      <AnimatePresence>
        {isExpanded && !isConnected && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              <p className="text-xs text-[var(--text-tertiary)]">
                {platform.help}
                {platform.helpUrl && (
                  <a
                    href={platform.helpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1 inline-flex items-center gap-0.5 text-[var(--color-primary)] hover:underline"
                  >
                    Open docs <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </p>

              {platform.auth === "qr" ? (
                <p className="text-xs text-[var(--text-secondary)] italic">
                  QR pairing is available after setup in the Channels settings.
                </p>
              ) : (
                platform.fields?.map((field) => (
                  <div key={field.key} className="relative">
                    <Input
                      type={field.secret && !showSecrets[field.key] ? "password" : "text"}
                      value={fields[field.key] ?? ""}
                      onChange={(e) =>
                        setFields((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      placeholder={field.placeholder}
                      className="pr-10 text-sm"
                    />
                    {field.secret && (
                      <button
                        type="button"
                        onClick={() =>
                          setShowSecrets((prev) => ({ ...prev, [field.key]: !prev[field.key] }))
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
                      >
                        {showSecrets[field.key] ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                ))
              )}

              {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}

              {platform.auth !== "qr" && (
                <Button
                  size="sm"
                  className="w-full"
                  disabled={
                    saving ||
                    (platform.fields?.some((f) => !fields[f.key]?.trim()) ?? false)
                  }
                  onClick={handleConnect}
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    "Connect"
                  )}
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ChannelsStep({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [needsRestart, setNeedsRestart] = useState(false);

  const handleConnect = async (platformId: string, fields: Record<string, string>) => {
    const resp = await api.post<{
      ok: boolean;
      config_updated: boolean;
      restart_required: boolean;
      detail?: string;
    }>(API.CHANNELS.ADD, fields);
    setConnected((prev) => new Set(prev).add(platformId));
    if (resp.restart_required) setNeedsRestart(true);
    setExpanded(null);
  };

  return (
    <div className="flex flex-col">
      <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-1">
        Connect channels
      </h2>
      <p className="text-sm text-[var(--text-secondary)] mb-5">
        Bring your AI assistant to the apps your team already uses.
      </p>

      <div className="space-y-2">
        {PLATFORMS.filter((p) => !p.hidden).map((platform) => (
          <ChannelRow
            key={platform.id}
            platform={platform}
            isExpanded={expanded === platform.id}
            isConnected={connected.has(platform.id)}
            onToggle={() =>
              setExpanded((prev) => (prev === platform.id ? null : platform.id))
            }
            onConnect={async (fields) => handleConnect(platform.id, fields)}
          />
        ))}
      </div>

      {needsRestart && <GatewayRestartNotice />}

      <Button className="w-full mt-5" onClick={onNext}>
        Continue <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
      <button
        onClick={onSkip}
        className="mt-3 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
      >
        Skip for now
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 4 — Create First Project                                       */
/* ------------------------------------------------------------------ */

function ProjectStep({
  companyName,
  onFinish,
}: {
  companyName: string;
  onFinish: () => void;
}) {
  const router = useAppRouter();
  const completeOnboarding = useSettingsStore((s) => s.completeOnboarding);
  const setWorkspaceDirectory = useSettingsStore((s) => s.setWorkspaceDirectory);
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    const name = projectName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const projectPath = `${WORKSPACE_ROOT}/${name}`;
      await api.post(API.FILES.MKDIR, { path: projectPath, scaffold: true });
      setWorkspaceDirectory(projectPath);
      completeOnboarding();
      toast.success(`Project "${name}" created`);
      router.push("/c/new");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create project";
      setError(`${msg}. You can create one from the sidebar later.`);
      setCreating(false);
    }
  };

  const handleSkip = () => {
    completeOnboarding();
    onFinish();
  };

  return (
    <div className="flex flex-col">
      <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-1">
        Create your first project
      </h2>
      <p className="text-sm text-[var(--text-secondary)] mb-6">
        Start a conversation and put your AI assistant to work.
      </p>

      <Input
        autoFocus
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        placeholder={`e.g. ${companyName ? `${companyName} — ` : ""}Research Assistant`}
        className="h-11 text-base"
        onKeyDown={(e) => {
          if (e.key === "Enter" && projectName.trim()) handleCreate();
        }}
      />

      {error && <p className="text-xs text-[var(--color-destructive)] mt-2">{error}</p>}

      <Button
        className="w-full mt-4"
        disabled={!projectName.trim() || creating}
        onClick={handleCreate}
      >
        {creating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Plus className="mr-2 h-4 w-4" /> Create Project
          </>
        )}
      </Button>

      <button
        onClick={handleSkip}
        className="mt-3 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
      >
        Skip, I&apos;ll do this later
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Progress stepper                                                    */
/* ------------------------------------------------------------------ */

function Stepper({ current }: { current: Step }) {
  const currentIdx = STEPS.indexOf(current);
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {STEPS.map((step, idx) => {
        const done = idx < currentIdx;
        const active = idx === currentIdx;
        return (
          <div key={step} className="flex items-center gap-2">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-all ${
                done
                  ? "bg-[var(--color-primary)] text-white"
                  : active
                  ? "border-2 border-[var(--color-primary)] text-[var(--color-primary)]"
                  : "border border-[var(--border-default)] text-[var(--text-tertiary)]"
              }`}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : idx + 1}
            </div>
            {idx < STEPS.length - 1 && (
              <div
                className={`h-px w-6 transition-all ${
                  done ? "bg-[var(--color-primary)]" : "bg-[var(--border-default)]"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Root component                                                      */
/* ------------------------------------------------------------------ */

export function OnboardingScreen() {
  const router = useAppRouter();
  const completeOnboarding = useSettingsStore((s) => s.completeOnboarding);
  const setCompanyName = useSettingsStore((s) => s.setCompanyName);

  // Prefetch the env-keys list at mount so by the time the user reaches
  // the Models step, the "ANTHROPIC_API_KEY is already set" banner
  // appears with no perceptible delay. ModelsStep reads from this same
  // cached query.
  useQuery({
    queryKey: ["secrets-env-keys"],
    queryFn: () => api.get<{ keys: string[] }>(API.SECRETS.ENV_KEYS),
    staleTime: 30_000,
  });

  const [step, setStep] = useState<Step>("company");
  const [direction, setDirection] = useState(1);
  const [companyNameInput, setCompanyNameInput] = useState("");
  const [personalityContent, setPersonalityContent] =
    useState<PersonalityContent | null>(null);

  // Lock body scroll while the onboarding overlay is mounted so overscroll
  // bounce can't reveal the chat shell rendered underneath by (main)/layout.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const goTo = (next: Step, dir = 1) => {
    setDirection(dir);
    setStep(next);
  };

  const goNext = () => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) goTo(STEPS[idx + 1], 1);
  };

  const goBack = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) goTo(STEPS[idx - 1], -1);
  };

  const handleCompanyNext = () => {
    setCompanyName(companyNameInput.trim());
    goNext();
  };

  const handleFinish = () => {
    completeOnboarding();
    router.push("/c/new");
  };

  // Portal to document.body so the overlay escapes (main)/layout's
  // <motion.main> transform — a transformed ancestor would otherwise
  // become the containing block for `position: fixed`, leaving the
  // sidebar-width strip on the left uncovered.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[9998] overflow-y-auto overscroll-contain scrollbar-none bg-[var(--surface-primary)]">
      <div className="min-h-full flex flex-col items-center justify-center py-8">
      {/* Logo */}
      <div className="mb-6 flex flex-col items-center">
        <img src="/favicon.svg" width={40} height={40} alt="XO-Cowork" className="mb-3" />
        <span className="text-xs font-medium text-[var(--text-tertiary)] tracking-wide uppercase">
          XO-Cowork Setup
        </span>
      </div>

      <motion.div
        className={`w-full px-6 transition-[max-width] duration-300 ease-out ${
          step === "personality" ? "max-w-lg" : "max-w-sm"
        }`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      >
        <Stepper current={step} />

        {/* Back button (not on first step) */}
        {step !== "company" && (
          <button
            onClick={goBack}
            className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        )}

        <AnimatePresence mode="wait" custom={direction}>
          {step === "company" && (
            <motion.div
              key="company"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transition}
            >
              <CompanyStep
                value={companyNameInput}
                onChange={setCompanyNameInput}
                onNext={handleCompanyNext}
              />
            </motion.div>
          )}

          {step === "models" && (
            <motion.div
              key="models"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transition}
            >
              <ModelsStep onNext={goNext} onSkip={goNext} />
            </motion.div>
          )}

          {step === "channels" && (
            <motion.div
              key="channels"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transition}
            >
              <ChannelsStep onNext={goNext} onSkip={goNext} />
            </motion.div>
          )}

          {step === "personality" && (
            <motion.div
              key="personality"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transition}
            >
              <PersonalityStep
                content={personalityContent}
                onInitialLoad={setPersonalityContent}
                onChange={setPersonalityContent}
                onNext={goNext}
              />
            </motion.div>
          )}

          {step === "project" && (
            <motion.div
              key="project"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transition}
            >
              <ProjectStep companyName={companyNameInput} onFinish={handleFinish} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      </div>
    </div>,
    document.body,
  );
}
