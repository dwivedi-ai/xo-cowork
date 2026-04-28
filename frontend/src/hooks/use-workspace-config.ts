import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";
import { useSettingsStore } from "@/stores/settings-store";

interface WorkspaceConfigResponse {
  roots: Record<string, string>;
  default: string;
}

const FALLBACKS: Record<string, string> = {
  claude_code: "/home/coder/claude-cowork",
  openclaw: "/home/coder/.openclaw/workspace",
};

export function useWorkspaceConfig() {
  const { data } = useQuery<WorkspaceConfigResponse>({
    queryKey: ["workspace-config"],
    queryFn: () => api.get<WorkspaceConfigResponse>(API.CONFIG.WORKSPACE),
    staleTime: Infinity,
  });

  const agentName = useSettingsStore((s) => s.agentName);

  // Active backend: explicit agent-name setting beats server default.
  const backend = agentName ?? data?.default ?? "openclaw";
  const workspaceRoot =
    data?.roots[backend] ?? FALLBACKS[backend] ?? FALLBACKS.openclaw;

  return { workspaceRoot, backend, roots: data?.roots ?? FALLBACKS };
}
