import { Suspense } from "react";
import { AgentPageClient } from "./agent-page-client";

export async function generateStaticParams() {
  return [{ agentId: "_" }];
}

export default async function AgentPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  return (
    <Suspense fallback={null}>
      <AgentPageClient agentId={agentId} />
    </Suspense>
  );
}
