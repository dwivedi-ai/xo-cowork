"use client";

import { AgentDetailPage } from "@/components/agents/agent-detail-page";
import { useActiveAgentId } from "@/hooks/use-active-agent-id";

export function AgentPageClient(_props: { agentId: string }) {
  const agentId = useActiveAgentId();

  if (!agentId) return null;

  return <AgentDetailPage agentId={agentId} />;
}
