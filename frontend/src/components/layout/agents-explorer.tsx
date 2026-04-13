"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgents } from "@/hooks/use-agents";
import { useSessions } from "@/hooks/use-sessions";
import { useActiveSessionId } from "@/hooks/use-active-session-id";
import { getChatRoute } from "@/lib/routes";
import type { SessionResponse } from "@/types/session";

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
          "flex items-center gap-1.5 w-full py-1.5 px-2 text-[16px] rounded-md transition-colors",
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
                  "flex items-center gap-1.5 w-full py-1 px-2 rounded-md text-[15px] transition-colors truncate",
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
  const [isExpanded, setIsExpanded] = useState(false);
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: sessionPages, isLoading: sessionsLoading } = useSessions();
  const activeSessionId = useActiveSessionId();
  const router = useRouter();

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
          "flex items-center gap-2 w-full px-2 py-2 rounded-xl text-[16px] transition-all duration-150 ease-out",
          isExpanded
            ? "bg-[var(--sidebar-active)] text-[var(--text-primary)] shadow-[var(--sidebar-active-shadow)] ring-1 ring-[var(--sidebar-active-border)]"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:scale-[0.98]",
        )}
      >
        <Bot className="h-[18px] w-[18px] shrink-0" />
        <span className="flex-1 text-left">Agents</span>
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        )}
      </button>

      {isExpanded && (
        <div className="mt-1 max-h-[350px] overflow-y-auto scrollbar-thin">
          {isLoading ? (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" />
            </div>
          ) : agentSessionMap.size === 0 ? (
            <p className="px-3 py-2 text-[11px] text-[var(--text-tertiary)]">No agents found</p>
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
    </div>
  );
}
