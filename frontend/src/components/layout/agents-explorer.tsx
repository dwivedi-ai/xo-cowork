"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquare,
  Plus,
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
import { ApiError } from "@/lib/api";
import { getChatRoute } from "@/lib/routes";
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

interface AgentNodeProps {
  name: string;
  sessions: SessionResponse[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
}

function AgentNode({ name, sessions, activeSessionId, onSelectSession }: AgentNodeProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-1.5 w-full py-1.5 px-2 text-[13px] rounded-lg transition-colors",
          "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-active)]",
        )}
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
        )}
        <Bot className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
        <span className="truncate capitalize">{name}</span>
        <span className="ml-auto text-[11px] text-[var(--text-tertiary)] shrink-0 tabular-nums">
          {sessions.length}
        </span>
      </button>

      {isOpen && (
        <div className="ml-3">
          {sessions.length === 0 ? (
            <p className="px-3 py-1.5 text-[11px] text-[var(--text-tertiary)]">No sessions</p>
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

  // Group sessions by agent directory
  const agentSessionMap = useMemo(() => {
    const map = new Map<string, SessionResponse[]>();
    // Initialize with known agents
    if (agents) {
      for (const agent of agents) {
        map.set(agent.name, []);
      }
    }
    // Assign sessions to agents
    for (const session of sessions) {
      const agentName = session.directory || "default";
      if (!map.has(agentName)) map.set(agentName, []);
      map.get(agentName)!.push(session);
    }
    return map;
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
