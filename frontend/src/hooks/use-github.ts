"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubStatusResponse {
  status: "connected" | "needs_auth" | "failed";
  username?: string;
  name?: string;
  avatar_url?: string;
  scopes?: string;
  error?: string;
}

export interface GitHubTokenResponse {
  status: "connected" | "needs_auth" | "failed";
  username?: string;
  name?: string;
  avatar_url?: string;
  scopes?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const githubKeys = {
  status: ["github", "status"] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Get current GitHub connector status. */
export function useGitHubStatus() {
  return useQuery({
    queryKey: githubKeys.status,
    queryFn: () => api.get<GitHubStatusResponse>(API.GITHUB.STATUS),
    staleTime: 30_000,
    retry: false,
  });
}

/** Submit a GitHub PAT. */
export function useGitHubSubmitToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api.post<GitHubTokenResponse>(API.GITHUB.TOKEN, { token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: githubKeys.status });
    },
  });
}

/** Disconnect GitHub (delete token). */
export function useGitHubDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ status: string }>(API.GITHUB.DISCONNECT),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: githubKeys.status });
    },
  });
}

/** Reconnect GitHub (re-validate stored token). */
export function useGitHubReconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<GitHubStatusResponse>(API.GITHUB.RECONNECT),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: githubKeys.status });
    },
  });
}
