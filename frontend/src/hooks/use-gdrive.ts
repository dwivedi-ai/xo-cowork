"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GDriveRemote {
  name: string;
  type: "drive";
  scope: string;
  /** false if the OAuth token is missing (partial/stale setup) */
  complete: boolean;
}

export interface GDriveRemotesResponse {
  remotes: GDriveRemote[];
}

export type GDriveSessionStatus =
  | "pending"
  | "awaiting_oauth"
  | "completed"
  | "failed"
  | "cancelled";

export interface GDriveSessionResponse {
  status: GDriveSessionStatus;
  auth_url?: string;
  needs_manual_code?: boolean;
  remote_name?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const gdriveKeys = {
  remotes: ["gdrive", "remotes"] as const,
  session: (id: string) => ["gdrive", "session", id] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** List all configured Google Drive remotes. */
export function useGDriveRemotes() {
  return useQuery({
    queryKey: gdriveKeys.remotes,
    queryFn: () => api.get<GDriveRemotesResponse>(API.GDRIVE.REMOTES),
    staleTime: 30_000,
    retry: false,
  });
}

/** Start a new OAuth flow session. Returns { session_id, status }. */
export function useGDriveCreateRemote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.post<{ session_id: string; status: string }>(API.GDRIVE.CREATE, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: gdriveKeys.remotes });
    },
  });
}

/** Poll a session for status updates. Enabled only when sessionId is set. */
export function useGDriveSession(sessionId: string | null) {
  return useQuery({
    queryKey: gdriveKeys.session(sessionId ?? ""),
    queryFn: () =>
      api.get<GDriveSessionResponse>(API.GDRIVE.SESSION(sessionId!)),
    enabled: !!sessionId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      // Stop polling when terminal state is reached
      if (status === "completed" || status === "failed" || status === "cancelled") {
        return false;
      }
      return 1500;
    },
    retry: false,
    staleTime: 0,
  });
}

/** Delete a Google Drive remote. */
export function useGDriveDeleteRemote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.delete<void>(API.GDRIVE.REMOTE(name)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: gdriveKeys.remotes });
    },
  });
}

/** Cancel an in-progress OAuth session. */
export function useGDriveCancelSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ ok: boolean }>(API.GDRIVE.CANCEL_SESSION(sessionId)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: gdriveKeys.remotes });
    },
  });
}

/** Submit the pasted redirect URL or verification code to complete OAuth. */
export function useGDriveSubmitCode() {
  return useMutation({
    mutationFn: ({ sessionId, code }: { sessionId: string; code: string }) =>
      api.post<{ ok: boolean }>(API.GDRIVE.SUBMIT_CODE(sessionId), { code }),
  });
}
