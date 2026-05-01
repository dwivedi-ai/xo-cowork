"use client";

import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";

export interface VercelStatusResponse {
  status: "connected" | "needs_auth" | "failed";
  username?: string;
  name?: string;
  email?: string;
  avatar_url?: string;
  auth_method?: "oauth" | "api_token";
  error?: string;
}

export const vercelKeys = {
  status: ["vercel", "status"] as const,
};

export function useVercelStatus() {
  return useQuery({
    queryKey: vercelKeys.status,
    queryFn: () => api.get<VercelStatusResponse>(API.VERCEL.STATUS),
    staleTime: 30_000,
    retry: false,
  });
}

export function useVercelSubmitToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api.post<VercelStatusResponse>(API.VERCEL.TOKEN, { token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vercelKeys.status });
    },
  });
}

export function useVercelDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ status: string }>(API.VERCEL.DISCONNECT),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vercelKeys.status });
    },
  });
}

export function useVercelReconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<VercelStatusResponse>(API.VERCEL.RECONNECT),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vercelKeys.status });
    },
  });
}

/**
 * Directly exchanges an authorization code + state for tokens.
 * Use when the browser redirect went to an unreachable URL (e.g. 127.0.0.1 in
 * a remote workspace) — the user copies the full address-bar URL, the UI
 * extracts code+state and calls this mutation instead of waiting for postMessage.
 */
export function useVercelOAuthExchange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, state }: { code: string; state: string }) =>
      api.post<VercelStatusResponse>(API.VERCEL.OAUTH_EXCHANGE, { code, state }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vercelKeys.status });
    },
  });
}

/**
 * Returns a callback that initiates the Vercel OAuth 2.1 PKCE flow via a popup.
 *
 * Flow:
 *   1. GET /api/connectors/vercel/oauth/start → {auth_url, state}
 *   2. Open auth_url in a popup window
 *   3. Wait for a postMessage from /callback:
 *      - vercel_oauth_success → resolve, invalidate status cache
 *      - vercel_oauth_error   → reject with error message
 *   4. If the popup is closed manually, invalidate status and resolve
 *      (the backend may have already stored the token before close).
 */
export function useVercelOAuthStart() {
  const qc = useQueryClient();

  return useCallback(async (): Promise<void> => {
    const { auth_url } = await api.get<{ auth_url: string; state: string }>(
      API.VERCEL.OAUTH_START
    );

    return new Promise((resolve, reject) => {
      const popup = window.open(
        auth_url,
        "vercel_oauth",
        "width=600,height=700,left=200,top=100,scrollbars=yes,resizable=yes"
      );

      if (!popup) {
        reject(
          new Error(
            "Popup blocked. Please allow popups for this site and try again."
          )
        );
        return;
      }

      let settled = false;

      const cleanup = () => {
        window.removeEventListener("message", handleMessage);
        clearInterval(pollClosed);
      };

      const handleMessage = (event: MessageEvent) => {
        // Accept messages from our own callback page only.
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === "vercel_oauth_success") {
          settled = true;
          cleanup();
          qc.invalidateQueries({ queryKey: vercelKeys.status });
          resolve();
        } else if (event.data?.type === "vercel_oauth_error") {
          settled = true;
          cleanup();
          reject(
            new Error(event.data.error || "Vercel OAuth authorization failed.")
          );
        }
      };

      window.addEventListener("message", handleMessage);

      // Detect manual popup close — invalidate status so the UI reflects
      // any token that was successfully saved before the window closed.
      const pollClosed = setInterval(() => {
        if (popup.closed) {
          cleanup();
          if (!settled) {
            qc.invalidateQueries({ queryKey: vercelKeys.status });
            resolve();
          }
        }
      }, 500);
    });
  }, [qc]);
}
