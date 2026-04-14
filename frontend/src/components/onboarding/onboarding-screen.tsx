"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatedXoCoworkLogo } from "@/components/layout/splash-screen";
import { useSettingsStore } from "@/stores/settings-store";

export function OnboardingScreen() {
  const router = useRouter();
  const completeOnboarding = useSettingsStore((s) => s.completeOnboarding);

  const handleSetupProviders = () => {
    completeOnboarding();
    router.push("/settings?tab=providers");
  };

  const handleSkip = () => {
    completeOnboarding();
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-[var(--surface-primary)]">
      <motion.div
        className="w-full max-w-sm px-6"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <div className="flex flex-col items-center text-center">
          <AnimatedXoCoworkLogo size={80} />

          <h1 className="mt-8 text-2xl font-semibold text-[var(--text-primary)] tracking-tight">
            Welcome to XO Cowork
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)] max-w-xs">
            Your local AI assistant — private, powerful, personal.
          </p>
          <p className="mt-1 text-xs text-[var(--text-tertiary)] max-w-xs">
            Add an API key or configure a local model to get started.
          </p>

          <div className="mt-10 w-full space-y-3">
            <Button
              className="w-full"
              onClick={handleSetupProviders}
            >
              <Key className="mr-2 h-4 w-4" />
              Set Up Providers
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>

          <button
            onClick={handleSkip}
            className="mt-8 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          >
            Skip for now
          </button>
        </div>
      </motion.div>
    </div>
  );
}
