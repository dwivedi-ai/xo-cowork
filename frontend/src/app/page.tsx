"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useAppRouter } from "@/lib/navigation";
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
  const router = useAppRouter();
  const hydrated = useSettingsHasHydrated();
  const cachedCompleted = useSettingsStore((s) => s.hasCompletedOnboarding);
  const { data: serverStatus, isLoading } = useOnboardingStatus();
  const navigatedRef = useRef(false);

  useEffect(() => {
    if (navigatedRef.current) return;
    if (!hydrated) return;
    if (cachedCompleted) {
      navigatedRef.current = true;
      router.replace("/c/new");
      return;
    }
    if (isLoading) return;
    navigatedRef.current = true;
    router.replace(serverStatus?.completed ? "/c/new" : "/onboard");
  }, [hydrated, cachedCompleted, isLoading, serverStatus?.completed, router]);

  // Hard fallback for embedded browsers (e.g. VSCode Simple Browser) where
  // localStorage / hydration / router.replace can stall and leave the user
  // staring at an empty page. After 3s, force-navigate via the platform API.
  useEffect(() => {
    const t = setTimeout(() => {
      if (navigatedRef.current) return;
      if (typeof window === "undefined") return;
      if (window.location.pathname !== "/") return;
      const dest =
        cachedCompleted || serverStatus?.completed ? "/c/new" : "/onboard";
      window.location.replace(dest);
    }, 3000);
    return () => clearTimeout(t);
  }, [cachedCompleted, serverStatus?.completed]);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--surface-primary)]">
      <Loader2 className="h-6 w-6 animate-spin text-[var(--text-tertiary)]" />
    </div>
  );
}
