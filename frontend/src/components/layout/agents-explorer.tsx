"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileImage,
  FileText,
  FolderClosed,
  FolderOpen,
  Loader2,
  MessageSquare,
  Plus,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAgents, useCreateAgent } from "@/hooks/use-agents";
import { useSessions } from "@/hooks/use-sessions";
import { useActiveSessionId } from "@/hooks/use-active-session-id";
import { api, ApiError } from "@/lib/api";
import { API } from "@/lib/constants";
import { getAgentRoute, getChatRoute } from "@/lib/routes";
import { useArtifactStore } from "@/stores/artifact-store";
import { artifactTypeFromExtension, languageFromExtension } from "@/lib/artifacts";
import type { SessionResponse } from "@/types/session";

function formatAgentCreateError(err: unknown): string {
  if (err instanceof ApiError) {
    const b = err.body;
    if (typeof b === "object" && b !== null && "detail" in b) {
      const d = (b as { detail: unknown }).detail;
      if (typeof d === "string") return d;
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

/* ------------------------------------------------------------------ */
/*  File-tree helpers (workspace config browser)                      */
/* ------------------------------------------------------------------ */

interface DirEntry {
  name: string;
  path: string;
}

interface ListDirectoryResponse {
  path: string;
  parent: string | null;
  dirs: DirEntry[];
  files: DirEntry[];
}

function configFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const codeExts = new Set([
    "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "cpp", "h",
    "css", "scss", "html", "json", "yaml", "yml", "toml", "xml", "sh",
    "md", "mdx", "sql", "rb", "php", "swift", "kt", "vue", "svelte",
  ]);
  const imageExts = new Set(["png", "jpg", "jpeg", "gif", "svg", "ico", "webp"]);
  if (codeExts.has(ext)) return FileCode;
  if (imageExts.has(ext)) return FileImage;
  if (ext === "txt" || ext === "log" || ext === "csv") return FileText;
  return File;
}

function ConfigFolderNode({ name, path, depth }: { name: string; path: string; depth: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [children, setChildren] = useState<{ dirs: DirEntry[]; files: DirEntry[] } | null>(null);

  const toggle = useCallback(async () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    if (!children) {
      setLoading(true);
      try {
        const res = await api.post<ListDirectoryResponse>(API.FILES.LIST_DIRECTORY, { path });
        setChildren({ dirs: res.dirs, files: res.files });
      } catch {
        setChildren({ dirs: [], files: [] });
      } finally {
        setLoading(false);
      }
    }
    setIsOpen(true);
  }, [isOpen, children, path]);

  const Icon = isOpen ? FolderOpen : FolderClosed;
  const Chevron = isOpen ? ChevronDown : ChevronRight;

  return (
    <div>
      <button
        onClick={toggle}
        className={cn(
          "flex items-center gap-1.5 w-full py-1 text-[13px] text-[var(--text-secondary)]",
          "hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-active)] rounded-lg transition-colors",
        )}
        style={{ paddingLeft: `${depth * 10 + 6}px`, paddingRight: "6px" }}
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
        ) : (
          <Chevron className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
        )}
        <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
        <span className="truncate">{name}</span>
      </button>
      {isOpen && children && (
        <div>
          {children.dirs.map((d) => (
            <ConfigFolderNode key={d.path} name={d.name} path={d.path} depth={depth + 1} />
          ))}
          {children.files.map((f) => (
            <ConfigFileNode key={f.path} name={f.name} path={f.path} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConfigFileNode({ name, path, depth }: { name: string; path: string; depth: number }) {
  const Icon = configFileIcon(name);

  const handleClick = () => {
    const type = artifactTypeFromExtension(path) ?? "file-preview";
    useArtifactStore.getState().openArtifact({
      id: `agent-config-${path}`,
      type,
      title: name,
      content: "",
      filePath: path,
      language: languageFromExtension(path),
    });
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex items-center gap-1.5 w-full py-1 text-[13px] text-[var(--text-tertiary)]",
        "hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-active)] rounded-lg transition-colors cursor-pointer",
      )}
      style={{ paddingLeft: `${depth * 10 + 6 + 15}px`, paddingRight: "6px" }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate text-left">{name}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Agent workspace file tree section                                 */
/* ------------------------------------------------------------------ */

function AgentConfigSection({ workspacePath }: { workspacePath: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [children, setChildren] = useState<{ dirs: DirEntry[]; files: DirEntry[] } | null>(null);

  const toggle = useCallback(async () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    if (!children) {
      setLoading(true);
      try {
        const res = await api.post<ListDirectoryResponse>(API.FILES.LIST_DIRECTORY, { path: workspacePath });
        setChildren({ dirs: res.dirs, files: res.files });
      } catch {
        setChildren({ dirs: [], files: [] });
      } finally {
        setLoading(false);
      }
    }
    setIsOpen(true);
  }, [isOpen, children, workspacePath]);

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "flex items-center gap-1.5 w-full py-1 px-2 text-[13px] rounded-lg transition-colors",
          "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-active)]",
        )}
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
        ) : isOpen ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
        )}
        {isOpen ? (
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
        ) : (
          <FolderClosed className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
        )}
        <span className="truncate">Agent Config</span>
      </button>
      {isOpen && children && (
        <div className="ml-2">
          {children.dirs.length === 0 && children.files.length === 0 ? (
            <p className="px-3 py-1 text-[11px] text-[var(--text-tertiary)]">Empty workspace</p>
          ) : (
            <>
              {children.dirs.map((d) => (
                <ConfigFolderNode key={d.path} name={d.name} path={d.path} depth={1} />
              ))}
              {children.files.map((f) => (
                <ConfigFileNode key={f.path} name={f.name} path={f.path} depth={1} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Agent node (main collapsible row per agent)                       */
/* ------------------------------------------------------------------ */

interface AgentNodeProps {
  name: string;
  workspacePath: string | null;
  sessions: SessionResponse[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
}

function AgentNode({ name, workspacePath, sessions, activeSessionId, onSelectSession }: AgentNodeProps) {
  const { t } = useTranslation("common");
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 w-full py-1.5 px-2 text-[13px] rounded-lg transition-colors",
          "text-[var(--text-secondary)] hover:bg-[var(--sidebar-active)]",
        )}
      >
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex flex-1 min-w-0 items-center gap-1.5 text-left rounded-md hover:text-[var(--text-primary)]"
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
          )}
          <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
          <span className="truncate capitalize">{name}</span>
        </button>
        <button
          type="button"
          className="shrink-0 p-1 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)]"
          aria-label={t("editAgent")}
          title={t("editAgent")}
          onClick={() => router.push(getAgentRoute(name))}
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
        <span className="text-[11px] text-[var(--text-tertiary)] shrink-0 tabular-nums">{sessions.length}</span>
      </div>

      {isOpen && (
        <div className="ml-5">
          {sessions.length === 0 ? (
            <p className="px-3 py-1 text-[11px] text-[var(--text-tertiary)]">No sessions</p>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={cn(
                  "flex items-center gap-1.5 w-full py-1 px-2 rounded-lg text-[13px] transition-colors truncate",
                  session.id === activeSessionId
                    ? "bg-[var(--sidebar-active)] text-[var(--text-primary)] ring-1 ring-[var(--sidebar-active-border)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-active)]",
                )}
              >
                <MessageSquare className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
                <span className="truncate">{session.title || "Untitled"}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function AgentsExplorer() {
  const { t } = useTranslation("common");
  const [isExpanded, setIsExpanded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [agentIdDraft, setAgentIdDraft] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: sessionPages, isLoading: sessionsLoading } = useSessions();
  const createAgent = useCreateAgent();
  const activeSessionId = useActiveSessionId();
  const router = useRouter();

  const openAddDialog = useCallback(() => {
    setDisplayName("");
    setAgentIdDraft("");
    setAgentDescription("");
    setAddOpen(true);
  }, []);

  const handleCreateAgent = useCallback(() => {
    const name = displayName.trim();
    if (!name) return;
    createAgent.mutate(
      {
        name,
        ...(agentIdDraft.trim() ? { id: agentIdDraft.trim() } : {}),
        ...(agentDescription.trim() ? { description: agentDescription.trim() } : {}),
      },
      {
        onSuccess: () => {
          toast.success(t("agentCreated"));
          setAddOpen(false);
        },
        onError: (err) => {
          toast.error(t("agentCreateFailed"), { description: formatAgentCreateError(err) });
        },
      },
    );
  }, [agentDescription, agentIdDraft, createAgent, displayName, t]);

  const sessions = useMemo(() => {
    return sessionPages?.pages.flat() ?? [];
  }, [sessionPages]);

  // Group sessions by agent directory + collect workspace paths
  const { agentSessionMap, agentWorkspaceMap } = useMemo(() => {
    const sessionMap = new Map<string, SessionResponse[]>();
    const workspaceMap = new Map<string, string | null>();
    // Initialize with known agents
    if (agents) {
      for (const agent of agents) {
        sessionMap.set(agent.name, []);
        workspaceMap.set(agent.name, (agent.metadata?.workspace as string) ?? null);
      }
    }
    // Assign sessions to agents
    for (const session of sessions) {
      const agentName = session.agent || session.directory || "default";
      if (!sessionMap.has(agentName)) sessionMap.set(agentName, []);
      sessionMap.get(agentName)!.push(session);
    }
    return { agentSessionMap: sessionMap, agentWorkspaceMap: workspaceMap };
  }, [agents, sessions]);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      router.push(getChatRoute(sessionId));
    },
    [router],
  );

  const isLoading = agentsLoading || sessionsLoading;

  return (
    <div className="px-2 pb-1">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "flex items-center gap-3 w-full px-3 py-2 rounded-xl text-[13px] transition-all duration-150 ease-out",
          isExpanded
            ? "bg-[var(--sidebar-active)] text-[var(--text-primary)] shadow-[var(--sidebar-active-shadow)] ring-1 ring-[var(--sidebar-active-border)]"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:scale-[0.98]",
        )}
      >
        <Bot className="h-[18px] w-[18px] shrink-0" />
        <span className="flex-1 text-left">{t("agents")}</span>
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        )}
      </button>

      {isExpanded && (
        <div className="mt-1 max-h-[350px] overflow-y-auto scrollbar-thin">
          <div className="flex justify-end px-1 pb-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[11px] text-[var(--text-secondary)]"
              onClick={(e) => {
                e.stopPropagation();
                openAddDialog();
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("addAgent")}
            </Button>
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" />
            </div>
          ) : agentSessionMap.size === 0 ? (
            <p className="px-3 py-2 text-[11px] text-[var(--text-tertiary)]">{t("noAgentsFound")}</p>
          ) : (
            Array.from(agentSessionMap.entries()).map(([agentName, agentSessions]) => (
              <AgentNode
                key={agentName}
                name={agentName}
                workspacePath={agentWorkspaceMap.get(agentName) ?? null}
                sessions={agentSessions}
                activeSessionId={activeSessionId}
                onSelectSession={handleSelectSession}
              />
            ))
          )}
        </div>
      )}

      {/* Divider */}
      <div className="mt-1 border-b border-[var(--border-default)] opacity-50" />

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>{t("addAgentTitle")}</DialogTitle>
            <DialogDescription>{t("addAgentDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 pt-1">
            <div className="grid gap-1.5">
              <label htmlFor="agent-display-name" className="text-xs font-medium text-[var(--text-secondary)]">
                {t("agentDisplayName")}
              </label>
              <Input
                id="agent-display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t("agentDisplayName")}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="agent-id" className="text-xs font-medium text-[var(--text-secondary)]">
                {t("agentIdOptional")}
              </label>
              <Input
                id="agent-id"
                value={agentIdDraft}
                onChange={(e) => setAgentIdDraft(e.target.value)}
                placeholder="e.g. research"
                autoComplete="off"
              />
              <p className="text-[11px] text-[var(--text-tertiary)] leading-snug">{t("agentIdHint")}</p>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="agent-desc" className="text-xs font-medium text-[var(--text-secondary)]">
                {t("descriptionOptional")}
              </label>
              <textarea
                id="agent-desc"
                value={agentDescription}
                onChange={(e) => setAgentDescription(e.target.value)}
                rows={2}
                className={cn(
                  "flex w-full rounded-[var(--radius)] border border-[var(--border-default)] bg-transparent px-3 py-2 text-sm shadow-[var(--shadow-sm)]",
                  "placeholder:text-[var(--text-tertiary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] resize-none",
                )}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(false)}>
                {t("cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!displayName.trim() || createAgent.isPending}
                onClick={handleCreateAgent}
              >
                {createAgent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("createAgent")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
