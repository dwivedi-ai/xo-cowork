"use client";

import { useCallback } from "react";
import { useTranslation } from 'react-i18next';
import { AppLink as Link, useAppRouter } from "@/lib/navigation";
import { SquarePen, ArrowLeft, List, Square } from "lucide-react";
import { HeaderModelDropdown } from "@/components/selectors/header-model-dropdown";
import { ContextIndicator } from "@/components/chat/context-indicator";
import { Button } from "@/components/ui/button";
import { XoCoworkLogo } from "@/components/ui/xo-cowork-logo";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useChatStore } from "@/stores/chat-store";
import { isRemoteMode } from "@/lib/remote-connection";

interface ChatHeaderProps {
  sessionId?: string;
}

export function ChatHeader({ sessionId }: ChatHeaderProps) {
  const { t } = useTranslation('chat');
  const router = useAppRouter();
  const isCollapsed = useSidebarStore((s) => s.isCollapsed);
  const toggle = useSidebarStore((s) => s.toggle);
  const remote = isRemoteMode();
  const isGenerating = useChatStore((s) => s.isGenerating);
  const streamingParts = useChatStore((s) => s.streamingParts);
  const streamId = useChatStore((s) => s.streamId);

  // Derive stream status label for remote mode
  const streamStatus = (() => {
    if (!remote || !isGenerating) return null;
    if (streamingParts.length === 0) return "Starting...";
    const lastPart = streamingParts[streamingParts.length - 1];
    if (lastPart.type === "tool" && lastPart.state.status === "running") return "Using tools...";
    return "Generating...";
  })();

  const handleAbort = useCallback(async () => {
    if (!streamId) return;
    try {
      const { api } = await import("@/lib/api");
      const { API: ApiRoutes } = await import("@/lib/constants");
      await api.post(ApiRoutes.CHAT.ABORT, { stream_id: streamId });
    } catch {
      // Abort is best-effort
    }
  }, [streamId]);

  return (
    <TooltipProvider delayDuration={200}>
      <header className="flex h-13 items-center gap-1 px-3 bg-[var(--surface-primary)]/80 backdrop-blur-sm">
        {/* Remote mode: task list button */}
        {remote && (
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => router.push("/m")}
            aria-label="Task list"
          >
            <List className="h-[18px] w-[18px]" />
          </Button>
        )}

        {/* Desktop mode: Sidebar toggle + new chat — visible when sidebar is collapsed */}
        {!remote && isCollapsed && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={toggle} aria-label={t('toggleSidebar', { ns: 'common' })}>
                  <XoCoworkLogo size={18} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('openSidebar', { ns: 'common' })}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={t('newChat', { ns: 'common' })} asChild>
                  <Link href="/c/new">
                    <SquarePen className="h-[18px] w-[18px]" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('newChat', { ns: 'common' })}</TooltipContent>
            </Tooltip>
          </>
        )}

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <HeaderModelDropdown />
        </div>

        {/* Remote mode: stream status, or task list button */}
        {remote && streamStatus && (
          <span className="text-[12px] text-[var(--text-tertiary)] animate-pulse whitespace-nowrap">
            {streamStatus}
          </span>
        )}

        {/* Context usage indicator — desktop only */}
        {!remote && sessionId && <ContextIndicator sessionId={sessionId} />}
      </header>
    </TooltipProvider>
  );
}
