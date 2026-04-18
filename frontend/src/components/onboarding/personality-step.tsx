"use client";

import { useState, useEffect, useMemo } from "react";
import { ArrowRight, Loader2, RotateCcw, AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  PERSONALITY_FILES,
  PERSONALITY_DEFAULTS,
  type PersonalityFileKey,
} from "@/lib/personality-defaults";
import {
  usePersonalityFiles,
  useSavePersonalityFiles,
  personalityQueryKey,
  type PersonalityContent,
} from "@/hooks/use-personality-files";

interface PersonalityStepProps {
  /** Current edit state. Lives in OnboardingScreen so Back→Continue preserves edits. */
  content: PersonalityContent | null;
  /** Called with the disk-loaded content on first successful fetch. */
  onInitialLoad: (content: PersonalityContent) => void;
  /** Called on every keystroke / reset. */
  onChange: (content: PersonalityContent) => void;
  /** Called after all four files save successfully. */
  onNext: () => void;
}

export function PersonalityStep({
  content,
  onInitialLoad,
  onChange,
  onNext,
}: PersonalityStepProps) {
  const queryClient = useQueryClient();
  const { data: loadedContent, isPending, error, refetch } = usePersonalityFiles();
  const saveMutation = useSavePersonalityFiles();

  const [activeTab, setActiveTab] = useState<PersonalityFileKey>("agents");

  // Seed the hoisted state on first successful load.
  useEffect(() => {
    if (loadedContent && !content) onInitialLoad(loadedContent);
  }, [loadedContent, content, onInitialLoad]);

  const baseline = loadedContent ?? null;

  const isDirty = useMemo(() => {
    if (!content || !baseline) return {} as Record<PersonalityFileKey, boolean>;
    return Object.fromEntries(
      PERSONALITY_FILES.map((f) => [f.key, content[f.key] !== baseline[f.key]]),
    ) as Record<PersonalityFileKey, boolean>;
  }, [content, baseline]);

  // Loading
  if (isPending || !content) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
        <p className="mt-3 text-xs text-[var(--text-tertiary)]">
          Reading agent files…
        </p>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="flex flex-col">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-1">
          Shape your agent
        </h2>
        <div className="mt-4 rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-[var(--color-destructive)]" />
            <div className="flex-1">
              <p className="text-sm text-[var(--text-primary)]">
                Couldn&apos;t read the agent files.
              </p>
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                {error instanceof Error ? error.message : "Unknown error"}
              </p>
              <button
                onClick={() => refetch()}
                className="mt-2 text-xs font-medium text-[var(--color-primary)] hover:underline"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const activeDef = PERSONALITY_FILES.find((f) => f.key === activeTab)!;
  const activeValue = content[activeTab];
  const activeDefault = PERSONALITY_DEFAULTS[activeTab];
  const canReset = activeValue !== activeDefault;

  const handleTextareaChange = (value: string) => {
    onChange({ ...content, [activeTab]: value });
  };

  const handleReset = () => {
    onChange({ ...content, [activeTab]: activeDefault });
  };

  const handleContinue = async () => {
    try {
      await saveMutation.mutateAsync(content);
      queryClient.invalidateQueries({ queryKey: personalityQueryKey });
      onNext();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      toast.error(`Couldn't save agent files: ${msg}`);
    }
  };

  return (
    <div className="flex flex-col">
      <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-1">
        Shape your agent
      </h2>
      <p className="text-sm text-[var(--text-secondary)] mb-4">
        Four files define your agent&apos;s identity, voice, workspace rules,
        and what it knows about you. Tweak them now or leave the defaults —
        you can revisit anytime.
      </p>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-[var(--surface-primary)] border border-[var(--border-default)] mb-3">
        {PERSONALITY_FILES.map((f) => {
          const dirty = isDirty[f.key];
          const active = activeTab === f.key;
          return (
            <button
              key={f.key}
              onClick={() => setActiveTab(f.key)}
              className={`relative flex-1 text-xs py-1.5 rounded-md font-medium transition-all ${
                active
                  ? "bg-[var(--surface-secondary)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                {f.tabLabel}
                {dirty && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]"
                    aria-label="unsaved changes"
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Caption */}
      <p className="text-xs text-[var(--text-tertiary)] mb-2">
        {activeDef.caption}{" "}
        <span className="font-mono text-[10px] text-[var(--text-tertiary)]/70">
          {activeDef.filename}
        </span>
      </p>

      {/* Editor */}
      <textarea
        value={activeValue}
        onChange={(e) => handleTextareaChange(e.target.value)}
        spellCheck={false}
        className="w-full h-72 resize-none rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40 focus:border-[var(--color-primary)]"
      />

      {/* Reset row */}
      <div className="mt-2 flex justify-end">
        <button
          onClick={handleReset}
          disabled={!canReset}
          className="inline-flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          Reset to default
        </button>
      </div>

      <Button
        className="w-full mt-5"
        onClick={handleContinue}
        disabled={saveMutation.isPending}
      >
        {saveMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            Continue <ArrowRight className="ml-2 h-4 w-4" />
          </>
        )}
      </Button>
    </div>
  );
}
