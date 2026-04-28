"use client";

import { useState, useRef, useCallback } from "react";
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
  Copy,
  Check,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useGitHubStatus,
  useGitHubSubmitToken,
  useGitHubDisconnect,
  useGitHubReconnect,
} from "@/hooks/use-github";

// ---------------------------------------------------------------------------
// GitHub icon (SVG)
// ---------------------------------------------------------------------------

function GitHubIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Scopes guide
// ---------------------------------------------------------------------------

const REQUIRED_SCOPES = [
  { name: "Contents", desc: "Read/write files and repos" },
  { name: "Issues", desc: "Read/write issues" },
  { name: "Pull requests", desc: "Read/write PRs" },
  { name: "Metadata", desc: "Required for all fine-grained tokens" },
];

const GITHUB_TOKEN_URL =
  "https://github.com/settings/tokens?type=beta";

// ---------------------------------------------------------------------------
// Token form
// ---------------------------------------------------------------------------

function TokenForm({
  onSuccess,
}: {
  onSuccess: () => void;
}) {
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const submitMutation = useGitHubSubmitToken();

  const handleSubmit = async () => {
    if (!token.trim()) return;
    try {
      await submitMutation.mutateAsync(token.trim());
      onSuccess();
    } catch {
      // error is in submitMutation.error
    }
  };

  return (
    <div className="space-y-4">
      {/* Instructions */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          Connect with Personal Access Token
        </h3>

        <ol className="space-y-2.5">
          <li className="flex gap-2.5">
            <span className="h-5 w-5 rounded-full bg-[var(--brand-primary)] text-[var(--brand-primary-text)] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
              1
            </span>
            <div className="flex-1 space-y-1.5">
              <p className="text-xs text-[var(--text-primary)]">
                Create a fine-grained Personal Access Token on GitHub
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() => window.open(GITHUB_TOKEN_URL, "_blank", "noopener")}
              >
                <ExternalLink className="h-3 w-3 mr-1.5" />
                Open GitHub Token Settings
              </Button>
            </div>
          </li>

          <li className="flex gap-2.5">
            <span className="h-5 w-5 rounded-full bg-[var(--brand-primary)] text-[var(--brand-primary-text)] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
              2
            </span>
            <div className="flex-1 space-y-1">
              <p className="text-xs text-[var(--text-primary)]">
                Select these permissions:
              </p>
              <div className="flex flex-wrap gap-1">
                {REQUIRED_SCOPES.map((s) => (
                  <span
                    key={s.name}
                    className="inline-flex items-center gap-1 rounded-md bg-[var(--surface-secondary)] border border-[var(--border-default)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]"
                    title={s.desc}
                  >
                    <ShieldCheck className="h-2.5 w-2.5 text-emerald-500" />
                    {s.name}
                  </span>
                ))}
              </div>
            </div>
          </li>

          <li className="flex gap-2.5">
            <span className="h-5 w-5 rounded-full bg-[var(--brand-primary)] text-[var(--brand-primary-text)] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
              3
            </span>
            <div className="flex-1 space-y-1.5">
              <p className="text-xs text-[var(--text-primary)]">
                Paste the token below
              </p>
              <div className="relative">
                <input
                  type={showToken ? "text" : "password"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="github_pat_..."
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
      </div>

      {/* Error */}
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

      {/* Submit */}
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
            Connect GitHub
          </>
        )}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connected view
// ---------------------------------------------------------------------------

function ConnectedView({
  username,
  name,
  avatarUrl,
  onDisconnect,
  onReconnect,
}: {
  username: string;
  name?: string;
  avatarUrl?: string;
  onDisconnect: () => void;
  onReconnect: () => void;
}) {
  const disconnectMutation = useGitHubDisconnect();
  const reconnectMutation = useGitHubReconnect();

  const handleDisconnect = async () => {
    await disconnectMutation.mutateAsync();
    onDisconnect();
  };

  return (
    <div className="space-y-4">
      {/* User card */}
      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={username}
            className="h-10 w-10 rounded-full border border-[var(--border-default)]"
          />
        ) : (
          <div className="h-10 w-10 rounded-full bg-[var(--surface-secondary)] flex items-center justify-center">
            <GitHubIcon size={20} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
            {name || username}
          </p>
          <p className="text-[11px] text-[var(--text-tertiary)]">@{username}</p>
        </div>
        <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
      </div>

      {/* Actions */}
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
          onClick={handleDisconnect}
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
// Main modal
// ---------------------------------------------------------------------------

function GitHubModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading, refetch } = useGitHubStatus();
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
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border-default)] shrink-0">
          <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center">
            <GitHubIcon size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">GitHub</h2>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              Manage repos, issues, pull requests, and code search
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
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
              avatarUrl={data?.avatar_url}
              onDisconnect={() => refetch()}
              onReconnect={() => refetch()}
            />
          ) : (
            <>
              {/* Error from previous failed state */}
              {data?.status === "failed" && data?.error && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 mb-4">
                  <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-[var(--text-primary)]">{data.error}</p>
                </div>
              )}
              <TokenForm onSuccess={() => refetch()} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tile (shown in the Connectors grid)
// ---------------------------------------------------------------------------

export function GitHubConnectorTile() {
  const [modalOpen, setModalOpen] = useState(false);
  const { data, isLoading } = useGitHubStatus();
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
          <GitHubIcon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[var(--text-primary)] truncate">GitHub</p>
          <p className="text-[10px] text-[var(--text-tertiary)]">
            {isLoading
              ? "Loading…"
              : isConnected
              ? `@${data?.username}`
              : "Not connected"}
          </p>
        </div>
      </button>

      {modalOpen && <GitHubModal onClose={() => setModalOpen(false)} />}
    </>
  );
}
