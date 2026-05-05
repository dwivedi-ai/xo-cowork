"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  X,
  Plus,
  Trash2,
  Loader2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  HardDrive,
  ChevronDown,
  ChevronRight,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useGDriveRemotes,
  useGDriveCreateRemote,
  useGDriveSession,
  useGDriveDeleteRemote,
  useGDriveCancelSession,
  useGDriveSubmitCode,
  type GDriveRemote,
} from "@/hooks/use-gdrive";

// ---------------------------------------------------------------------------
// Google Drive icon (SVG)
// ---------------------------------------------------------------------------

function GDriveIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" aria-hidden="true">
      <path
        d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z"
        fill="#0066da"
      />
      <path
        d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z"
        fill="#00ac47"
      />
      <path
        d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z"
        fill="#ea4335"
      />
      <path
        d="m43.65 25 13.75-23.8c-1.35-.8-2.85-1.2-4.35-1.2h-18.8c-1.5 0-3 .45-4.35 1.2z"
        fill="#00832d"
      />
      <path
        d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.85 1.2 4.35 1.2h51.1c1.5 0 3-.45 4.35-1.2z"
        fill="#2684fc"
      />
      <path
        d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z"
        fill="#ffba00"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Name validation (mirrors backend)
// ---------------------------------------------------------------------------

const NAME_RE = /^[a-z0-9_-]{1,32}$/;

function validateName(name: string): string | null {
  if (!name) return null; // empty = no error shown yet
  if (!NAME_RE.test(name))
    return "Lowercase letters, digits, _ or - only. Max 32 chars.";
  return null;
}

// ---------------------------------------------------------------------------
// Remote row
// ---------------------------------------------------------------------------

