"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  LayoutDashboard,
  Bot,
  Target,
  FolderOpen,
  Clock,
  FileText,
  FileCode,
  FileImage,
  File,
  Loader2,
  Code,
  Eye,
  ChevronRight,
  Layers,
  Folder,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ProjectTabsProps {
  /** Absolute path to the project folder */
  projectPath: string;
  /** Display name of the project */
  projectName: string;
}

type TabId = "files" | "about" | "instructions" | "objectives";

interface MdTabDef {
  id: TabId;
  label: string;
  icon: typeof LayoutDashboard;
  /** File to load from the project folder */
  fileName: string;
  emptyTitle: string;
  emptyDesc: string;
}

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

/** The 3 agent markdown files hidden from the Overview file list */
const AGENT_FILES = new Set(["WORKSPACE.md", "AGENTS.md", "OBJECTIVES.md"]);

const ALL_TABS: { id: TabId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "files", label: "Overview", icon: Layers },
  { id: "about", label: "About Project", icon: LayoutDashboard },
  { id: "instructions", label: "Instructions for Agents", icon: Bot },
  { id: "objectives", label: "OKR", icon: Target },
];

const MD_TABS: Record<string, MdTabDef> = {
  about: {
    id: "about",
    label: "About Project",
    icon: LayoutDashboard,
    fileName: "WORKSPACE.md",
    emptyTitle: "No project overview",
    emptyDesc: "Add a WORKSPACE.md file to describe the project scope, context, and key information.",
  },
  instructions: {
    id: "instructions",
    label: "Instructions for Agents",
    icon: Bot,
    fileName: "AGENTS.md",
    emptyTitle: "No agent instructions",
    emptyDesc: "Add an AGENTS.md file to define how the AI agent should behave, its persona, and rules.",
  },
  objectives: {
    id: "objectives",
    label: "OKR",
    icon: Target,
    fileName: "OBJECTIVES.md",
    emptyTitle: "No objectives defined",
    emptyDesc: "Add an OBJECTIVES.md file to keep your AI agent focused on what matters most.",
  },
};

