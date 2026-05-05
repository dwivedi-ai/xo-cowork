"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";

export interface ManusStatusResponse {
  status: "connected" | "needs_auth" | "failed";
  error?: string;
}

export const manusKeys = {
  status: ["manus", "status"] as const,
};

export function useManusStatus() {
  return useQuery({
    queryKey: manusKeys.status,
    queryFn: () => api.get<ManusStatusResponse>(API.MANUS.STATUS),
    staleTime: 30_000,
    retry: false,
  });
}

export function useManusSubmitKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api.post<ManusStatusResponse>(API.MANUS.TOKEN, { token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: manusKeys.status });
    },
  });
}

export function useManusDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ status: string }>(API.MANUS.DISCONNECT),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: manusKeys.status });
    },
  });
}

export function useManusReconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<ManusStatusResponse>(API.MANUS.RECONNECT),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: manusKeys.status });
    },
  });
}
