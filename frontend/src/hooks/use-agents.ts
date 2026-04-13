"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import type { AgentInfo, CreateAgentRequest } from "@/types/agent";

export function useAgents() {
  return useQuery({
    queryKey: queryKeys.agents,
    queryFn: () => api.get<AgentInfo[]>(API.AGENTS),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateAgentRequest) => api.post<AgentInfo>(API.AGENTS, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents });
    },
  });
}
