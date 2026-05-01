"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSettingsStore, useSettingsHasHydrated } from "@/stores/settings-store";
import { useOnboardingStatus } from "@/hooks/use-onboarding";

/**
 * Redirects first-time users to `/onboard`. Renders nothing.
 *
 * Source of truth is the server (`GET /api/onboarding`) — persisted at
 * `~/.xo-cowork/state.json`, so onboarding does not re-trigger in a new
 * browser, incognito window, or after a localStorage clear.
 *
 * The zustand `hasCompletedOnboarding` flag (in localStorage) is kept
 * only as a fast path: when present, we skip the redirect without
 * waiting for the API. When absent, we wait for the API before deciding
 * — this is what prevents an already-onboarded user with a fresh
 * browser from being briefly bounced to `/onboard`.
 */
export function OnboardingGate() {
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useSettingsHasHydrated();
  const cachedCompleted = useSettingsStore((s) => s.hasCompletedOnboarding);
  const { data: serverStatus, isLoading } = useOnboardingStatus();

  useEffect(() => {
    if (!hydrated) return;
    if (pathname === "/onboard") return;
    if (cachedCompleted) return;
    if (isLoading) return;
    if (serverStatus?.completed) return;
    router.replace("/onboard");
  }, [hydrated, cachedCompleted, isLoading, serverStatus?.completed, pathname, router]);

  return null;
}
