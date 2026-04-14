"use client";

import { useCallback, useRef, useState } from "react";
import { Check, Loader2, AlertCircle, LogOut, Zap, ExternalLink } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { API, queryKeys, XO_COWORK_API_BASE, IS_DESKTOP } from "@/lib/constants";
import { desktopAPI } from "@/lib/tauri-api";

interface CodexStatus {
  is_connected: boolean;
  email: string;
}

export function CodexSetupPanel() {
  const { t } = useTranslation("settings");
  const qc = useQueryClient();

  const { data: codexStatus } = useQuery({
    queryKey: queryKeys.codexStatus,
    queryFn: () => api.get<CodexStatus>(API.CODEX.STATUS),
  });

  const [connecting, setConnecting] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [callbackInput, setCallbackInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const startSetup = useCallback(async () => {
    setError(null);
    setConnecting(true);
    setSessionId(null);
    setAuthUrl(null);
    setCallbackInput("");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const url = `${XO_COWORK_API_BASE}${API.CODEX.SETUP}`;
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

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "session") {
              setSessionId(data.session_id);
            } else if (data.type === "auth_url") {
              setAuthUrl(data.url);
              // Open the auth URL in browser
              if (IS_DESKTOP) {
                desktopAPI.openExternal(data.url);
              } else {
                window.open(data.url, "_blank", "noopener,noreferrer");
              }
            } else if (data.type === "done" && data.status === "completed") {
              // Callback was handled — refresh status
              qc.invalidateQueries({ queryKey: queryKeys.codexStatus });
              setConnecting(false);
              setAuthUrl(null);
              setSessionId(null);
              return;
            } else if (data.type === "error") {
              setError(data.error || t("codexSetupError"));
              setConnecting(false);
              return;
            }
          } catch {
            /* ignore parse errors */
          }
        }
      }

      // Stream ended without explicit done — might be timeout
      if (connecting) {
        setError(t("codexSetupTimeout"));
        setConnecting(false);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(String(e));
        setConnecting(false);
      }
    }
  }, [t, qc]);

  const submitCallback = useCallback(async () => {
    if (!sessionId || !callbackInput.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const url = `${XO_COWORK_API_BASE}${API.CODEX.CALLBACK}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: callbackInput.trim(), session_id: sessionId }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError(body.detail || t("codexCallbackFailed"));
        setSubmitting(false);
        return;
      }

      // Success — the SSE stream will detect completion, but also refresh here
      qc.invalidateQueries({ queryKey: queryKeys.codexStatus });
      setConnecting(false);
      setAuthUrl(null);
      setSessionId(null);
      setCallbackInput("");
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  }, [sessionId, callbackInput, t, qc]);

  const cancelSetup = useCallback(() => {
    abortRef.current?.abort();
    setConnecting(false);
    setSessionId(null);
    setAuthUrl(null);
    setCallbackInput("");
    setError(null);
  }, []);

  const isConnected = codexStatus?.is_connected ?? false;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Zap className="h-5 w-5 text-[var(--text-primary)]" />
        <h2 className="text-base font-semibold text-[var(--text-primary)]">{t("codexProvider")}</h2>
      </div>
      <p className="text-xs text-[var(--text-secondary)]">{t("codexProviderDesc")}</p>

      {isConnected ? (
        /* Connected state */
        <div className="rounded-lg border border-[var(--border-default)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-[var(--color-success)]" />
              <span className="text-sm text-[var(--text-primary)]">{codexStatus?.email || t("codexConnected")}</span>
            </div>
            <span className="text-xs font-medium text-[var(--color-success)]">{t("codexActive")}</span>
          </div>
        </div>
      ) : authUrl && connecting ? (
        /* Auth in progress — waiting for callback URL */
        <div className="rounded-lg border border-[var(--border-default)] p-4 space-y-3">
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>{t("codexWaitingAuth")}</span>
          </div>

          <p className="text-xs text-[var(--text-secondary)]">{t("codexPasteInstruction")}</p>

          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={callbackInput}
              onChange={(e) => setCallbackInput(e.target.value)}
              placeholder={t("codexPastePlaceholder")}
              className="font-mono text-xs"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={submitCallback}
              disabled={!callbackInput.trim() || submitting}
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("codexSubmitCallback")}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              Re-open login page
            </a>
            <button
              onClick={cancelSetup}
              className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] ml-auto"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        /* Not connected — show connect button */
        <div className="space-y-2">
          <Button
            variant="outline"
            size="sm"
            onClick={startSetup}
            disabled={connecting}
          >
            {connecting ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />{t("codexConnecting")}</>
            ) : (
              <><Zap className="h-3.5 w-3.5 mr-1.5" />{t("codexSignIn")}</>
            )}
          </Button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-[var(--color-destructive)]">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
