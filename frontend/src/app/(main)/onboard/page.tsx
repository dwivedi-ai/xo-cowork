"use client";

import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";

export default function OnboardPage() {
  useEffect(() => {
    // Reset so the onboarding overlay renders (handled by the layout)
    useSettingsStore.setState({ hasCompletedOnboarding: false });
  }, []);

  // The layout renders <OnboardingScreen /> whenever hasCompletedOnboarding is false
  return null;
}
