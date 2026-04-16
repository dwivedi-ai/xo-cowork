"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useSettingsStore, useSettingsHasHydrated } from "@/stores/settings-store";

/**
 * Lazy-load the onboarding flow so it ships only when this route is visited.
 * ssr: false — the component reads from a localStorage-backed store and
 * renders a fullscreen overlay that has no SSR-friendly counterpart.
 */
const OnboardingScreen = dynamic(
  () => import("@/components/onboarding/onboarding-screen").then((m) => m.OnboardingScreen),
  { ssr: false },
);

export default function OnboardPage() {
  const router = useRouter();
  const hydrated = useSettingsHasHydrated();
  const hasCompletedOnboarding = useSettingsStore((s) => s.hasCompletedOnboarding);

  useEffect(() => {
    if (!hydrated) return;
    if (hasCompletedOnboarding) router.replace("/c/new");
  }, [hydrated, hasCompletedOnboarding, router]);

  if (!hydrated || hasCompletedOnboarding) return null;
  return <OnboardingScreen />;
}
