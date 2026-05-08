"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API, XO_COWORK_API_BASE } from "@/lib/constants";

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
  folders: (name: string) => ["gdrive", "folders", name] as const,
};

export interface GDriveFolder {
  name: string;
  modified: string | null;
}

export interface GDriveFoldersResponse {
  folders: GDriveFolder[];
}

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
    mutationFn: ({ name, force }: { name: string; force?: boolean }) =>
      api.post<{ session_id: string; status: string }>(API.GDRIVE.CREATE, { name, force }),
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

/** Create a folder on a remote via `rclone mkdir <name>:<path>`. */
export function useGDriveMkdir() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, path }: { name: string; path: string }) =>
      api.post<{ ok: boolean; path: string }>(API.GDRIVE.MKDIR(name), { path }),
    onSuccess: (_data, { name }) => {
      qc.invalidateQueries({ queryKey: gdriveKeys.folders(name) });
    },
  });
}

/**
 * Upload a single file to a remote via `rclone rcat`. Streams the File body
 * straight to the backend (raw octet-stream); cannot use the JSON-encoding
 * `api.post` wrapper. Invalidates the folder list on success so any future
 * file-listing extension stays consistent.
 *
 * Note: bypasses the Next.js dev rewrite when `NEXT_PUBLIC_XO_COWORK_API_URL`
 * is set, hitting FastAPI directly. The Next.js rewrite proxy doesn't cleanly
 * stream large request bodies (the upstream raises ClientDisconnect once the
 * proxy buffer flushes early), so direct-to-backend is the reliable path.
 */
export function useGDriveUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      name,
      path,
      file,
    }: {
      name: string;
      path: string;
      file: File;
    }): Promise<{ ok: true; path: string; size: number | null }> => {
      const apiPath =
        `${API.GDRIVE.UPLOAD(name)}` +
        `?path=${encodeURIComponent(path)}` +
        `&filename=${encodeURIComponent(file.name)}`;
      // If an explicit backend URL is configured (recommended for any non-localhost
      // setup, e.g. Coder remote), bypass the Next.js rewrite which mangles streams.
      const url = XO_COWORK_API_BASE ? `${XO_COWORK_API_BASE}${apiPath}` : apiPath;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      if (!res.ok) {
        let detail = res.statusText || `Upload failed (${res.status})`;
        try {
          const j = await res.json();
          if (typeof j?.detail === "string") detail = j.detail;
        } catch {
          // body wasn't JSON; keep statusText fallback
        }
        throw new Error(detail);
      }
      return res.json();
    },
    onSuccess: (_data, { name }) => {
      qc.invalidateQueries({ queryKey: gdriveKeys.folders(name) });
    },
  });
}

/** Delete a folder on a remote via `rclone purge <name>:<path>`. */
export function useGDriveRmdir() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, path }: { name: string; path: string }) =>
      api.post<{ ok: boolean; path: string }>(API.GDRIVE.RMDIR(name), { path }),
    onSuccess: (_data, { name }) => {
      qc.invalidateQueries({ queryKey: gdriveKeys.folders(name) });
    },
  });
}

/** List folders visible to rclone on a remote. Enabled only when name is set. */
export function useGDriveFolders(name: string | null, enabled = true) {
  return useQuery({
    queryKey: gdriveKeys.folders(name ?? ""),
    queryFn: () => api.get<GDriveFoldersResponse>(API.GDRIVE.FOLDERS(name!)),
    enabled: !!name && enabled,
    staleTime: 15_000,
    retry: false,
  });
}
