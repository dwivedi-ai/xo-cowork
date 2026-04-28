"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VercelStatusResponse {
  status: "connected" | "needs_auth" | "failed";
  username?: string;
  name?: string;
  email?: string;
  avatar_url?: string;
  error?: string;
}

export interface VercelSessionResponse {
  status: "pending" | "awaiting_oauth" | "completed" | "failed" | "cancelled";
  auth_url?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const vercelKeys = {
  status: ["vercel", "status"] as const,
  session: (id: string) => ["vercel", "session", id] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Get current Vercel connector status. */
export function useVercelStatus() {
  return useQuery({
    queryKey: vercelKeys.status,
    queryFn: () => api.get<VercelStatusResponse>(API.VERCEL.STATUS),
    staleTime: 30_000,
    retry: false,
  });
}

/** Start a Vercel OAuth flow. */
export function useVercelConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ session_id: string; status: string }>(API.VERCEL.CONNECT),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vercelKeys.status });
    },
  });
}

/** Poll a Vercel OAuth session. */
export function useVercelSession(sessionId: string | null) {
  return useQuery({
    queryKey: vercelKeys.session(sessionId ?? ""),
    queryFn: () =>
      api.get<VercelSessionResponse>(API.VERCEL.SESSION(sessionId!)),
    enabled: !!sessionId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "completed" || status === "failed" || status === "cancelled") {
        return false;
      }
      return 1500;
    },
    retry: false,
    staleTime: 0,
  });
}

/** Disconnect Vercel. */
export function useVercelDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ status: string }>(API.VERCEL.DISCONNECT),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vercelKeys.status });
    },
  });
}

/** Cancel a Vercel OAuth session. */
export function useVercelCancelSession() {
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ ok: boolean }>(API.VERCEL.CANCEL_SESSION(sessionId)),
  });
}

/** Reconnect Vercel. */
export function useVercelReconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<VercelStatusResponse>(API.VERCEL.RECONNECT),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: vercelKeys.status });
    },
  });
}
