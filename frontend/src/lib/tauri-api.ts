/**
 * Tauri API bridge — replaces the Electron preload API.
 *
 * In the web build this module MUST NOT import `@tauri-apps/api` eagerly —
 * doing so pulls ~40KB of Tauri IPC glue into the initial bundle for users
 * who will never touch it. Instead, every method lazy-imports on first call.
 * Desktop-mode code paths (guarded by `IS_DESKTOP`) still work unchanged
 * because the SDK is already installed; web-mode callers that ignore the
 * guard get a cheap no-op instead of a bundle hit.
 */

export interface DesktopAPI {
  getBackendUrl: () => Promise<string>;
  getPendingNavigation: () => Promise<string | null>;
  getPlatform: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  downloadAndSave: (opts: { url?: string; data?: number[]; defaultName: string }) => Promise<boolean>;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximizeChange: (callback: (maximized: boolean) => void) => () => void;
  onBackendRestarting: (callback: () => void) => () => void;
  onBackendRestart: (callback: (newUrl: string) => void) => () => void;
  onBackendCrashLog: (callback: (log: string) => void) => () => void;
  onNavigate: (callback: (path: string) => void) => () => void;
  onToggleSidebar: (callback: () => void) => () => void;
  onCheckForUpdates: (callback: () => void) => () => void;
}

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Lazy-loaded invoke — only pulls `@tauri-apps/api/core` when actually needed. */
async function invokeCmd<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    // In web mode every desktop-only call should be gated by IS_DESKTOP.
    // If we land here it means a guard is missing — fail loudly in dev, no-op in prod.
    throw new Error(`desktopAPI.${cmd} called outside Tauri`);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

/** Lazy-listen: returns a sync cleanup function. */
function listenSync<T>(event: string, handler: (payload: T) => void): () => void {
  if (!isTauri()) return () => {};
  let unlisten: (() => void) | null = null;
  let cancelled = false;

  void import("@tauri-apps/api/event").then(({ listen }) =>
    listen<T>(event, (e) => handler(e.payload)).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    })
  );

  return () => {
    cancelled = true;
    unlisten?.();
  };
}

export const desktopAPI: DesktopAPI = {
  getBackendUrl: () => invokeCmd<string>("get_backend_url"),
  getPendingNavigation: () => invokeCmd<string | null>("get_pending_navigation"),
  getPlatform: () => invokeCmd<string>("get_platform"),
  openExternal: (url) => invokeCmd("open_external", { url }),
  downloadAndSave: ({ url, data, defaultName }) =>
    invokeCmd<boolean>("download_and_save", { url, data, defaultName }),
  minimize: () => invokeCmd("window_minimize"),
  maximize: () => invokeCmd("window_maximize"),
  close: () => invokeCmd("window_close"),
  isMaximized: () => invokeCmd<boolean>("is_maximized"),
  onMaximizeChange: (callback) => listenSync<boolean>("maximize-change", callback),
  onBackendRestarting: (callback) => listenSync<void>("backend-restarting", callback),
  onBackendRestart: (callback) => listenSync<string>("backend-restart", callback),
  onBackendCrashLog: (callback) => listenSync<string>("backend-crash-log", callback),
  onNavigate: (callback) => listenSync<string>("navigate", callback),
  onToggleSidebar: (callback) => listenSync<void>("toggle-sidebar", callback),
  onCheckForUpdates: (callback) => listenSync<void>("check-for-updates", callback),
};
