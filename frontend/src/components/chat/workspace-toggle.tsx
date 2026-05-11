"use client";

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen, ChevronDown, Monitor } from "lucide-react";
import { Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSettingsStore } from "@/stores/settings-store";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useWorkspaceConfig } from "@/hooks/use-workspace-config";

interface WorkspaceToggleProps {
  /** When provided, workspace changes are persisted to this session via PATCH. */
  sessionId?: string;
  /** The session's current directory (used when sessionId is provided). */
  directory?: string | null;
  /** Whether the workspace is currently being indexed. Shows spinner when true. */
  isIndexing?: boolean;
}

interface DirEntry {
  name: string;
  path: string;
}

interface ProjectItem {
  id: string;
  display_name: string;
  description: string | null;
  created_at: string | null;
  unscaffolded: boolean;
}

interface ListProjectsResponse {
  items: ProjectItem[];
  total: number;
}

function getDisplayName(path: string | null | undefined, workspaceRoot: string): string | null {
  if (!path || path === "." || path === workspaceRoot) return null;
  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || null;
}

export function WorkspaceToggle({ sessionId, directory, isIndexing }: WorkspaceToggleProps) {
  const { t } = useTranslation("chat");
  const queryClient = useQueryClient();
  const [projects, setProjects] = useState<DirEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { workspaceRoot } = useWorkspaceConfig();

  // For new chats (no sessionId), use global settings store
  const globalWorkspace = useSettingsStore((s) => s.workspaceDirectory);
  const setGlobalWorkspace = useSettingsStore((s) => s.setWorkspaceDirectory);

  // Resolved values depending on context
  const currentPath = sessionId ? directory : globalWorkspace;
  const displayName = getDisplayName(currentPath, workspaceRoot);

  // Load user projects from workspace. Pre-filtered by the BFF
  // (.xo internals and system leaves are stripped server-side).
  // TODO: drop the workspaceRoot-based path mapping once
  // PATCH /api/sessions/{id}/directory accepts a project id.
  const loadProjects = useCallback(async () => {
    try {
      const res = await api.get<ListProjectsResponse>(API.PROJECTS.LIST);
      setProjects(
        res.items.map((it) => ({
          name: it.display_name,
          path: `${workspaceRoot}/${it.id}`,
        })),
      );
    } catch {
      setProjects([]);
    } finally {
      setLoaded(true);
    }
  }, [workspaceRoot]);

  // Fetch projects on first open
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open && !loaded) {
        void loadProjects();
      }
    },
    [loaded, loadProjects],
  );

  // Apply selection
  const selectPath = useCallback(
    async (path: string | null) => {
      const value = path ?? ".";
      if (sessionId) {
        await api.patch(API.SESSIONS.DETAIL(sessionId), { directory: value });
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions.detail(sessionId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
      } else {
        setGlobalWorkspace(path);
      }
    },
    [sessionId, queryClient, setGlobalWorkspace],
  );

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] transition-colors max-w-[200px]",
            displayName
              ? "bg-[var(--surface-tertiary)] text-[var(--text-primary)]"
              : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-tertiary)]",
          )}
        >
          {isIndexing ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <FolderOpen className="h-4 w-4 shrink-0" />
          )}
          <span className="truncate">{displayName || t("workspaceNone")}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {/* "All" / Entire computer option */}
        <DropdownMenuItem
          className={cn(
            "flex items-center gap-2 text-[13px]",
            !displayName && "text-[var(--brand-primary)] font-medium",
          )}
          onClick={() => void selectPath(null)}
        >
          <Monitor className="h-3.5 w-3.5 shrink-0" />
          {t("workspaceNone")}
        </DropdownMenuItem>

        {/* Project list */}
        {projects.length > 0 && (
          <>
            <DropdownMenuSeparator />
            {projects.map((p) => {
              const isActive = currentPath === p.path;
              return (
                <DropdownMenuItem
                  key={p.path}
                  className={cn(
                    "flex items-center gap-2 text-[13px]",
                    isActive && "text-[var(--brand-primary)] font-medium",
                  )}
                  onClick={() => void selectPath(p.path)}
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate capitalize">{p.name}</span>
                </DropdownMenuItem>
              );
            })}
          </>
        )}

        {/* Loading state */}
        {!loaded && (
          <DropdownMenuItem disabled className="flex items-center gap-2 text-[13px]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading...
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
