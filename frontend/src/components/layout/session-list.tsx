"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { useAppRouter } from "@/lib/navigation";
import { useTranslation } from 'react-i18next';
import { toast } from "sonner";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { API, queryKeys } from "@/lib/constants";
import { api } from "@/lib/api";
import { useChatStore } from "@/stores/chat-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useSessions, useDeleteSession, useRenameSession, usePinSession, useSearchSessions } from "@/hooks/use-sessions";
import { useActiveSessionId } from "@/hooks/use-active-session-id";
import { useSessionExport } from "@/hooks/use-session-export";
import { SessionItem } from "./session-item";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, MessageSquare, SearchX, ChevronDown, ChevronRight, Bot } from "lucide-react";
import { getChatRoute } from "@/lib/routes";
import { cn, groupSessionsByDate } from "@/lib/utils";
import type { SessionResponse } from "@/types/session";

type FlatItem =
  | { type: "header"; label: string }
  | { type: "agent-header"; agent: string; count: number }
  | { type: "date-header"; label: string }
  | { type: "session"; session: SessionResponse; snippet?: string };

export function SessionList() {
  const { t } = useTranslation('common');
  const router = useAppRouter();
  const activeSessionId = useActiveSessionId();
  const {
    data: sessionPages,
    isLoading,
    isError,
    hasNextPage,
    isFetchingNextPage,
    refetch,
    fetchNextPage,
  } = useSessions();
  const deleteSession = useDeleteSession();
  const renameSession = useRenameSession();
  const pinSession = usePinSession();
  const { exportPdf, exportMarkdown } = useSessionExport();
  const queryClient = useQueryClient();
  const searchQuery = useSidebarStore((s) => s.searchQuery);
  const isContentSearch = searchQuery.trim().length >= 2;
  const { data: searchResults, isLoading: isSearching } = useSearchSessions(searchQuery);

  // Flatten infinite query pages into a single array, deduplicating by id
  const sessions = useMemo(() => {
    const all = sessionPages?.pages.flat() ?? [];
    const seen = new Set<string>();
    return all.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  }, [sessionPages]);

  // Roving tabindex: track which session item is focused
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  // Collapsed agent groups
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(new Set());
  const toggleAgent = useCallback((agent: string) => {
    setCollapsedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  }, []);

  // Soft delete with undo — refs for delayed deletion
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deletedSessionRef = useRef<{
    id: string;
    data: InfiniteData<SessionResponse[]>;
  } | null>(null);

  // Cleanup pending delete timer on unmount
  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) {
        clearTimeout(deleteTimerRef.current);
      }
    };
  }, []);

  // Build a map of session id → snippet for content search results
  const snippetMap = useMemo(() => {
    const map = new Map<string, string>();
    if (searchResults) {
      for (const r of searchResults) {
        if (r.snippet) map.set(r.session.id, r.snippet);
      }
    }
    return map;
  }, [searchResults]);

  const filtered = useMemo(() => {
    if (isContentSearch && searchResults) {
      return searchResults.map((r) => r.session);
    }
    if (!sessions.length) return [];
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter((s) =>
      (s.title ?? "").toLowerCase().includes(q),
    );
  }, [sessions, searchQuery, isContentSearch, searchResults]);

  const pinned = useMemo(() => filtered.filter((s) => s.is_pinned), [filtered]);
  const unpinned = useMemo(() => filtered.filter((s) => !s.is_pinned), [filtered]);
  const grouped = useMemo(() => groupSessionsByDate(unpinned), [unpinned]);

  // Check if sessions use agent directories (OpenClaw bridge mode)
  const hasAgentDirs = useMemo(
    () => filtered.some((s) => s.directory && s.directory !== "." && !s.directory.includes("/")),
    [filtered],
  );

  // Flatten grouped data into a single list for virtualization
  const flatItems = useMemo(() => {
    const items: FlatItem[] = [];

    if (hasAgentDirs) {
      // Group by agent name, then by date within each agent
      const agentMap = new Map<string, SessionResponse[]>();
      for (const s of filtered) {
        const agent = s.directory || "default";
        if (!agentMap.has(agent)) agentMap.set(agent, []);
        agentMap.get(agent)!.push(s);
      }

      for (const [agent, agentSessions] of agentMap) {
        items.push({ type: "agent-header", agent, count: agentSessions.length });
        if (!collapsedAgents.has(agent)) {
          const agentPinned = agentSessions.filter((s) => s.is_pinned);
          const agentUnpinned = agentSessions.filter((s) => !s.is_pinned);
          const dateGroups = groupSessionsByDate(agentUnpinned);

          if (agentPinned.length > 0) {
            items.push({ type: "date-header", label: "pinned" });
            for (const session of agentPinned) {
              items.push({ type: "session", session, snippet: snippetMap.get(session.id) });
            }
          }
          for (const group of dateGroups) {
            items.push({ type: "date-header", label: group.label });
            for (const session of group.sessions) {
              items.push({ type: "session", session, snippet: snippetMap.get(session.id) });
            }
          }
        }
      }
    } else {
      // Default: group by date only (original behavior)
      if (pinned.length > 0) {
        items.push({ type: "header", label: "pinned" });
        for (const session of pinned) {
          items.push({ type: "session", session, snippet: snippetMap.get(session.id) });
        }
      }
      for (const group of grouped) {
        items.push({ type: "header", label: group.label });
        for (const session of group.sessions) {
          items.push({ type: "session", session, snippet: snippetMap.get(session.id) });
        }
      }
    }
    return items;
  }, [pinned, grouped, snippetMap, hasAgentDirs, filtered, collapsedAgents]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const item = flatItems[index];
      if (item.type === "header" || item.type === "date-header") return index === 0 ? 32 : 40;
      if (item.type === "agent-header") return 42;
      return item.snippet ? 58 : 46;
    },
    overscan: 10,
  });

  // Fetch next page when scrolling near bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (
        scrollHeight - scrollTop - clientHeight < 200 &&
        hasNextPage &&
        !isFetchingNextPage &&
        !isContentSearch
      ) {
        fetchNextPage();
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, isContentSearch]);

  // Startup resilience: if the initial sessions request fails (e.g. backend not
  // fully ready yet), retry with exponential backoff so the sidebar hydrates
  // without hammering the backend during recovery.
  useEffect(() => {
    if (!isError) return;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    const retry = () => {
      const delay = Math.min(3000 * Math.pow(2, attempt), 30000);
      timer = setTimeout(() => {
        void refetch();
        attempt++;
        if (attempt < 10) retry();
      }, delay);
    };
    retry();
    return () => clearTimeout(timer);
  }, [isError, refetch]);

  // Compute session-only indices for keyboard navigation (skip headers)
  const sessionIndices = useMemo(
    () => flatItems.reduce<number[]>((acc, item, i) => {
      if (item.type === "session") acc.push(i);
      return acc;
    }, []),
    [flatItems],
  );

  // Reset focusedIndex when the list changes so stale indices don't linger
  useEffect(() => {
    setFocusedIndex(-1);
  }, [flatItems.length]);

  const handleListKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (sessionIndices.length === 0) return;

      let nextFocused: number | undefined;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const currentPos = sessionIndices.indexOf(focusedIndex);
          nextFocused =
            currentPos < 0 || currentPos >= sessionIndices.length - 1
              ? sessionIndices[0]
              : sessionIndices[currentPos + 1];
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const currentPos = sessionIndices.indexOf(focusedIndex);
          nextFocused =
            currentPos <= 0
              ? sessionIndices[sessionIndices.length - 1]
              : sessionIndices[currentPos - 1];
          break;
        }
        case "Home": {
          e.preventDefault();
          nextFocused = sessionIndices[0];
          break;
        }
        case "End": {
          e.preventDefault();
          nextFocused = sessionIndices[sessionIndices.length - 1];
          break;
        }
        default:
          return;
      }

      if (nextFocused !== undefined) {
        setFocusedIndex(nextFocused);
        virtualizer.scrollToIndex(nextFocused, { align: "auto" });
      }
    },
    [focusedIndex, sessionIndices, virtualizer],
  );

  const handleDeleteRequest = useCallback((id: string, title: string) => {
    setDeleteTarget({ id, title });
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteTarget) return;
    const { id } = deleteTarget;

    // If the session being deleted has active generation, abort it first
    const chatState = useChatStore.getState();
    if (chatState.sessionId === id && chatState.isGenerating && chatState.streamId) {
      api.post(API.CHAT.ABORT, { stream_id: chatState.streamId }).catch(() => {});
      chatState.finishGeneration();
    }

    // Save the current cache so we can restore on undo
    const previousData = queryClient.getQueryData<InfiniteData<SessionResponse[]>>(
      queryKeys.sessions.all,
    );

    if (previousData) {
      deletedSessionRef.current = { id, data: previousData };

      // Optimistically remove from cache
      queryClient.setQueryData<InfiniteData<SessionResponse[]>>(
        queryKeys.sessions.all,
        {
          ...previousData,
          pages: previousData.pages.map((page) =>
            page.filter((s) => s.id !== id),
          ),
        },
      );
    }

    // Navigate away immediately if the deleted session is the active one
    if (activeSessionId === id) {
      router.push(getChatRoute());
    }

    // Start 5-second timer — actually delete when it fires
    deleteTimerRef.current = setTimeout(() => {
      deleteTimerRef.current = null;
      deletedSessionRef.current = null;
      deleteSession.mutate(id);
    }, 5000);

    toast(t('conversationDeleted'), {
      action: {
        label: t('undo'),
        onClick: () => {
          // Cancel the pending delete
          if (deleteTimerRef.current) {
            clearTimeout(deleteTimerRef.current);
            deleteTimerRef.current = null;
          }
          // Restore session to cache
          if (deletedSessionRef.current && deletedSessionRef.current.id === id) {
            queryClient.setQueryData<InfiniteData<SessionResponse[]>>(
              queryKeys.sessions.all,
              deletedSessionRef.current.data,
            );
            deletedSessionRef.current = null;
          }
        },
      },
      duration: 5000,
    });

    setDeleteTarget(null);
  }, [deleteTarget, deleteSession, activeSessionId, router, t, queryClient]);

  const handleDeleteCancel = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const handleRename = useCallback((id: string, newTitle: string) => {
    renameSession.mutate({ id, title: newTitle });
  }, [renameSession]);

  const handleTogglePin = useCallback((id: string, is_pinned: boolean) => {
    pinSession.mutate({ id, is_pinned });
  }, [pinSession]);

  const handleEditStart = useCallback((id: string) => {
    setEditingId(id);
  }, []);

  const handleEditEnd = useCallback(() => {
    setEditingId(null);
  }, []);


  if (isLoading || (isContentSearch && isSearching) || (isError && sessions.length === 0)) {
    return (
      <div className="flex-1 px-3 py-2">
        <div className="flex h-full min-h-0 flex-col gap-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
          <div className="flex-1" />
        </div>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-3">
        {searchQuery ? (
          <>
            <SearchX className="h-8 w-8 text-[var(--text-tertiary)]" />
            <p className="text-xs text-[var(--text-tertiary)] text-center">
              {t('noMatchingConversations')}
            </p>
          </>
        ) : (
          <>
            <MessageSquare className="h-8 w-8 text-[var(--text-tertiary)]" />
            <div className="text-center">
              <p className="text-sm font-medium text-[var(--text-secondary)]">
                {t('noConversationsYet')}
              </p>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">
                {t('noConversationsHint')}
              </p>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div
        ref={scrollRef}
        role="listbox"
        aria-label="Conversation list"
        tabIndex={0}
        onKeyDown={handleListKeyDown}
        className="flex-1 overflow-y-auto overscroll-contain outline-none pt-1 scrollbar-auto"
      >
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = flatItems[virtualRow.index];
            const itemKey =
              item.type === "header" ? `h-${item.label}` :
              item.type === "agent-header" ? `agent-${item.agent}` :
              item.type === "date-header" ? `dh-${item.label}-${virtualRow.index}` :
              item.session.id;
            return (
              <div
                key={itemKey}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className={cn(
                  "absolute left-0 w-full",
                  item.type === "session" ? "pb-0.5" : "pb-1",
                  (item.type === "header" || item.type === "date-header") && virtualRow.index > 0 && "pt-2",
                )}
                style={{ transform: `translateY(${virtualRow.start}px)`, zIndex: flatItems.length - virtualRow.index }}
              >
                {item.type === "agent-header" ? (
                  <button
                    onClick={() => toggleAgent(item.agent)}
                    className="flex items-center gap-2 w-full px-3 py-2 mx-1 rounded-lg text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--sidebar-active)] transition-colors"
                  >
                    {collapsedAgents.has(item.agent) ? (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <Bot className="h-3.5 w-3.5 shrink-0" />
                    <span className="capitalize">{item.agent}</span>
                    <span className="ml-auto text-[10px] text-[var(--text-tertiary)] font-normal">{item.count}</span>
                  </button>
                ) : item.type === "header" || item.type === "date-header" ? (
                  <p className={cn(
                    "py-2 text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider",
                    item.type === "date-header" ? "px-6" : "px-4",
                  )}>
                    {t(item.label)}
                  </p>
                ) : (
                  <SessionItem
                    session={item.session}
                    isActive={activeSessionId === item.session.id}
                    onDelete={handleDeleteRequest}
                    onRename={handleRename}
                    onExportPdf={exportPdf}
                    onExportMarkdown={exportMarkdown}
                    onTogglePin={handleTogglePin}
                    isEditing={editingId === item.session.id}
                    onEditStart={handleEditStart}
                    onEditEnd={handleEditEnd}
                    snippet={item.snippet}
                    isFocused={virtualRow.index === focusedIndex}
                  />
                )}
              </div>
            );
          })}
        </div>
        {isFetchingNextPage && (
          <div className="flex justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" />
          </div>
        )}
      </div>

      <DeleteConfirmationDialog
        open={!!deleteTarget}
        title={deleteTarget?.title ?? ""}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </>
  );
}
