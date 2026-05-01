"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSettingsStore, useSettingsHasHydrated } from "@/stores/settings-store";
import { useOnboardingStatus } from "@/hooks/use-onboarding";

/**
 * Root redirect. Sends first-run users straight to `/onboard` instead of
 * bouncing them through `/c/new` first (which `OnboardingGate` would
 * then redirect again — visible as a brief flash).
 *
 * Decision logic mirrors `OnboardingGate`: localStorage flag is the
 * fast path; the API at `/api/onboarding` is the source of truth.
 */
export default function Home() {
  const router = useRouter();
  const hydrated = useSettingsHasHydrated();
  const cachedCompleted = useSettingsStore((s) => s.hasCompletedOnboarding);
  const { data: serverStatus, isLoading } = useOnboardingStatus();

  useEffect(() => {
    if (!hydrated) return;
    if (cachedCompleted) {
      router.replace("/c/new");
      return;
    }
    if (isLoading) return;
    router.replace(serverStatus?.completed ? "/c/new" : "/onboard");
  }, [hydrated, cachedCompleted, isLoading, serverStatus?.completed, router]);

  return null;
}
