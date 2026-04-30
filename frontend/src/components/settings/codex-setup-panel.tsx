"use client";

import { useCallback, useRef, useState } from "react";
import {
  Check,
  Copy,
  Loader2,
  AlertCircle,
  ExternalLink,
  Plus,
  MoreHorizontal,
  ArrowRight,
  X,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { API, queryKeys, resolveCoworkApiUrl, IS_DESKTOP } from "@/lib/constants";
import { desktopAPI } from "@/lib/tauri-api";
import { consumeCodexSetupStream } from "@/lib/codex-device-auth";

interface CodexAccount {
  id: string;
  email: string;
  expires?: number | null;
}

interface CodexStatus {
  is_connected: boolean;
  email: string;
  accounts?: CodexAccount[];
}

function OpenAIMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.682zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  );
}

function accountInitials(email: string): string {
  const [local] = email.split("@");
  if (!local) return "?";
  const parts = local.split(/[._\-+]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

export function CodexSetupPanel() {
  const { t } = useTranslation("settings");
  const qc = useQueryClient();

  const { data: codexStatus } = useQuery({
    queryKey: queryKeys.codexStatus,
    queryFn: () => api.get<CodexStatus>(API.CODEX.STATUS),
  });

  const [connecting, setConnecting] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const openedRef = useRef(false);

  const openAuthUrl = useCallback((url: string) => {
    if (openedRef.current) return;
    openedRef.current = true;
    if (IS_DESKTOP) {
      desktopAPI.openExternal(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, []);

  const startSetup = useCallback(async () => {
    setError(null);
    setConnecting(true);
    setInstalling(false);
    setAuthUrl(null);
    setUserCode(null);
    openedRef.current = false;

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const url = resolveCoworkApiUrl(API.CODEX.SETUP);
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
      });

      if (!resp.ok || !resp.body) {
        setError(t("codexLoginFailed"));
        setConnecting(false);
        return;
      }

      await consumeCodexSetupStream(resp.body, {
        onInstalling: () => setInstalling(true),
        onUrl: (u) => {
          setAuthUrl(u);
          openAuthUrl(u);
        },
        onCode: (c) => setUserCode(c),
        onDone: (rc) => {
          setInstalling(false);
          if (rc === 0) {
            qc.invalidateQueries({ queryKey: queryKeys.codexStatus });
            setConnecting(false);
            setAuthUrl(null);
            setUserCode(null);
          } else {
            setError(t("codexLoginFailed"));
            setConnecting(false);
          }
        },
        onError: (msg) => {
          setError(msg || t("codexSetupError"));
          setInstalling(false);
          setConnecting(false);
        },
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(String(e));
        setConnecting(false);
      }
    }
  }, [t, qc, openAuthUrl]);

  const cancelSetup = useCallback(() => {
    abortRef.current?.abort();
    setConnecting(false);
    setInstalling(false);
    setAuthUrl(null);
    setUserCode(null);
    setError(null);
  }, []);

  const isConnected = codexStatus?.is_connected ?? false;
  const accounts: CodexAccount[] =
    codexStatus?.accounts && codexStatus.accounts.length > 0
      ? codexStatus.accounts
      : isConnected
        ? [
            {
              id: codexStatus?.email ?? "codex",
              email: codexStatus?.email ?? t("codexConnected"),
            },
          ]
        : [];

  const midAuth = connecting;

  return (
    <div className="space-y-6">
      {/* Integration header — premium OAuth-panel vibe */}
      <div className="relative overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-secondary)]">
        {/* subtle corner glyph */}
        <div className="pointer-events-none absolute -right-8 -top-8 opacity-[0.04]">
          <OpenAIMark className="h-48 w-48 text-[var(--text-primary)]" />
        </div>

        <div className="relative flex items-start gap-4 p-5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] shadow-sm">
            <OpenAIMark className="h-6 w-6 text-[var(--text-primary)]" />
          </div>

          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <h2 className="text-base font-semibold leading-none text-[var(--text-primary)]">
                {t("codexProvider")}
              </h2>
              {isConnected ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-success)]/30 bg-[var(--color-success)]/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-success)]">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-success)] opacity-60" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
                  </span>
                  {t("codexActive")}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--surface-primary)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--text-tertiary)]" />
                  Not connected
                </span>
              )}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
              {t("codexProviderDesc")}
            </p>
          </div>
        </div>
      </div>

      {/* Body */}
      {midAuth ? (
        <AuthInProgressCard
          authUrl={authUrl}
          userCode={userCode}
          installing={installing}
          onReopen={openAuthUrl}
          onCancel={cancelSetup}
          t={t}
        />
      ) : isConnected ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
              Connected accounts
              <span className="ml-1.5 rounded-sm bg-[var(--surface-secondary)] px-1 py-px font-mono text-[10px] text-[var(--text-secondary)]">
                {accounts.length}
              </span>
            </h3>
          </div>

          <ul className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-primary)] divide-y divide-[var(--border-default)]">
            {accounts.map((acct, idx) => (
              <li
                key={acct.id}
                className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-secondary)]"
              >
                <div className="relative shrink-0">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] font-mono text-[11px] font-semibold tracking-wider text-[var(--text-primary)]">
                    {accountInitials(acct.email)}
                  </div>
                  <span
                    className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--color-success)] ring-2 ring-[var(--surface-primary)]"
                    aria-hidden="true"
                  >
                    <Check className="h-2 w-2 text-white" strokeWidth={3.5} />
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p
                      className="truncate text-sm font-medium text-[var(--text-primary)]"
                      title={acct.email}
                    >
                      {acct.email}
                    </p>
                    {idx === 0 && (
                      <span className="shrink-0 rounded-md border border-[var(--border-default)] bg-[var(--surface-secondary)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                        Primary
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
                    <span className="inline-block h-1 w-1 rounded-full bg-[var(--color-success)]" />
                    OAuth · Token active
                  </p>
                </div>

                <button
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] opacity-0 transition-all hover:bg-[var(--border-default)] hover:text-[var(--text-primary)] group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label="Account options"
                  type="button"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>

          <div className="pt-1">
            <Button
              onClick={startSetup}
              disabled={connecting}
              variant="outline"
              className="h-10 gap-2 px-4 text-sm font-medium"
            >
              {connecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("codexConnecting")}
                </>
              ) : (
                <>
                  <OpenAIMark className="h-4 w-4" />
                  Connect to Codex
                </>
              )}
            </Button>
          </div>
        </div>
      ) : (
        /* Not connected — elevated empty state */
        <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)]">
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <div className="relative mb-5">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--border-default)] bg-[var(--surface-secondary)]">
                <OpenAIMark className="h-8 w-8 text-[var(--text-primary)]" />
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--surface-primary)] bg-[var(--surface-secondary)]">
                <Plus className="h-3.5 w-3.5 text-[var(--text-secondary)]" strokeWidth={2.5} />
              </div>
            </div>
            <p className="mb-1 text-sm font-semibold text-[var(--text-primary)]">
              No OpenAI accounts connected
            </p>
            <p className="mb-5 max-w-xs text-xs leading-relaxed text-[var(--text-secondary)]">
              Sign in through OAuth to start using Codex models. You can connect multiple accounts and switch between them anytime.
            </p>
            <Button
              onClick={startSetup}
              disabled={connecting}
              className="h-10 gap-2 px-5 text-sm font-medium"
            >
              {connecting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("codexConnecting")}
                </>
              ) : (
                <>
                  <OpenAIMark className="h-4 w-4" />
                  {t("codexSignIn")}
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/5 px-3 py-2.5 text-xs text-[var(--color-destructive)]">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}
    </div>
  );
}

