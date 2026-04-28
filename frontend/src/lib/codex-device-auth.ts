/**
 * Client for POST /codex/setup on xo-cowork-api.
 *
 * The endpoint runs `codex login --device-auth` under a PTY and streams its
 * output as Server-Sent Events. We parse the stdout lines to extract the
 * verification URL and the one-time user code that the CLI prints, so the UI
 * can show them directly instead of asking the user to paste anything back.
 */

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
const URL_RE = /https?:\/\/[^\s]+/;
const CODE_RE = /\b[A-Z0-9]{3,5}-[A-Z0-9]{3,6}\b/;
const URL_MARKER = /open\s+this\s+link/i;
const CODE_MARKER = /enter\s+this\s+one-?time\s+code/i;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export interface CodexSetupHandlers {
  onInstalling?: (pkg: string) => void;
  onInstallLog?: (line: string) => void;
  onStdout?: (line: string) => void;
  onUrl?: (url: string) => void;
  onCode?: (code: string) => void;
  onDone: (returncode: number) => void;
  onError: (message: string) => void;
}

/**
 * Consume the SSE stream from POST /codex/setup, dispatch structured events.
 * Returns when the stream closes or a terminal event is emitted.
 */
export async function consumeCodexSetupStream(
  body: ReadableStream<Uint8Array>,
  handlers: CodexSetupHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Tracks which "next line to extract" we are expecting from the CLI prose.
  let expecting: "url" | "code" | null = null;

  const handleStdout = (rawLine: string) => {
    handlers.onStdout?.(rawLine);
    const line = stripAnsi(rawLine).trim();
    if (!line) return;

    // If the previous line was a marker, try to pull the value from this line.
    if (expecting === "url") {
      const m = line.match(URL_RE);
      if (m) {
        handlers.onUrl?.(m[0]);
        expecting = null;
        return;
      }
    }
    if (expecting === "code") {
      const m = line.match(CODE_RE);
      if (m) {
        handlers.onCode?.(m[0]);
        expecting = null;
        return;
      }
    }

    // Marker detection — value shows up on the following line.
    if (URL_MARKER.test(line)) {
      expecting = "url";
      return;
    }
    if (CODE_MARKER.test(line)) {
      expecting = "code";
      return;
    }

    // Fallback: if a URL or code appears on an unexpected line (format drift),
    // still surface it — but only once each, so we don't clobber a good match.
    const urlFallback = line.match(URL_RE);
    if (urlFallback && expecting === null) handlers.onUrl?.(urlFallback[0]);
    const codeFallback = line.match(CODE_RE);
    if (codeFallback && expecting === null) handlers.onCode?.(codeFallback[0]);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const raw of lines) {
        if (!raw.startsWith("data: ")) continue;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(raw.slice(6));
        } catch {
          continue;
        }
        const type = data.type as string | undefined;
        switch (type) {
          case "installing":
            handlers.onInstalling?.(String(data.package ?? "@openai/codex"));
            break;
          case "install_log":
            handlers.onInstallLog?.(String(data.line ?? ""));
            break;
          case "stdout":
            handleStdout(String(data.line ?? ""));
            break;
          case "stderr":
            // Surface stderr as a log line — useful if something goes wrong
            // mid-flow, but not fatal on its own.
            handlers.onStdout?.(String(data.line ?? ""));
            break;
          case "done":
            handlers.onDone(Number(data.returncode ?? 0));
            return;
          case "error":
            handlers.onError(String(data.error ?? "Codex setup error"));
            return;
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }
}
