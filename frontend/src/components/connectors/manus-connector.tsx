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
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useManusStatus,
  useManusSubmitKey,
  useManusDisconnect,
  useManusReconnect,
} from "@/hooks/use-manus";

// ---------------------------------------------------------------------------
// Manus icon
// ---------------------------------------------------------------------------

function ManusIcon({ size = 24 }: { size?: number }) {
  return (
    <img
      src="/manus-icon.png"
      alt="Manus AI"
      width={size}
      height={size}
      className="rounded"
    />
  );
}

const MANUS_KEY_URL = "https://manus.im/app?show_settings=integrations&app_name=api";

// ---------------------------------------------------------------------------
// Key input form
// ---------------------------------------------------------------------------

function KeyForm({ onSuccess }: { onSuccess: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const submitMutation = useManusSubmitKey();

  const handleSubmit = async () => {
    if (!apiKey.trim()) return;
    try {
      await submitMutation.mutateAsync(apiKey.trim());
      onSuccess();
    } catch {
      // error in submitMutation.error
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          Connect with API Key
        </h3>

        <ol className="space-y-2.5">
          <li className="flex gap-2.5">
            <span className="h-5 w-5 rounded-full bg-white/20 text-[var(--text-primary)] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
              1
            </span>
            <div className="flex-1 space-y-1.5">
              <p className="text-xs text-[var(--text-primary)]">
                Open your Manus API settings
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() => window.open(MANUS_KEY_URL, "_blank", "noopener")}
              >
                <ExternalLink className="h-3 w-3 mr-1.5" />
                Open Manus Settings
              </Button>
            </div>
          </li>

          <li className="flex gap-2.5">
            <span className="h-5 w-5 rounded-full bg-white/20 text-[var(--text-primary)] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
              2
            </span>
            <div className="flex-1 space-y-1">
              <p className="text-xs text-[var(--text-primary)]">
                Generate an API key and paste it below
              </p>
              <div className="relative">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="manus_key_..."
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  className="w-full h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] pl-3 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/40 transition-all font-mono text-[12px]"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                >
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </li>
        </ol>
      </div>

      {submitMutation.error && (
        <div className="flex items-start gap-2 rounded-xl border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/5 p-3">
          <AlertCircle className="h-4 w-4 text-[var(--color-destructive)] shrink-0 mt-0.5" />
          <p className="text-xs text-[var(--text-primary)]">
            {submitMutation.error instanceof Error
              ? submitMutation.error.message
              : "API key validation failed."}
          </p>
        </div>
      )}

      <Button
        className="w-full"
        onClick={handleSubmit}
        disabled={!apiKey.trim() || submitMutation.isPending}
      >
        {submitMutation.isPending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Validating…
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4 mr-2" />
            Connect Manus
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
  onDisconnect,
  onReconnect,
}: {
  onDisconnect: () => void;
  onReconnect: () => void;
}) {
  const disconnectMutation = useManusDisconnect();
  const reconnectMutation = useManusReconnect();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center">
          <ManusIcon size={28} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">Manus AI</p>
          <p className="text-[11px] text-[var(--text-tertiary)]">API key connected</p>
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

function ManusModal({ onClose }: { onClose: () => void }) {
  const { data, isLoading, refetch } = useManusStatus();
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
          <div className="h-8 w-8 rounded-lg flex items-center justify-center">
            <ManusIcon size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Manus AI</h2>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              Autonomous AI agent for tasks, research, and coding
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
              <KeyForm onSuccess={() => refetch()} />
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

export function ManusConnectorTile() {
  const [modalOpen, setModalOpen] = useState(false);
  const { data, isLoading } = useManusStatus();
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
        <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0">
          <ManusIcon size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[var(--text-primary)] truncate">Manus AI</p>
          <p className="text-[10px] text-[var(--text-tertiary)]">
            {isLoading
              ? "Loading…"
              : isConnected
              ? "Connected"
              : "Not connected"}
          </p>
        </div>
      </button>

      {modalOpen && <ManusModal onClose={() => setModalOpen(false)} />}
    </>
  );
}
