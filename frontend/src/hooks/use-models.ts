"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API, IS_DESKTOP, queryKeys } from "@/lib/constants";
import { useAuthStore } from "@/stores/auth-store";
import type { ModelInfo } from "@/types/model";

let desktopModelSyncPromise: Promise<void> | null = null;

async function ensureDesktopXoCoworkAccountSynced(): Promise<void> {
  if (!IS_DESKTOP) return;

  const auth = useAuthStore.getState();
  if (!auth.isConnected || !auth.proxyUrl || !auth.accessToken) return;

  if (!desktopModelSyncPromise) {
    desktopModelSyncPromise = (async () => {
      try {
        const status = await api.get<{ is_connected: boolean; proxy_url: string }>(API.CONFIG.XO_COWORK_ACCOUNT);
        if (status.is_connected && status.proxy_url === auth.proxyUrl) return;
      } catch {
        // Fall through and force a re-sync.
      }

      await api.post(API.CONFIG.XO_COWORK_ACCOUNT, {
        proxy_url: auth.proxyUrl,
        token: auth.accessToken,
        ...(auth.refreshToken ? { refresh_token: auth.refreshToken } : {}),
      });
    })().finally(() => {
      desktopModelSyncPromise = null;
    });
  }

  await desktopModelSyncPromise;
}

export function useModels() {
  return useQuery({
    queryKey: queryKeys.models,
    queryFn: async () => {
      await ensureDesktopXoCoworkAccountSynced();
      return api.get<ModelInfo[]>(API.MODELS);
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
