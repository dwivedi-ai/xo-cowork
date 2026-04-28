"use client";

import { useState, useEffect, useRef } from "react";
import {
  X,
  Loader2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  LogOut,
  Triangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useVercelStatus,
  useVercelConnect,
  useVercelSession,
  useVercelDisconnect,
  useVercelReconnect,
  useVercelCancelSession,
} from "@/hooks/use-vercel";

// ---------------------------------------------------------------------------
// Vercel icon (triangle logo)
// ---------------------------------------------------------------------------

function VercelIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 76 65" fill="currentColor" aria-hidden="true">
      <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// OAuth flow panel
// ---------------------------------------------------------------------------

function OAuthFlow({
  onCompleted,
  onCancel,
}: {
  onCompleted: () => void;
  onCancel: () => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "starting" | "waiting" | "completed" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const connectMutation = useVercelConnect();
  const cancelSession = useVercelCancelSession();
  const { data: sessionData } = useVercelSession(sessionId);

  // React to session poll updates
  useEffect(() => {
    if (!sessionData) return;
    if (sessionData.status === "awaiting_oauth" && sessionData.auth_url) {
      // Open the auth URL in the browser
      window.open(sessionData.auth_url, "_blank", "noopener");
      setPhase("waiting");
    } else if (sessionData.status === "completed") {
      setPhase("completed");
      setTimeout(onCompleted, 1500);
    } else if (sessionData.status === "failed") {
      setPhase("error");
      setErrorMsg(sessionData.error ?? "Authorization failed.");
    }
  }, [sessionData, onCompleted]);

  const handleConnect = async () => {
    setPhase("starting");
    setErrorMsg("");
    try {
      const res = await connectMutation.mutateAsync();
      setSessionId(res.session_id);
    } catch (err: unknown) {
      setPhase("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to start OAuth flow.");
    }
  };

  const handleCancel = async () => {
    if (sessionId) {
      await cancelSession.mutateAsync(sessionId).catch(() => {});
    }
    onCancel();
  };

  const handleRetry = () => {
    setPhase("idle");
    setSessionId(null);
    setErrorMsg("");
  };

  if (phase === "idle" || phase === "starting") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4 space-y-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs text-[var(--text-primary)] font-medium">No API key needed</p>
              <p className="text-[11px] text-[var(--text-tertiary)]">
                Click Connect to open Vercel&apos;s authorization page. Sign in and approve access — the token is stored locally and refreshed automatically.
              </p>
            </div>
          </div>
        </div>

        <Button
          className="w-full"
          onClick={handleConnect}
          disabled={phase === "starting"}
        >
          {phase === "starting" ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Preparing…
            </>
          ) : (
            <>
              <ExternalLink className="h-4 w-4 mr-2" />
              Connect with Vercel
            </>
          )}
        </Button>
      </div>
    );
  }

  if (phase === "waiting") {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-3 py-6">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--text-tertiary)]" />
          <p className="text-sm text-[var(--text-secondary)]">Waiting for Vercel authorization…</p>
          <p className="text-[11px] text-[var(--text-tertiary)] text-center">
            Complete the sign-in in your browser. This page will update automatically.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs text-[var(--text-tertiary)]"
          onClick={handleCancel}
        >
          Cancel
        </Button>
      </div>
    );
  }

  if (phase === "completed") {
    return (
      <div className="flex flex-col items-center gap-2 py-6">
        <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        <p className="text-sm font-semibold text-[var(--text-primary)]">Connected!</p>
        <p className="text-[11px] text-[var(--text-tertiary)]">Vercel is ready to use.</p>
      </div>
    );
  }

  // Error
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-xl border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/5 p-3">
        <AlertCircle className="h-4 w-4 text-[var(--color-destructive)] shrink-0 mt-0.5" />
        <p className="text-xs text-[var(--text-primary)] whitespace-pre-wrap">{errorMsg}</p>
      </div>
      <Button variant="outline" size="sm" className="w-full text-xs" onClick={handleRetry}>
        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
        Try again
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
  onDisconnect,
  onReconnect,
}: {
  username: string;
  name?: string;
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
        {/* Header */}
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
              <OAuthFlow
                onCompleted={() => refetch()}
                onCancel={() => refetch()}
              />
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
