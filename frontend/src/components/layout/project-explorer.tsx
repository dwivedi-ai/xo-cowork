"use client";

import { useState, useCallback } from "react";
import {
  FolderClosed,
  FolderOpen,
  FileText,
  FileCode,
  FileImage,
  File,
  ChevronDown,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";
import { useArtifactStore } from "@/stores/artifact-store";
import { artifactTypeFromExtension, languageFromExtension } from "@/lib/artifacts";

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

/** Map file extension to an icon component. */
function fileIcon(name: string) {
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

interface FolderNodeProps {
  name: string;
  path: string;
  depth: number;
}

function FolderNode({ name, path, depth }: FolderNodeProps) {
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
          "flex items-center gap-1.5 w-full py-1 text-[16px] text-[var(--text-secondary)]",
          "hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-active)] rounded-md transition-colors",
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px`, paddingRight: "8px" }}
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
            <FolderNode key={d.path} name={d.name} path={d.path} depth={depth + 1} />
          ))}
          {children.files.map((f) => (
            <FileNode key={f.path} name={f.name} path={f.path} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

interface FileNodeProps {
  name: string;
  path: string;
  depth: number;
}

function FileNode({ name, path, depth }: FileNodeProps) {
  const Icon = fileIcon(name);

  const handleClick = () => {
    const type = artifactTypeFromExtension(path) ?? "file-preview";
    useArtifactStore.getState().openArtifact({
      id: `project-${path}`,
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
        "flex items-center gap-1.5 w-full py-1 text-[16px] text-[var(--text-tertiary)]",
        "hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-active)] rounded-md transition-colors cursor-pointer",
      )}
      style={{ paddingLeft: `${depth * 12 + 8 + 15}px`, paddingRight: "8px" }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate text-left">{name}</span>
    </button>
  );
}

export function ProjectExplorer() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [rootData, setRootData] = useState<{ dirs: DirEntry[]; files: DirEntry[] } | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (isExpanded) {
      setIsExpanded(false);
      return;
    }
    if (!rootData) {
      setLoading(true);
      try {
        const res = await api.post<ListDirectoryResponse>(API.FILES.LIST_DIRECTORY, {
          path: "/home/coder",
        });
        setRootData({ dirs: res.dirs, files: res.files });
      } catch {
        setRootData({ dirs: [], files: [] });
      } finally {
        setLoading(false);
      }
    }
    setIsExpanded(true);
  }, [isExpanded, rootData]);

  return (
    <div className="px-2 pb-1">
      <button
        onClick={toggle}
        className={cn(
          "flex items-center gap-2 w-full px-2 py-2 rounded-xl text-[16px] transition-all duration-150 ease-out",
          isExpanded
            ? "bg-[var(--sidebar-active)] text-[var(--text-primary)] shadow-[var(--sidebar-active-shadow)] ring-1 ring-[var(--sidebar-active-border)]"
            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:scale-[0.98]",
        )}
      >
        {loading ? (
          <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin" />
        ) : (
          <FolderOpen className="h-[18px] w-[18px] shrink-0" />
        )}
        <span className="flex-1 text-left">Project</span>
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        )}
      </button>

      {isExpanded && rootData && (
        <div className="mt-1 max-h-[280px] overflow-y-auto scrollbar-thin">
          {rootData.dirs.length === 0 && rootData.files.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-[var(--text-tertiary)]">Empty directory</p>
          ) : (
            <>
              {rootData.dirs.map((d) => (
                <FolderNode key={d.path} name={d.name} path={d.path} depth={0} />
              ))}
              {rootData.files.map((f) => (
                <FileNode key={f.path} name={f.name} path={f.path} depth={0} />
              ))}
            </>
          )}
        </div>
      )}

      {/* Divider */}
      <div className="mt-1 border-b border-[var(--border-default)] opacity-50" />
    </div>
  );
}
