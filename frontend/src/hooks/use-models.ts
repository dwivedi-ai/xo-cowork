"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import type { ModelInfo } from "@/types/model";

export function useModels() {
  return useQuery({
    queryKey: queryKeys.models,
    queryFn: () => api.get<ModelInfo[]>(API.MODELS),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
