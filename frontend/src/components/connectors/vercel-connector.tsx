"use client";

import { useState, useRef } from "react";
import {
  X,
  Loader2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  LogOut,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useVercelStatus,
  useVercelSubmitToken,
  useVercelDisconnect,
  useVercelReconnect,
  useVercelOAuthExchange,
} from "@/hooks/use-vercel";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";

function VercelIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 76 65" fill="currentColor" aria-hidden="true">
      <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
    </svg>
  );
}

const VERCEL_TOKEN_URL = "https://vercel.com/account/tokens";

// ---------------------------------------------------------------------------
// OAuth button — opens auth in a new tab, shows paste box immediately
// ---------------------------------------------------------------------------

function OAuthButton({ onSuccess }: { onSuccess: () => void }) {
  const exchangeMutation = useVercelOAuthExchange();

  const [phase, setPhase] = useState<"idle" | "waiting">("idle");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [pasteUrl, setPasteUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pasteRef = useRef<HTMLInputElement>(null);

  const handleOAuthClick = async () => {
    setError(null);
    setPasteUrl("");
    setPhase("waiting");
    try {
      const { auth_url } = await api.get<{ auth_url: string }>(API.VERCEL.OAUTH_START);
      setAuthUrl(auth_url);
      window.open(auth_url, "_blank", "noopener");
      setTimeout(() => pasteRef.current?.focus(), 300);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start authorization.");
      setPhase("idle");
    }
  };

  const handlePasteSubmit = async () => {
    setError(null);
    let code: string | null = null;
    let state: string | null = null;
    try {
      const url = new URL(pasteUrl.trim());
      code = url.searchParams.get("code");
      state = url.searchParams.get("state");
    } catch {
      setError("Invalid URL — paste the full address from the browser address bar.");
      return;
    }
    if (!code || !state) {
      setError("URL is missing 'code' or 'state'. Make sure you copied the complete address.");
      return;
    }
    try {
      await exchangeMutation.mutateAsync({ code, state });
      setPhase("idle");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Token exchange failed.");
    }
  };

  if (phase === "idle") {
    return (
      <div className="space-y-3">
        <Button className="w-full gap-2" onClick={handleOAuthClick}>
          <VercelIcon size={14} />
          Connect with Vercel
        </Button>
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/5 p-3">
            <AlertCircle className="h-4 w-4 text-[var(--color-destructive)] shrink-0 mt-0.5" />
            <p className="text-xs text-[var(--text-primary)]">{error}</p>
          </div>
        )}
      </div>
    );
  }

  // "waiting" phase — new tab opened, show paste box prominently
  return (
    <div className="space-y-3">
      {/* Step indicator */}
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 space-y-2.5">
        <div className="flex items-start gap-2.5">
          <span className="h-5 w-5 rounded-full bg-[var(--brand-primary)] text-[var(--brand-primary-text)] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
          <p className="text-xs text-[var(--text-primary)] leading-relaxed">
            A Vercel authorization tab has opened.{" "}
            <strong>Sign in and approve access.</strong>
          </p>
        </div>
        <div className="flex items-start gap-2.5">
          <span className="h-5 w-5 rounded-full bg-[var(--brand-primary)] text-[var(--brand-primary-text)] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
          <p className="text-xs text-[var(--text-primary)] leading-relaxed">
            You'll land on an error page — that's expected.{" "}
            <strong>Copy the full URL</strong> from the address bar and paste it below.
          </p>
        </div>
      </div>

      {/* Paste input */}
      <div className="space-y-1.5">
        <label className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          Paste redirect URL
        </label>
        <div className="flex gap-2">
          <input
            ref={pasteRef}
            type="text"
            value={pasteUrl}
            onChange={(e) => setPasteUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !exchangeMutation.isPending && handlePasteSubmit()}
            placeholder="http://127.0.0.1/callback?state=…&code=…"
            autoComplete="off"
            className="flex-1 h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 text-[11px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/40 focus:border-[var(--brand-primary)]"
          />
          <Button
            size="sm"
            className="h-9 px-4 text-xs shrink-0"
            onClick={handlePasteSubmit}
            disabled={!pasteUrl.trim() || exchangeMutation.isPending}
          >
            {exchangeMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Complete"
            )}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/5 p-3">
          <AlertCircle className="h-4 w-4 text-[var(--color-destructive)] shrink-0 mt-0.5" />
          <p className="text-xs text-[var(--text-primary)]">{error}</p>
        </div>
      )}

      {/* Helpers at bottom */}
      <div className="flex items-center justify-between text-[10px] text-[var(--text-tertiary)]">
        {authUrl && (
          <button
            type="button"
            onClick={() => window.open(authUrl, "_blank", "noopener")}
            className="flex items-center gap-1 hover:text-[var(--text-secondary)] transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Re-open authorization tab
          </button>
        )}
        <button
          type="button"
          onClick={() => { setPhase("idle"); setError(null); }}
          className="ml-auto hover:text-[var(--text-secondary)] transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// API token form (secondary / fallback method)
