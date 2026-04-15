"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
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
  ChevronRight,
  Eye,
  EyeOff,
  ExternalLink,
  Plus,
  Sparkles,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettingsStore } from "@/stores/settings-store";
import { api } from "@/lib/api";
import { API, IS_DESKTOP, queryKeys } from "@/lib/constants";
import { desktopAPI } from "@/lib/tauri-api";
import {
  WhatsAppIcon,
  DiscordIcon,
  TelegramIcon,
  SlackIcon,
} from "@/components/icons/platform-icons";
import type { SessionResponse } from "@/types/session";

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

type Step = "company" | "models" | "channels" | "project";

const STEPS: Step[] = ["company", "models", "channels", "project"];

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
}

const PLATFORMS: Platform[] = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    icon: <WhatsAppIcon size={20} />,
    color: "text-[#25D366]",
    auth: "qr",
    help: "Scan QR with your phone to link WhatsApp",
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
type OpenAIMode = "apikey" | "chatgpt";

interface OpenAISubscriptionStatus {
  is_connected: boolean;
  email?: string;
  needs_reauth?: boolean;
}

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
  badge?: string;
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
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
            {badge}
          </span>
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

function ModelsStep({
  onNext,
  onSkip,
}: {
  onNext: () => void;
  onSkip: () => void;
}) {
  const qc = useQueryClient();
  const { setActiveProvider } = useSettingsStore();

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
  const [chatgptConnected, setChatgptConnected] = useState(false);
  const [chatgptConnecting, setChatgptConnecting] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Other (env var) state
  const [envKey, setEnvKey] = useState("");
  const [envValue, setEnvValue] = useState("");
  const [envSaving, setEnvSaving] = useState(false);
  const [envSaved, setEnvSaved] = useState(false);
  const [envError, setEnvError] = useState<string | null>(null);

  useEffect(() => () => { if (pollingRef.current) clearInterval(pollingRef.current); }, []);

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

  const connectChatGPT = async () => {
    setChatgptConnecting(true);
    setOpenaiError(null);
    try {
      const resp = await api.post<{ auth_url: string }>(API.CONFIG.OPENAI_SUBSCRIPTION_LOGIN, {});
      if (IS_DESKTOP) {
        await desktopAPI.openExternal(resp.auth_url);
      } else {
        window.open(resp.auth_url, "_blank", "noopener,noreferrer");
      }
      // Poll for connection
      pollingRef.current = setInterval(async () => {
        try {
          const status = await api.get<OpenAISubscriptionStatus>(API.CONFIG.OPENAI_SUBSCRIPTION);
          if (status.is_connected) {
            clearInterval(pollingRef.current!);
            pollingRef.current = null;
            setChatgptConnected(true);
            setChatgptConnecting(false);
            setActiveProvider("chatgpt");
            qc.invalidateQueries({ queryKey: queryKeys.models });
          }
        } catch { /* keep polling */ }
      }, 2000);
      // Timeout after 5 min
      setTimeout(() => {
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
        setChatgptConnecting(false);
      }, 300_000);
    } catch {
      setOpenaiError("Could not start ChatGPT sign-in. Please try again.");
      setChatgptConnecting(false);
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
    selected === "openai" ? (openaiSaved || chatgptConnected) :
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
        </ProviderOption>

        {/* OpenAI */}
        <ProviderOption
          selected={selected === "openai"}
          onSelect={() => setSelected("openai")}
          label="OpenAI"
        >
          {/* Sub-mode toggle */}
          <div className="flex gap-1 p-1 rounded-lg bg-[var(--surface-primary)] mb-3">
            {(["apikey", "chatgpt"] as OpenAIMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setOpenaiMode(mode)}
                className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-all ${
                  openaiMode === mode
                    ? "bg-[var(--surface-secondary)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {mode === "apikey" ? "API Key" : "Connect with ChatGPT"}
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
            </>
          ) : (
            <>
              <p className="text-xs text-[var(--text-tertiary)] mb-3">
                Sign in with your ChatGPT Plus or Team account. A browser window will open.
              </p>
              {chatgptConnected ? (
                <p className="text-xs text-[var(--color-success)] flex items-center gap-1">
                  <Check className="h-3 w-3" /> ChatGPT connected
                </p>
              ) : (
                <Button
                  size="sm"
                  className="w-full"
                  onClick={connectChatGPT}
                  disabled={chatgptConnecting}
                >
                  {chatgptConnecting ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Waiting for sign-in…</>
                  ) : (
                    <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Connect with ChatGPT</>
                  )}
                </Button>
              )}
              {openaiError && <p className="text-xs text-[var(--color-destructive)] mt-1.5">{openaiError}</p>}
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
      setError(e instanceof Error ? e.message : "Connection failed");
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
            <Check className="h-3.5 w-3.5" /> Connected
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

  const handleConnect = async (platformId: string, fields: Record<string, string>) => {
    await api.post(API.CHANNELS.ADD, fields);
    setConnected((prev) => new Set(prev).add(platformId));
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
        {PLATFORMS.map((platform) => (
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

      <Button className="w-full mt-5" onClick={onNext}>
        {connected.size > 0 ? (
          <>
            Continue <ArrowRight className="ml-2 h-4 w-4" />
          </>
        ) : (
          <>
            Continue <ArrowRight className="ml-2 h-4 w-4" />
          </>
        )}
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
  const router = useRouter();
  const completeOnboarding = useSettingsStore((s) => s.completeOnboarding);
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    const name = projectName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const session = await api.post<SessionResponse>(API.SESSIONS.BASE, { title: name });
      completeOnboarding();
      router.push(`/c/${session.id}`);
    } catch {
      setError("Failed to create project. You can create one from the sidebar later.");
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
  const router = useRouter();
  const completeOnboarding = useSettingsStore((s) => s.completeOnboarding);
  const setCompanyName = useSettingsStore((s) => s.setCompanyName);

  const [step, setStep] = useState<Step>("company");
  const [direction, setDirection] = useState(1);
  const [companyNameInput, setCompanyNameInput] = useState("");

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

  return (
    <div className="fixed inset-0 z-[9998] flex flex-col items-center justify-center bg-[var(--surface-primary)]">
      {/* Logo */}
      <div className="mb-6 flex flex-col items-center">
        <img src="/favicon.svg" width={40} height={40} alt="XO-Cowork" className="mb-3" />
        <span className="text-xs font-medium text-[var(--text-tertiary)] tracking-wide uppercase">
          XO-Cowork Setup
        </span>
      </div>

      <motion.div
        className="w-full max-w-sm px-6"
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
  );
}