function AuthInProgressCard({
  authUrl,
  userCode,
  installing,
  onReopen,
  onCancel,
  t,
}: {
  authUrl: string | null;
  userCode: string | null;
  installing: boolean;
  onReopen: (url: string) => void;
  onCancel: () => void;
  t: (key: string) => string;
}) {
  const [copied, setCopied] = useState(false);

  const copyCode = useCallback(async () => {
    if (!userCode) return;
    try {
      await navigator.clipboard.writeText(userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can still read the code */
    }
  }, [userCode]);

  const waitingForCli = !authUrl || !userCode;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)]">
      {/* pulsing top accent */}
      <div className="relative h-0.5 w-full overflow-hidden bg-[var(--border-default)]">
        <div className="absolute inset-y-0 left-0 w-1/3 animate-[slide_1.4s_ease-in-out_infinite] bg-[var(--text-primary)]" />
        <style jsx>{`
          @keyframes slide {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(400%); }
          }
        `}</style>
      </div>

      <div className="flex items-center justify-between px-5 pt-4">
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--text-secondary)]" />
          {installing
            ? "Installing Codex CLI…"
            : waitingForCli
              ? "Preparing sign-in…"
              : t("codexWaitingAuth")}
        </div>
        <button
          onClick={onCancel}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]"
          aria-label="Cancel"
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-5 pb-5 pt-3">
        <ol className="mb-4 space-y-2 text-xs text-[var(--text-secondary)]">
          <li className="flex items-start gap-2.5">
            <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] font-mono text-[9px] font-semibold text-[var(--text-secondary)]">
              1
            </span>
            <span className="leading-snug">
              Open the sign-in page
              {authUrl ? " (we opened it for you)" : ""} and sign in to your ChatGPT account.
            </span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] font-mono text-[9px] font-semibold text-[var(--text-secondary)]">
              2
            </span>
            <span className="leading-snug">
              Enter the one-time code shown below. It expires in 15 minutes.
            </span>
          </li>
        </ol>

        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
            One-time code
          </div>
          <div className="flex items-center gap-2">
            <div
              className="flex-1 select-all rounded-md border border-[var(--border-default)] bg-[var(--surface-primary)] px-3 py-2 font-mono text-xl font-semibold tracking-[0.2em] text-[var(--text-primary)]"
              aria-live="polite"
            >
              {userCode ?? "····-·····"}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyCode}
              disabled={!userCode}
              className="shrink-0 gap-1.5"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-4 border-t border-[var(--border-default)] pt-3">
          {authUrl && (
            <button
              type="button"
              onClick={() => onReopen(authUrl)}
              className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              Re-open login page
            </button>
          )}
          <div className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            Waiting for you to finish sign-in…
          </div>
        </div>
      </div>
    </div>
  );
}
