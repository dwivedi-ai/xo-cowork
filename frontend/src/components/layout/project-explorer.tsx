"use client";

import { useState, useCallback, useRef, useEffect } from "react";
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
  FolderPlus,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";
import { useArtifactStore } from "@/stores/artifact-store";
import { artifactTypeFromExtension, languageFromExtension } from "@/lib/artifacts";
import { useWorkspaceConfig } from "@/hooks/use-workspace-config";

interface TreeEntry {
  name: string;
  relative_path: string;
}

interface ProjectTreeResponse {
  project_id: string;
  relative_path: string;
  parent_relative_path: string | null;
  dirs: TreeEntry[];
  files: TreeEntry[];
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
  projectId: string;
  relativePath: string;
  depth: number;
}

function FolderNode({ name, projectId, relativePath, depth }: FolderNodeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [children, setChildren] = useState<{ dirs: TreeEntry[]; files: TreeEntry[] } | null>(null);

  const toggle = useCallback(async () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    if (!children) {
      setLoading(true);
      try {
        const res = await api.get<ProjectTreeResponse>(
          API.PROJECTS.TREE(projectId, relativePath || undefined),
        );
        setChildren({ dirs: res.dirs, files: res.files });
      } catch {
        setChildren({ dirs: [], files: [] });
      } finally {
        setLoading(false);
      }
    }
    setIsOpen(true);
  }, [isOpen, children, projectId, relativePath]);

  const Icon = isOpen ? FolderOpen : FolderClosed;
  const Chevron = isOpen ? ChevronDown : ChevronRight;

  return (
    <div>
      <button
        onClick={toggle}
        className={cn(
          "flex items-center gap-1.5 w-full py-1.5 text-[13px] text-[var(--text-secondary)]",
          "hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-active)] rounded-lg transition-colors",
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
            <FolderNode
              key={`${projectId}/${d.relative_path}`}
              name={d.name}
              projectId={projectId}
              relativePath={d.relative_path}
              depth={depth + 1}
            />
          ))}
          {children.files.map((f) => (
            <FileNode
              key={`${projectId}/${f.relative_path}`}
              name={f.name}
              projectId={projectId}
              relativePath={f.relative_path}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FileNodeProps {
  name: string;
  projectId: string;
  relativePath: string;
  depth: number;
}

function FileNode({ name, projectId, relativePath, depth }: FileNodeProps) {
  const Icon = fileIcon(name);
  const { workspaceRoot } = useWorkspaceConfig();

  const handleClick = () => {
    // Assemble absolute path for the artifact viewer, which still calls the
    // legacy /api/files/content endpoint. TODO: drop this assembly once the
    // viewer accepts a project_id + relative_path pair.
    const absolutePath = `${workspaceRoot}/${projectId}/${relativePath}`;
    const type = artifactTypeFromExtension(absolutePath) ?? "file-preview";
    useArtifactStore.getState().openArtifact({
      id: `project-${absolutePath}`,
      type,
      title: name,
      content: "",
      filePath: absolutePath,
      language: languageFromExtension(absolutePath),
    });
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex items-center gap-1.5 w-full py-1.5 text-[13px] text-[var(--text-tertiary)]",
        "hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-active)] rounded-lg transition-colors cursor-pointer",
      )}
      style={{ paddingLeft: `${depth * 12 + 8 + 15}px`, paddingRight: "8px" }}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate text-left">{name}</span>
    </button>
  );
}

/** BFF response shape — kept in sync with bff-endpoints-design.md §9.1. */
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

export function ProjectExplorer() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [rootData, setRootData] = useState<{ items: { name: string; projectId: string }[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [addingFolder, setAddingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { workspaceRoot } = useWorkspaceConfig();

  // Pre-filtered by the BFF — no client-side hidden/system filtering.
  // FolderNode drills using the BFF tree endpoint (also pre-filtered),
  // so this component never sees .xo / .git / agent files at all.
  const loadRoot = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<ListProjectsResponse>(API.PROJECTS.LIST);
      setRootData({
        items: res.items.map((it) => ({
          name: it.display_name,
          projectId: it.id,
        })),
      });
    } catch {
      setRootData({ items: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = useCallback(async () => {
    if (isExpanded) {
      setIsExpanded(false);
      return;
    }
    if (!rootData) {
      await loadRoot();
    }
    setIsExpanded(true);
  }, [isExpanded, rootData, loadRoot]);

  const openNewFolder = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setFolderName("");
    setAddingFolder(true);
  }, []);

  const cancelNewFolder = useCallback(() => {
    setAddingFolder(false);
    setFolderName("");
  }, []);

  const confirmNewFolder = useCallback(async () => {
    const name = folderName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await api.post(API.FILES.MKDIR, { path: `${workspaceRoot}/${name}`, scaffold: true });
      setAddingFolder(false);
      setFolderName("");
      await loadRoot();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create folder";
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }, [folderName, loadRoot]);

  useEffect(() => {
    if (addingFolder) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [addingFolder]);

  return (
    <div className="px-2 pb-1">
      <button
        onClick={toggle}
        className={cn(
          "flex items-center gap-3 w-full px-3 py-2 rounded-xl text-[13px] transition-all duration-150 ease-out",
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
        <span className="flex-1 text-left">Projects</span>
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        )}
      </button>

      {isExpanded && rootData && (
        <div className="mt-1 max-h-[280px] overflow-y-auto scrollbar-thin">
          {/* New folder button */}
          <div className="flex justify-end px-1 pb-1">
            <button
              type="button"
              onClick={openNewFolder}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-active)] transition-colors"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              New project
            </button>
          </div>

          {/* Inline new-folder input */}
          {addingFolder && (
            <div className="flex items-center gap-1 px-2 pb-1.5">
              <FolderClosed className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
              <input
                ref={inputRef}
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void confirmNewFolder();
                  if (e.key === "Escape") cancelNewFolder();
                }}
                placeholder="Project name"
                className={cn(
                  "flex-1 min-w-0 bg-[var(--surface-secondary)] text-[13px] text-[var(--text-primary)]",
                  "border border-[var(--border-focus)] rounded-md px-2 py-0.5 outline-none",
                  "placeholder:text-[var(--text-quaternary)]",
                )}
              />
              <button
                type="button"
                onClick={() => void confirmNewFolder()}
                disabled={!folderName.trim() || creating}
                className="text-[var(--text-tertiary)] hover:text-[var(--brand-primary)] disabled:opacity-40 transition-colors"
              >
                {creating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={cancelNewFolder}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {rootData.items.length === 0 && !addingFolder ? (
            <p className="px-3 py-2 text-[11px] text-[var(--text-tertiary)]">No projects yet</p>
          ) : (
            <>
              {rootData.items.map((it) => (
                <FolderNode
                  key={it.projectId}
                  name={it.name}
                  projectId={it.projectId}
                  relativePath=""
                  depth={0}
                />
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
