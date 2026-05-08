"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GitHubAuthMethod = "pat" | "cli";

export interface GitHubStatusResponse {
  status: "connected" | "needs_auth" | "failed";
  username?: string;
  name?: string;
  avatar_url?: string;
  scopes?: string;
  auth_method?: GitHubAuthMethod;
  error?: string;
}

export interface GitHubTokenResponse {
  status: "connected" | "needs_auth" | "failed";
  username?: string;
  name?: string;
  avatar_url?: string;
  scopes?: string;
  auth_method?: GitHubAuthMethod;
  error?: string;
}

export interface GitHubCliStartResponse {
  session_id: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
}

export interface GitHubCliPollResponse {
  status: "pending" | "connected" | "failed";
  user_code?: string;
  verification_uri?: string;
  username?: string;
  name?: string;
  avatar_url?: string;
  scopes?: string;
  auth_method?: GitHubAuthMethod;
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

// ---------------------------------------------------------------------------
// `gh auth login` device-flow hook
// ---------------------------------------------------------------------------

export type GitHubCliPhase = "idle" | "pending" | "connected" | "failed";

interface UseGitHubCliLoginResult {
  phase: GitHubCliPhase;
  userCode: string | null;
  verificationUri: string | null;
  error: string | null;
  isStarting: boolean;
  isCancelling: boolean;
  start: () => void;
  cancel: () => void;
  reset: () => void;
}

/**
 * Drives the `gh auth login` device flow:
 *   start  → backend spawns gh, returns user_code + verification_uri
 *   pending → poll every 3s until user authorizes on github.com
 *   connected → status query is invalidated, parent re-renders ConnectedView
 *   failed → surface error
 *
 * The hook auto-cancels the in-flight session if the consumer unmounts
 * (e.g. the modal is closed mid-flow), so the server-side gh subprocess
 * doesn't linger.
 */
export function useGitHubCliLogin(): UseGitHubCliLoginResult {
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [phase, setPhase] = useState<GitHubCliPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const startMutation = useMutation({
    mutationFn: () => api.post<GitHubCliStartResponse>(API.GITHUB.CLI_START),
    onSuccess: (data) => {
      setSessionId(data.session_id);
      setUserCode(data.user_code);
      setVerificationUri(data.verification_uri);
      setPhase("pending");
      setError(null);
    },
    onError: (e) => {
      setPhase("failed");
      setError(
        e instanceof Error
          ? e.message
          : "Could not start GitHub CLI sign-in.",
      );
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (sid: string) =>
      api.post<{ status: string }>(API.GITHUB.CLI_CANCEL, { session_id: sid }),
  });

  // Poll the session while pending. Disabled in any other phase, which is
  // what stops the polling once we've reached connected/failed.
  useQuery({
    queryKey: ["github", "cli", "poll", sessionId],
    queryFn: async () => {
      if (!sessionId) return null;
      try {
        const data = await api.post<GitHubCliPollResponse>(
          API.GITHUB.CLI_POLL,
          { session_id: sessionId },
        );
        if (data.status === "connected") {
          setPhase("connected");
          setSessionId(null);
          qc.invalidateQueries({ queryKey: githubKeys.status });
        } else if (data.status === "failed") {
          setPhase("failed");
          setError(data.error || "GitHub CLI sign-in failed.");
          setSessionId(null);
        }
        return data;
      } catch (e) {
        // 404 = session expired/unknown; any other error is a transport issue.
        setPhase("failed");
        setError(
          e instanceof Error ? e.message : "Lost the sign-in session.",
        );
        setSessionId(null);
        return null;
      }
    },
    enabled: !!sessionId && phase === "pending",
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  const reset = () => {
    setSessionId(null);
    setUserCode(null);
    setVerificationUri(null);
    setPhase("idle");
    setError(null);
  };

  const cancel = () => {
    if (sessionId) cancelMutation.mutate(sessionId);
    reset();
  };

  // Best-effort cleanup if the consumer unmounts while a session is open.
  useEffect(() => {
    return () => {
      if (sessionId) {
        cancelMutation.mutate(sessionId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return {
    phase,
    userCode,
    verificationUri,
    error,
    isStarting: startMutation.isPending,
    isCancelling: cancelMutation.isPending,
    start: () => startMutation.mutate(),
    cancel,
    reset,
  };
}