// ---------------------------------------------------------------------------

function TokenForm({ onSuccess }: { onSuccess: () => void }) {
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const submitMutation = useVercelSubmitToken();

  const handleSubmit = async () => {
    if (!token.trim()) return;
    try {
      await submitMutation.mutateAsync(token.trim());
      onSuccess();
    } catch {
      // error shown via submitMutation.error
    }
  };

  return (
    <div className="space-y-4">
      <ol className="space-y-2.5">
        <li className="flex gap-2.5">
          <span className="h-5 w-5 rounded-full bg-[var(--brand-primary)] text-[var(--brand-primary-text)] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
            1
          </span>
          <div className="flex-1 space-y-1.5">
            <p className="text-xs text-[var(--text-primary)]">
              Open your Vercel account tokens
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => window.open(VERCEL_TOKEN_URL, "_blank", "noopener")}
            >
              <ExternalLink className="h-3 w-3 mr-1.5" />
              Open Vercel Tokens
            </Button>
          </div>
        </li>

        <li className="flex gap-2.5">
          <span className="h-5 w-5 rounded-full bg-[var(--brand-primary)] text-[var(--brand-primary-text)] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
            2
          </span>
          <div className="flex-1 space-y-1.5">
            <p className="text-xs text-[var(--text-primary)]">
              Create a token and paste it below
            </p>
            <div className="relative">
              <input
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                placeholder="vercel_..."
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                className="w-full h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] pl-3 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/40 focus:border-[var(--brand-primary)] transition-all font-mono text-[12px]"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
              >
                {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        </li>
      </ol>

      {submitMutation.error && (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/5 p-3">
          <AlertCircle className="h-4 w-4 text-[var(--color-destructive)] shrink-0 mt-0.5" />
          <p className="text-xs text-[var(--text-primary)]">
            {submitMutation.error instanceof Error
              ? submitMutation.error.message
              : "Token validation failed."}
          </p>
        </div>
      )}

      <Button
        className="w-full"
        onClick={handleSubmit}
        disabled={!token.trim() || submitMutation.isPending}
      >
        {submitMutation.isPending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Validating…
          </>
        ) : (
          <>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Connect Vercel
          </>
        )}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connect view — OAuth primary + token form collapsible fallback
// ---------------------------------------------------------------------------

function ConnectView({ onSuccess }: { onSuccess: () => void }) {
  const [showTokenForm, setShowTokenForm] = useState(false);

  return (
    <div className="space-y-4">
      {/* Primary: OAuth */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          Recommended
        </h3>
        <OAuthButton onSuccess={onSuccess} />
        <p className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1">
          <ShieldCheck className="h-3 w-3 shrink-0" />
          Uses OAuth 2.1 — no token to copy or store manually.
        </p>
      </div>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-[var(--border-default)]" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-[var(--surface-primary)] px-2 text-[10px] text-[var(--text-tertiary)] uppercase tracking-wider">
            or
          </span>
        </div>
      </div>

      {/* Secondary: API token (collapsible) */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowTokenForm((v) => !v)}
          className="flex w-full items-center justify-between text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider hover:text-[var(--text-primary)] transition-colors"
        >
          <span>Use an API Token</span>
          {showTokenForm ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>

        {showTokenForm && <TokenForm onSuccess={onSuccess} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connected view
// ---------------------------------------------------------------------------

function ConnectedView({
  username,
  name,
  authMethod,
  onDisconnect,
  onReconnect,
}: {
  username: string;
  name?: string;
  authMethod?: "oauth" | "api_token";
  onDisconnect: () => void;
  onReconnect: () => void;
}) {
  const disconnectMutation = useVercelDisconnect();
  const reconnectMutation = useVercelReconnect();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="h-10 w-10 rounded-full bg-[var(--surface-secondary)] flex items-center justify-center text-[var(--text-primary)]">
          <VercelIcon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
            {name || username}
          </p>
          <p className="text-[11px] text-[var(--text-tertiary)]">@{username}</p>
          {authMethod && (
            <span className="inline-flex items-center gap-1 mt-1 rounded-md bg-[var(--surface-secondary)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
              {authMethod === "oauth" ? (
                <>
                  <ShieldCheck className="h-2.5 w-2.5" />
                  OAuth 2.1
                </>
              ) : (
                "API Token"
              )}
            </span>
          )}
        </div>
        <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs"
          onClick={async () => {
            await reconnectMutation.mutateAsync();
            onReconnect();
          }}
          disabled={reconnectMutation.isPending}
        >
          {reconnectMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          )}
          Reconnect
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs text-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/5"
          onClick={async () => {
            await disconnectMutation.mutateAsync();
            onDisconnect();
          }}
          disabled={disconnectMutation.isPending}
        >
          {disconnectMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
          ) : (
            <LogOut className="h-3.5 w-3.5 mr-1.5" />
          )}
          Disconnect
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

function VercelModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading, refetch } = useVercelStatus();
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const isConnected = data?.status === "connected";

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={handleOverlayClick}
    >
      <div className="relative w-full max-w-md bg-[var(--surface-primary)] rounded-2xl border border-[var(--border-default)] shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border-default)] shrink-0">
          <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center text-[var(--text-primary)]">
            <VercelIcon size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Vercel</h2>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              Manage deployments, projects, domains, and env vars
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--text-tertiary)]" />
              <p className="text-sm text-[var(--text-secondary)]">Checking connection…</p>
            </div>
          ) : isConnected ? (
            <ConnectedView
              username={data?.username ?? ""}
              name={data?.name}
              authMethod={data?.auth_method}
              onDisconnect={() => refetch()}
              onReconnect={() => refetch()}
            />
          ) : (
            <>
              {data?.status === "failed" && data?.error && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 mb-4">
                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-[var(--text-primary)]">{data.error}</p>
                </div>
              )}
              <ConnectView onSuccess={() => refetch()} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------

export function VercelConnectorTile() {
  const [modalOpen, setModalOpen] = useState(false);
  const { data, isLoading } = useVercelStatus();
  const isConnected = data?.status === "connected";

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 hover:bg-[var(--surface-tertiary)] transition-colors text-left w-full group"
      >
        <span
          className={`h-2 w-2 rounded-full shrink-0 ${
            isConnected ? "bg-emerald-500" : "bg-[var(--text-tertiary)]"
          }`}
        />
        <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0 text-[var(--text-primary)]">
          <VercelIcon size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[var(--text-primary)] truncate">Vercel</p>
          <p className="text-[10px] text-[var(--text-tertiary)]">
            {isLoading
              ? "Loading…"
              : isConnected
              ? `@${data?.username}`
              : "Not connected"}
          </p>
        </div>
      </button>

      {modalOpen && <VercelModal onClose={() => setModalOpen(false)} />}
    </>
  );
}
