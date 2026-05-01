"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";

export interface OnboardingStatus {
  completed: boolean;
  completed_at: string | null;
}

/** Source-of-truth onboarding flag, persisted on the user's machine. */
export function useOnboardingStatus() {
  return useQuery({
    queryKey: queryKeys.onboardingStatus,
    queryFn: () => api.get<OnboardingStatus>(API.ONBOARDING.STATUS),
    staleTime: Infinity,
  });
}

export function useCompleteOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean }>(API.ONBOARDING.COMPLETE),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.onboardingStatus });
    },
  });
}