function RemoteRow({
  remote,
  onDelete,
  onReconnect,
}: {
  remote: GDriveRemote;
  onDelete: (name: string) => void;
  onReconnect: (name: string) => void;
}) {
  const deleteMutation = useGDriveDeleteRemote();

  const handleDelete = async () => {
    await deleteMutation.mutateAsync(remote.name);
    onDelete(remote.name);
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] px-4 py-3">
      {/* Status dot */}
      <span
        className={`h-2 w-2 rounded-full shrink-0 ${
          remote.complete ? "bg-emerald-500" : "bg-amber-500"
        }`}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)] truncate">
          {remote.name}
        </p>
        <p className="text-[11px] text-[var(--text-tertiary)]">
          {remote.complete ? "Connected" : "Incomplete — reconnect or remove"}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {!remote.complete && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-[11px] px-2 text-[var(--color-warning)]"
            onClick={() => onReconnect(remote.name)}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Reconnect
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-[var(--text-tertiary)] hover:text-[var(--color-destructive)]"
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          title="Remove"
        >
          {deleteMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OAuth flow state machine panel
// ---------------------------------------------------------------------------

type FlowState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "awaiting_oauth"; authUrl: string; sessionId: string; manualCode: boolean }
  | { phase: "waiting_completion"; sessionId: string }
  | { phase: "completed"; remoteName: string }
  | { phase: "error"; message: string; sessionId?: string; conflict?: boolean };

function AddRemoteFlow({
  existingNames,
  onCompleted,
  onCancel,
}: {
  existingNames: string[];
  onCompleted: () => void;
  onCancel: (sessionId?: string) => void;
}) {
  const [name, setName] = useState("");
  const [flow, setFlow] = useState<FlowState>({ phase: "idle" });
  const [pastedUrl, setPastedUrl] = useState("");
  const [showDeployNote, setShowDeployNote] = useState(false);
  const sessionId =
    flow.phase === "awaiting_oauth" || flow.phase === "waiting_completion"
      ? flow.sessionId
      : null;

  const createMutation = useGDriveCreateRemote();
  const submitCode = useGDriveSubmitCode();
  const { data: sessionData } = useGDriveSession(sessionId);

  // React to session poll updates
  useEffect(() => {
    if (!sessionData) return;
    if (sessionData.status === "awaiting_oauth" && sessionData.auth_url) {
      setFlow({
        phase: "awaiting_oauth",
        authUrl: sessionData.auth_url,
        sessionId: sessionId!,
        manualCode: sessionData.needs_manual_code ?? false,
      });
    } else if (sessionData.status === "completed") {
      setFlow({ phase: "completed", remoteName: sessionData.remote_name ?? name });
      setTimeout(onCompleted, 1500);
    } else if (sessionData.status === "failed") {
      setFlow({
        phase: "error",
        message: sessionData.error ?? "Authorization failed. Please try again.",
        sessionId: sessionId ?? undefined,
      });
    }
  }, [sessionData, sessionId, name, onCompleted]);

  const nameError = validateName(name);
  const isDuplicate = existingNames.includes(name);

  const handleConnect = async (force = false) => {
    if (nameError || !name || isDuplicate) return;
    setFlow({ phase: "starting" });
    try {
      const res = await createMutation.mutateAsync({ name, force });
      setFlow({ phase: "waiting_completion", sessionId: res.session_id });
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      const msg =
        err instanceof Error ? err.message : "Failed to start connection. Please try again.";
      setFlow({ phase: "error", message: msg, conflict: status === 409 });
    }
  };

  const handleSubmitCode = async () => {
    if (!pastedUrl.trim() || flow.phase !== "awaiting_oauth") return;
    try {
      await submitCode.mutateAsync({ sessionId: flow.sessionId, code: pastedUrl.trim() });
      setPastedUrl("");
      // Session poll will detect completion
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to submit code.";
      setFlow({ phase: "error", message: msg, sessionId: flow.sessionId });
    }
  };

  const handleRetry = () => {
    setFlow({ phase: "idle" });
    setName("");
    setPastedUrl("");
  };

  const handleCancel = (sid?: string) => {
    onCancel(sid);
    setFlow({ phase: "idle" });
    setName("");
    setPastedUrl("");
  };

  // -- Idle / form --
  if (flow.phase === "idle" || flow.phase === "starting") {
    return (
      <div className="space-y-3 pt-3 border-t border-[var(--border-default)]">
        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          Add new connection
        </h3>
        <div className="space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase())}
            placeholder="my-drive"
            className="w-full h-9 rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/40 focus:border-[var(--brand-primary)] transition-all"
          />
          {nameError && (
            <p className="text-[11px] text-[var(--color-destructive)]">{nameError}</p>
          )}
          {isDuplicate && !nameError && (
            <p className="text-[11px] text-[var(--color-destructive)]">
              A remote with this name already exists.
            </p>
          )}
        </div>
        <Button
          className="w-full"
          onClick={() => handleConnect()}
          disabled={!name || !!nameError || isDuplicate || flow.phase === "starting"}
        >
          {flow.phase === "starting" ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Preparing…
            </>
          ) : (
            <>
              <Plus className="h-4 w-4 mr-2" />
              Connect Google Drive
            </>
          )}
        </Button>
      </div>
    );
  }

  // -- Waiting for poll to return auth URL --
  if (flow.phase === "waiting_completion") {
    return (
      <div className="pt-3 border-t border-[var(--border-default)] space-y-4">
        <div className="flex flex-col items-center gap-3 py-4">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--text-tertiary)]" />
          <p className="text-sm text-[var(--text-secondary)]">Preparing authorization…</p>
        </div>
      </div>
    );
  }

  // -- Awaiting OAuth --
  if (flow.phase === "awaiting_oauth") {
    // AUTOMATIC MODE: port 53682 is free, rclone handles callback automatically
    if (!flow.manualCode) {
      return (
        <div className="pt-3 border-t border-[var(--border-default)] space-y-4">
          <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
            Authorize Google Drive
          </h3>
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4 space-y-3">
            <Button
              className="w-full"
              onClick={() => window.open(flow.authUrl, "_blank", "noopener")}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Open Google sign-in
            </Button>
          </div>
          <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            <span className="text-xs">Waiting for Google sign-in to complete…</span>
          </div>
          <Button
            variant="ghost" size="sm"
            className="w-full text-xs text-[var(--text-tertiary)]"
            onClick={() => handleCancel(flow.sessionId)}
          >
            Cancel
          </Button>
        </div>
      );
    }

    // MANUAL MODE: port 53682 is occupied — user must paste the redirect URL
    return (
      <div className="pt-3 border-t border-[var(--border-default)] space-y-4">
        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          Authorize Google Drive
        </h3>

        <ol className="space-y-3">
          {/* Step 1 */}
          <li className="flex gap-3">
            <span className="h-5 w-5 rounded-full bg-[var(--brand-primary)] text-[var(--brand-primary-text)] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
              1
            </span>
            <div className="flex-1 space-y-1.5">
              <p className="text-xs text-[var(--text-primary)]">Open Google sign-in</p>
              <Button
                size="sm" className="h-8 text-xs"
                onClick={() => window.open(flow.authUrl, "_blank", "noopener")}
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Open Google sign-in
              </Button>
            </div>
          </li>

          {/* Step 2 */}
          <li className="flex gap-3">
            <span className="h-5 w-5 rounded-full bg-[var(--brand-primary)] text-[var(--brand-primary-text)] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
              2
            </span>
            <p className="text-xs text-[var(--text-primary)] pt-0.5">
              Sign in and approve access. Your browser will show an{" "}
              <span className="text-amber-500 font-medium">error page — that&apos;s expected</span>. The auth callback runs inside the workspace, not your browser.
            </p>
          </li>

          {/* Step 3 */}
          <li className="flex gap-3">
            <span className="h-5 w-5 rounded-full bg-[var(--brand-primary)] text-[var(--brand-primary-text)] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
              3
            </span>
            <div className="flex-1 space-y-1.5">
              <p className="text-xs text-[var(--text-primary)]">
                Copy the <strong>full URL</strong> from your browser&apos;s address bar{" "}
                <span className="text-[var(--text-tertiary)]">(starts with http://127.0.0.1:53682/?code=…)</span>
                {" "}and paste it below.
              </p>
              <textarea
                value={pastedUrl}
                onChange={(e) => setPastedUrl(e.target.value)}
                placeholder="http://127.0.0.1:53682/?code=4/0A…&state=…"
                rows={2}
                className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/40 focus:border-[var(--brand-primary)] resize-none transition-all font-mono"
              />
              <Button
                className="w-full" size="sm"
                disabled={!pastedUrl.trim() || submitCode.isPending}
                onClick={handleSubmitCode}
              >
                {submitCode.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                )}
                Submit
              </Button>
            </div>
          </li>
        </ol>

        <button
          type="button"
          className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          onClick={() => setShowDeployNote((v) => !v)}
        >
          <Info className="h-3 w-3" />
          Why does the page show an error?
          {showDeployNote ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        {showDeployNote && (
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 text-[11px] text-[var(--text-secondary)] space-y-1.5">
            <p>
              Google redirects to <code>127.0.0.1:53682</code>, which points to your
              local machine — not the workspace where rclone is waiting. So the
              browser shows a connection error. The <strong>authorization code is
              still in the URL bar</strong>; pasting it here lets the workspace
              deliver it to rclone locally.
            </p>
          </div>
        )}

        <Button
          variant="ghost" size="sm"
          className="w-full text-xs text-[var(--text-tertiary)]"
          onClick={() => handleCancel(flow.sessionId)}
        >
          Cancel
        </Button>
      </div>
    );
  }

  // -- Completed --
  if (flow.phase === "completed") {
    return (
      <div className="pt-3 border-t border-[var(--border-default)]">
        <div className="flex flex-col items-center gap-2 py-6">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Connected!</p>
          <p className="text-[11px] text-[var(--text-tertiary)]">
            &ldquo;{flow.remoteName}&rdquo; is ready to use.
          </p>
        </div>
      </div>
    );
  }

  // -- Error --
  if (flow.phase === "error") {
    const conflict = flow.conflict;
    return (
      <div className="pt-3 border-t border-[var(--border-default)] space-y-3">
        <div className="flex items-start gap-2 rounded-xl border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/5 p-3">
          <AlertCircle className="h-4 w-4 text-[var(--color-destructive)] shrink-0 mt-0.5" />
          <p className="text-xs text-[var(--text-primary)] whitespace-pre-wrap">{flow.message}</p>
        </div>
        {conflict && (
          <Button size="sm" className="w-full text-xs" onClick={() => handleConnect(true)}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Cancel existing flow & retry
          </Button>
        )}
        <Button variant="outline" size="sm" className="w-full text-xs" onClick={handleRetry}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
          Try again
        </Button>
      </div>
    );
  }

  return null;
}


// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

function GDriveModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const { data, isLoading, error, refetch } = useGDriveRemotes();
  const cancelSession = useGDriveCancelSession();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const remotes = data?.remotes ?? [];
  const existingNames = remotes.map((r) => r.name);

  // Cancel session on modal close
  const handleClose = useCallback(async () => {
    if (activeSessionId) {
      await cancelSession.mutateAsync(activeSessionId).catch(() => {});
    }
    onClose();
  }, [activeSessionId, cancelSession, onClose]);

  const handleCompleted = () => {
    setActiveSessionId(null);
    refetch();
  };

  const handleCancelFlow = async (sessionId?: string) => {
    if (sessionId) {
      await cancelSession.mutateAsync(sessionId).catch(() => {});
    }
    setActiveSessionId(null);
  };

  // Close on backdrop click
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) handleClose();
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={handleOverlayClick}
    >
      <div className="relative w-full max-w-md bg-[var(--surface-primary)] rounded-2xl border border-[var(--border-default)] shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border-default)] shrink-0">
          <GDriveIcon size={20} />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Google Drive
            </h2>
            <p className="text-[11px] text-[var(--text-tertiary)]">
              Connect your Google Drive account
            </p>
          </div>
          <button
            onClick={handleClose}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Existing remotes */}
          {isLoading && (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-14 rounded-xl bg-[var(--surface-secondary)] animate-pulse"
                />
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/5 p-3">
              <AlertCircle className="h-4 w-4 text-[var(--color-destructive)] shrink-0 mt-0.5" />
              <p className="text-xs text-[var(--text-primary)]">
                Could not reach rclone daemon. Make sure rclone is installed
                and the bridge server is running.
              </p>
            </div>
          )}

          {!isLoading && !error && remotes.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <HardDrive className="h-8 w-8 text-[var(--text-tertiary)]" />
              <p className="text-sm text-[var(--text-secondary)]">
                No Google Drive connections yet
              </p>
              <p className="text-[11px] text-[var(--text-tertiary)]">
                Add one below to get started.
              </p>
            </div>
          )}

          {remotes.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                Connected accounts
              </h3>
              {remotes.map((r) => (
                <RemoteRow
                  key={r.name}
                  remote={r}
                  onDelete={() => refetch()}
                  onReconnect={(remoteName) => {
                    // Put the name in the form for reconnect
                    refetch();
                  }}
                />
              ))}
            </div>
          )}

          {/* Add new flow */}
          <AddRemoteFlow
            existingNames={existingNames}
            onCompleted={handleCompleted}
            onCancel={handleCancelFlow}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tile (shown in the Connectors grid)
// ---------------------------------------------------------------------------

export function GDriveConnectorTile() {
  const [modalOpen, setModalOpen] = useState(false);
  const { data, isLoading } = useGDriveRemotes();
  const remotes = data?.remotes ?? [];
  const connectedCount = remotes.filter((r) => r.complete).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 hover:bg-[var(--surface-tertiary)] transition-colors text-left w-full group"
      >
        {/* Status dot */}
        <span
          className={`h-2 w-2 rounded-full shrink-0 ${
            connectedCount > 0 ? "bg-emerald-500" : "bg-[var(--text-tertiary)]"
          }`}
        />

        {/* Icon */}
        <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
          <GDriveIcon size={18} />
        </div>

        {/* Label */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[var(--text-primary)] truncate">
            Google Drive
          </p>
          <p className="text-[10px] text-[var(--text-tertiary)]">
            {isLoading
              ? "Loading…"
              : connectedCount > 0
              ? `${connectedCount} connected`
              : "Not connected"}
          </p>
        </div>
      </button>

      {modalOpen && (
        <GDriveModal onClose={() => setModalOpen(false)} />
      )}
    </>
  );
}
