"use client";

import { useParams, useSearchParams } from "next/navigation";
import { resolveAgentId } from "@/lib/routes";

export function useActiveAgentId() {
  const params = useParams();
  const searchParams = useSearchParams();
  return resolveAgentId(
    typeof params.agentId === "string" ? params.agentId : null,
    searchParams.get("agentId"),
  );
}
