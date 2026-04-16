"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSettingsStore, useSettingsHasHydrated } from "@/stores/settings-store";

/**
 * Redirects first-time users to `/onboard`. Renders nothing; side-effect only.
 *
 * The settings store persists through zustand/persist (localStorage), so we
 * must wait for hydration before reading `hasCompletedOnboarding` — otherwise
 * an already-onboarded user would briefly see the default `false` and get
 * bounced. `/onboard` itself is allowed even when the flag is false.
 */
export function OnboardingGate() {
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useSettingsHasHydrated();
  const hasCompletedOnboarding = useSettingsStore((s) => s.hasCompletedOnboarding);

  useEffect(() => {
    if (!hydrated) return;
    if (hasCompletedOnboarding) return;
    if (pathname === "/onboard") return;
    router.replace("/onboard");
  }, [hydrated, hasCompletedOnboarding, pathname, router]);

  return null;
}