/* ------------------------------------------------------------------ */
/*  File icon helper                                                   */
/* ------------------------------------------------------------------ */

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["md", "txt", "doc", "docx", "pdf"].includes(ext))
    return <FileText className="h-4 w-4 text-[var(--text-tertiary)]" />;
  if (["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "css", "scss", "html", "json", "yaml", "yml", "toml"].includes(ext))
    return <FileCode className="h-4 w-4 text-[var(--text-tertiary)]" />;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"].includes(ext))
    return <FileImage className="h-4 w-4 text-[var(--text-tertiary)]" />;
  return <File className="h-4 w-4 text-[var(--text-tertiary)]" />;
}

/* ------------------------------------------------------------------ */
/*  Overview tab — file listing                                        */
/* ------------------------------------------------------------------ */

function OverviewTab({ projectPath }: { projectPath: string }) {
  const [dirs, setDirs] = useState<DirEntry[]>([]);
  const [files, setFiles] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await api.post<ListDirectoryResponse>(API.FILES.LIST_DIRECTORY, {
          path: projectPath,
        });
        if (!cancelled) {
          // Filter out agent files and hidden entries
          setDirs(res.dirs.filter((d) => !d.name.startsWith(".")));
          setFiles(res.files.filter((f) => !AGENT_FILES.has(f.name) && !f.name.startsWith(".")));
        }
      } catch {
        if (!cancelled) {
          setDirs([]);
          setFiles([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectPath]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
      </div>
    );
  }

  const isEmpty = dirs.length === 0 && files.length === 0;

  if (isEmpty) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-default)] p-8 text-center">
        <FolderOpen className="h-8 w-8 mx-auto mb-3 text-[var(--text-quaternary)]" />
        <p className="text-[14px] font-medium text-[var(--text-secondary)] mb-1">
          No files yet
        </p>
        <p className="text-[12px] text-[var(--text-tertiary)] max-w-sm mx-auto">
          Add files to your project folder to see them here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-default)] bg-[var(--surface-tertiary)]">
        <FolderOpen className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        <span className="text-[12px] font-medium text-[var(--text-secondary)]">
          Project files
        </span>
        <span className="text-[11px] text-[var(--text-quaternary)] ml-auto">
          {dirs.length + files.length} items
        </span>
      </div>

      {/* File list */}
      <div className="max-h-[380px] overflow-y-auto scrollbar-thin divide-y divide-[var(--border-default)]">
        {/* Directories first */}
        {dirs.map((dir) => (
          <div
            key={dir.path}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--surface-tertiary)] transition-colors"
          >
            <Folder className="h-4 w-4 text-[var(--text-tertiary)]" />
            <span className="text-[13px] text-[var(--text-primary)] font-medium truncate flex-1">
              {dir.name}
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-[var(--text-quaternary)]" />
          </div>
        ))}
        {/* Files */}
        {files.map((file) => (
          <div
            key={file.path}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--surface-tertiary)] transition-colors"
          >
            {fileIcon(file.name)}
            <span className="text-[13px] text-[var(--text-primary)] truncate flex-1">
              {file.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Markdown file viewer                                               */
/* ------------------------------------------------------------------ */

function MarkdownFileView({ filePath, tab }: { filePath: string; tab: MdTabDef }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setContent(null);
    (async () => {
      try {
        const res = await api.post<{ content: string }>(API.FILES.CONTENT, {
          path: filePath,
        });
        if (!cancelled) setContent(res.content ?? null);
      } catch {
        if (!cancelled) setContent(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filePath]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
      </div>
    );
  }

  if (!content) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border-default)] p-8 text-center">
        <tab.icon className="h-8 w-8 mx-auto mb-3 text-[var(--text-quaternary)]" />
        <p className="text-[14px] font-medium text-[var(--text-secondary)] mb-1">
          {tab.emptyTitle}
        </p>
        <p className="text-[12px] text-[var(--text-tertiary)] max-w-sm mx-auto mb-1">
          {tab.emptyDesc}
        </p>
        <p className="text-[11px] text-[var(--text-quaternary)]">
          Expected file: <code className="px-1 py-0.5 rounded bg-[var(--surface-tertiary)] text-[var(--text-tertiary)]">{tab.fileName}</code>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] overflow-hidden">
      {/* File header with source toggle */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-default)] bg-[var(--surface-tertiary)]">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">{tab.fileName}</span>
        </div>
        <button
          onClick={() => setShowSource((s) => !s)}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] transition-colors"
          title={showSource ? "Show preview" : "Show source"}
        >
          {showSource ? (
            <><Eye className="h-3 w-3" /> Preview</>
          ) : (
            <><Code className="h-3 w-3" /> Source</>
          )}
        </button>
      </div>

      {/* Content: rendered markdown or raw source */}
      <div className="max-h-[380px] overflow-y-auto scrollbar-thin">
        {showSource ? (
          <pre className="p-4 text-[13px] leading-relaxed font-mono text-[var(--text-primary)] whitespace-pre-wrap break-words">
            {content}
          </pre>
        ) : (
          <div className="p-5">
            <div className="prose max-w-none text-[var(--text-primary)] leading-relaxed">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
              >
                {content}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main ProjectTabs Component                                         */
/* ------------------------------------------------------------------ */

export function ProjectTabs({ projectPath, projectName }: ProjectTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>("files");

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="w-full"
    >
      {/* Project header */}
      <div className="flex items-center gap-2.5 mb-5">
        <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-[var(--surface-tertiary)] border border-[var(--border-default)]">
          <FolderOpen className="h-4 w-4 text-[var(--text-secondary)]" />
        </div>
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)] capitalize leading-tight">
            {projectName}
          </h2>
          <p className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-1 mt-0.5">
            <Clock className="h-3 w-3 inline" />
            Active project
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border-default)] mb-5">
        {ALL_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "relative flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium transition-all duration-200",
                isActive
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="project-tab-indicator"
                  className="absolute inset-0 rounded-lg bg-[var(--sidebar-active)] shadow-sm border border-[var(--border-default)]"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                <tab.icon className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">{tab.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === "files" ? (
            <OverviewTab projectPath={projectPath} />
          ) : (
            <MarkdownFileView
              filePath={`${projectPath}/${MD_TABS[activeTab].fileName}`}
              tab={MD_TABS[activeTab]}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
