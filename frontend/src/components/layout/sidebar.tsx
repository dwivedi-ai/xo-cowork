"use client";

import { motion } from "framer-motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarHeader } from "./sidebar-header";
import { SidebarNav } from "./sidebar-nav";
import { ProjectExplorer } from "./project-explorer";
import { AgentsExplorer } from "./agents-explorer";
import { SidebarFooter } from "./sidebar-footer";
import { useSidebarStore } from "@/stores/sidebar-store";
import { SIDEBAR_WIDTH, IS_DESKTOP, TITLE_BAR_HEIGHT } from "@/lib/constants";

export function Sidebar() {
  const isCollapsed = useSidebarStore((s) => s.isCollapsed);

  return (
    <TooltipProvider delayDuration={200}>
      <motion.aside
        aria-label="Chat sidebar"
        className="fixed inset-y-0 left-0 z-30 flex flex-col bg-[var(--sidebar-bg)] overflow-hidden"
        style={IS_DESKTOP ? { top: TITLE_BAR_HEIGHT } : undefined}
        initial={false}
        animate={{ width: isCollapsed ? 0 : SIDEBAR_WIDTH }}
        transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
      >
        <SidebarHeader />
        <SidebarNav />

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
          <ProjectExplorer />
          <AgentsExplorer />
        </div>

        <SidebarFooter />
      </motion.aside>
    </TooltipProvider>
  );
}