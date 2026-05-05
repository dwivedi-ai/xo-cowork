"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OneDriveRemote {
  name: string;
  type: "onedrive";
  /** "personal" | "business" | "documentLibrary" — surfaced from rclone.conf */
  drive_type: string;
  region: string;
  /** false if the OAuth token or drive_id is missing (partial/stale setup) */
  complete: boolean;
}

export interface OneDriveRemotesResponse {
  remotes: OneDriveRemote[];
}

export type OneDriveSessionStatus =
  | "pending"
  | "awaiting_oauth"
  | "completed"
  | "failed"
  | "cancelled";

export interface OneDriveSessionResponse {
  status: OneDriveSessionStatus;
  auth_url?: string;
  needs_manual_code?: boolean;
  remote_name?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const onedriveKeys = {
  remotes: ["onedrive", "remotes"] as const,
  session: (id: string) => ["onedrive", "session", id] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** List all configured OneDrive remotes. */
export function useOneDriveRemotes() {
  return useQuery({
    queryKey: onedriveKeys.remotes,
    queryFn: () => api.get<OneDriveRemotesResponse>(API.ONEDRIVE.REMOTES),
    staleTime: 30_000,
    retry: false,
  });
}

/** Start a new OAuth flow session. Returns { session_id, status }. */
export function useOneDriveCreateRemote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, force }: { name: string; force?: boolean }) =>
      api.post<{ session_id: string; status: string }>(API.ONEDRIVE.CREATE, { name, force }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: onedriveKeys.remotes });
    },
  });
}

/** Poll a session for status updates. Enabled only when sessionId is set. */
export function useOneDriveSession(sessionId: string | null) {
  return useQuery({
    queryKey: onedriveKeys.session(sessionId ?? ""),
    queryFn: () =>
      api.get<OneDriveSessionResponse>(API.ONEDRIVE.SESSION(sessionId!)),
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

/** Delete a OneDrive remote. */
export function useOneDriveDeleteRemote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.delete<void>(API.ONEDRIVE.REMOTE(name)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: onedriveKeys.remotes });
    },
  });
}

/** Cancel an in-progress OAuth session. */
export function useOneDriveCancelSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api.post<{ ok: boolean }>(API.ONEDRIVE.CANCEL_SESSION(sessionId)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: onedriveKeys.remotes });
    },
  });
}

/** Submit the pasted redirect URL or verification code to complete OAuth. */
export function useOneDriveSubmitCode() {
  return useMutation({
    mutationFn: ({ sessionId, code }: { sessionId: string; code: string }) =>
      api.post<{ ok: boolean }>(API.ONEDRIVE.SUBMIT_CODE(sessionId), { code }),
  });
}
