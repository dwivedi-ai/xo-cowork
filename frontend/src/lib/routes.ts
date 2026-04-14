const IS_DESKTOP_BUILD = process.env.NEXT_PUBLIC_DESKTOP_BUILD === "true";

export function getChatRoute(sessionId?: string | null): string {
  if (!sessionId) return "/c/new";
  return IS_DESKTOP_BUILD
    ? `/c/_?sessionId=${encodeURIComponent(sessionId)}`
    : `/c/${sessionId}`;
}

export function resolveSessionId(
  pathSessionId?: string | null,
  querySessionId?: string | null,
): string | null {
  if (!pathSessionId) return querySessionId ?? null;
  if (pathSessionId === "_") return querySessionId ?? null;
  return pathSessionId;
}

export function getAgentRoute(agentId: string): string {
  return IS_DESKTOP_BUILD
    ? `/agents/_?agentId=${encodeURIComponent(agentId)}`
    : `/agents/${agentId}`;
}

export function resolveAgentId(
  pathAgentId?: string | null,
  queryAgentId?: string | null,
): string | null {
  if (!pathAgentId) return queryAgentId ?? null;
  if (pathAgentId === "_") return queryAgentId ?? null;
  return pathAgentId;
}
