"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { API } from "@/lib/constants";
import {
  PERSONALITY_FILES,
  PERSONALITY_DEFAULTS,
  personalityFilePath,
  type PersonalityFileKey,
} from "@/lib/personality-defaults";

export type PersonalityContent = Record<PersonalityFileKey, string>;

/**
 * Reads all four personality files from disk. Missing files (404) fall
 * back to the built-in default template, so a fresh install still renders.
 * Any other error is surfaced so the UI can show a retry card.
 */
async function loadPersonalityFiles(): Promise<PersonalityContent> {
  const entries = await Promise.all(
    PERSONALITY_FILES.map(async (f) => {
      try {
        const res = await api.post<{ content: string }>(API.FILES.CONTENT, {
          path: personalityFilePath(f.filename),
        });
        return [f.key, res.content] as const;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          return [f.key, PERSONALITY_DEFAULTS[f.key]] as const;
        }
        throw err;
      }
    }),
  );
  return Object.fromEntries(entries) as PersonalityContent;
}

/** Sequential saves — tiny files, easier error attribution. */
async function savePersonalityFiles(content: PersonalityContent): Promise<void> {
  for (const f of PERSONALITY_FILES) {
    await api.post(API.FILES.SAVE, {
      path: personalityFilePath(f.filename),
      content: content[f.key],
    });
  }
}

export const personalityQueryKey = ["personality-files"] as const;

export function usePersonalityFiles() {
  return useQuery({
    queryKey: personalityQueryKey,
    queryFn: loadPersonalityFiles,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useSavePersonalityFiles() {
  return useMutation({
    mutationFn: savePersonalityFiles,
  });
}
