/** Lightweight fetch wrapper for the XO-Cowork backend API. */

import {
  appendPreservedParams,
  getBackendUrl,
  getCoderSessionToken,
  IS_DESKTOP,
  resolveApiUrl,
} from "./constants";
import { getRemoteConfig } from "./remote-connection";
import i18n from "@/i18n/config";

class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: unknown,
  ) {
    super(ApiError.formatMessage(status, statusText, body));
    this.name = "ApiError";
  }

  private static formatMessage(
    status: number,
    statusText: string,
    body: unknown,
  ): string {
    // FastAPI puts validation/business errors in `detail`. Surface them so
    // users see "Name must be 1-32 chars…" instead of a useless "API 400:".
    let detail: string | undefined;
    if (body && typeof body === "object") {
      const d = (body as { detail?: unknown }).detail;
      if (typeof d === "string") detail = d;
      else if (Array.isArray(d) && d.length > 0) {
        const first = d[0];
        if (first && typeof first === "object" && typeof (first as { msg?: unknown }).msg === "string") {
          detail = (first as { msg: string }).msg;
        }
      } else if (d && typeof d === "object" && typeof (d as { error?: unknown }).error === "string") {
        detail = (d as { error: string }).error;
      }
    } else if (typeof body === "string" && body.trim()) {
      detail = body.trim();
    }
    if (detail) return detail;
    return statusText ? `API ${status}: ${statusText}` : `API ${status}`;
  }
}

/** Max retries for network errors (connection refused/reset during backend restart). */
const NETWORK_RETRY_MAX = 3;

async function request<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  // Remote mode: use tunnel URL + inject Bearer token
  const remoteConfig = getRemoteConfig();

  let resolvedUrl: string;
  if (remoteConfig) {
    resolvedUrl = url.startsWith("http") ? url : `${remoteConfig.url}${url}`;
  } else if (IS_DESKTOP) {
    const backend = await getBackendUrl();
    resolvedUrl = url.startsWith("http") ? url : `${backend}${url}`;
  } else {
    resolvedUrl = resolveApiUrl(url);
  }
  resolvedUrl = appendPreservedParams(resolvedUrl);

  let lastError: unknown;

  // Build auth headers for remote mode + Coder tunnel
  const authHeaders: Record<string, string> = {};
  if (remoteConfig) {
    authHeaders["Authorization"] = `Bearer ${remoteConfig.token}`;
  }
  const coderToken = getCoderSessionToken();
  if (coderToken) {
    authHeaders["Coder-Session-Token"] = coderToken;
  }

  for (let attempt = 0; attempt <= NETWORK_RETRY_MAX; attempt++) {
    try {
      const res = await fetch(resolvedUrl, {
        headers: {
          "Content-Type": "application/json",
          "Accept-Language": i18n.language || "en",
          ...authHeaders,
          ...options?.headers,
        },
        ...options,
      });

      if (!res.ok) {
        const raw = await res.text();
        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
        throw new ApiError(res.status, res.statusText, body);
      }

      // Handle 204 No Content
      if (res.status === 204) return undefined as T;

      return res.json() as Promise<T>;
    } catch (err) {
      // Only retry network errors (TypeError = connection refused/reset/failed).
      // Do NOT retry HTTP errors (ApiError) — those are business-level errors.
      if (err instanceof TypeError && attempt < NETWORK_RETRY_MAX) {
        lastError = err;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        // Re-resolve URL in case backend restarted on a new port
        // (Remote mode: URL is stable via tunnel, no re-resolve needed)
        if (!remoteConfig && IS_DESKTOP) {
          const backend = await getBackendUrl();
          resolvedUrl = url.startsWith("http") ? url : `${backend}${url}`;
          resolvedUrl = appendPreservedParams(resolvedUrl);
        }
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

export const api = {
  get: <T>(url: string) => request<T>(url),

  post: <T>(url: string, data?: unknown) =>
    request<T>(url, {
      method: "POST",
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: <T>(url: string, data: unknown) =>
    request<T>(url, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  patch: <T>(url: string, data: unknown) =>
    request<T>(url, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: <T>(url: string) =>
    request<T>(url, { method: "DELETE" }),

  deleteWithBody: <T>(url: string, data: unknown) =>
    request<T>(url, {
      method: "DELETE",
      body: JSON.stringify(data),
    }),
};

export { ApiError };
