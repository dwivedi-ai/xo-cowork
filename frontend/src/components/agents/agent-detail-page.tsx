"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, Loader2, FileText, Code, Eye, BookOpen, Ghost, User, Bot } from "lucide-react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAgentDetail, useUpdateAgent } from "@/hooks/use-agents";
import { ApiError } from "@/lib/api";
import type { AgentFullDetail } from "@/types/agent";

function formatApiError(err: unknown): string {
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-primary)] p-5 shadow-[var(--shadow-sm)]">
      <h2 className="text-sm font-semibold tracking-tight text-[var(--text-primary)] mb-3">{title}</h2>
      {children}
    </section>
  );
}

/** Tab definitions for the 4 agent workspace files */
const AGENT_FILE_TABS = [
  { id: "AGENTS.md", label: "Agents", icon: Bot },
  { id: "SOUL.md", label: "Soul", icon: Ghost },
  { id: "IDENTITY.md", label: "Identity", icon: BookOpen },
  { id: "USER.md", label: "User", icon: User },
] as const;

type AgentFileTabId = (typeof AGENT_FILE_TABS)[number]["id"];

/** Tabbed markdown viewer for agent workspace files — mirrors ProjectTabs style. */
function AgentFileTabs({ files }: { files: Record<string, string | null> }) {
  const availableTabs = AGENT_FILE_TABS.filter((t) => files[t.id] != null && files[t.id] !== "");
  const [activeTab, setActiveTab] = useState<AgentFileTabId>(availableTabs[0]?.id ?? "AGENTS.md");
  const [showSource, setShowSource] = useState(false);

  if (availableTabs.length === 0) return null;

  const content = files[activeTab] ?? "";

  return (
    <div className="w-full">
      {/* Tab bar */}
      <div className="flex gap-1 p-1 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border-default)] mb-5">
        {availableTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setShowSource(false); }}
              className={cn(
                "relative flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium transition-all duration-200",
                isActive
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="agent-file-tab-indicator"
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

      {/* Content card */}
      {content ? (
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] overflow-hidden">
          {/* File header with source toggle */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-default)] bg-[var(--surface-tertiary)]">
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">{activeTab}</span>
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

          {/* Rendered markdown or raw source */}
          <div className="max-h-[380px] overflow-y-auto scrollbar-thin">
            {showSource ? (
              <pre className="p-4 text-[13px] leading-relaxed font-mono text-[var(--text-primary)] whitespace-pre-wrap break-words">
                {content}
              </pre>
            ) : (
              <div className="p-5">
                <div className="prose max-w-none text-[var(--text-primary)] leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                    {content}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--border-default)] p-8 text-center">
          <FileText className="h-8 w-8 mx-auto mb-3 text-[var(--text-quaternary)]" />
          <p className="text-[14px] font-medium text-[var(--text-secondary)] mb-1">No content</p>
          <p className="text-[12px] text-[var(--text-tertiary)]">
            Add a <code className="px-1 py-0.5 rounded bg-[var(--surface-tertiary)] text-[var(--text-tertiary)]">{activeTab}</code> file to the agent workspace.
          </p>
        </div>
      )}
    </div>
  );
}

export function AgentDetailPage({ agentId }: { agentId: string }) {
  const { t } = useTranslation("common");
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useAgentDetail(agentId);
  const updateAgent = useUpdateAgent();

  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [model, setModel] = useState("");
  const [identityName, setIdentityName] = useState("");
  const [identityEmoji, setIdentityEmoji] = useState("");

  const hydrateForm = useCallback((d: AgentFullDetail) => {
    setDisplayName(d.display_name);
    setDescription(d.description);
    setWorkspace(d.workspace);
    setModel(d.model ?? "");
    setIdentityName(d.identity?.name ?? "");
    setIdentityEmoji(d.identity?.emoji ?? "");
  }, []);

  useEffect(() => {
    if (data) hydrateForm(data);
  }, [data, hydrateForm]);

  const handleSave = useCallback(() => {
    const name = displayName.trim();
    if (!name) return;
    updateAgent.mutate(
      {
        id: agentId,
        name,
        description,
        workspace: workspace.trim(),
        model: model.trim() === "" ? "" : model.trim(),
        identity_name: identityName.trim() === "" ? "" : identityName.trim(),
        identity_emoji: identityEmoji.trim() === "" ? "" : identityEmoji.trim(),
      },
      {
        onSuccess: () => {
          toast.success(t("agentUpdated"));
          void refetch();
        },
        onError: (err) => toast.error(t("agentUpdateFailed"), { description: formatApiError(err) }),
      },
    );
  }, [
    agentId,
    description,
    displayName,
    identityEmoji,
    identityName,
    model,
    refetch,
    t,
    updateAgent,
    workspace,
  ]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--text-tertiary)]" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Button variant="ghost" size="sm" className="mb-4 gap-2" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
          {t("agentPageBack")}
        </Button>
        <p className="text-sm text-[var(--color-destructive)]">
          {t("loadAgentFailed")}
          {error ? ` — ${formatApiError(error)}` : null}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
    <div className="mx-auto max-w-2xl px-4 py-6 pb-24">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" className="gap-2 -ml-2" onClick={() => router.back()} type="button">
          <ArrowLeft className="h-4 w-4" />
          {t("agentPageBack")}
        </Button>
        <span className="text-[11px] font-mono text-[var(--text-tertiary)]">#{data.id}</span>
      </div>

      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">{data.display_name}</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">{t("agentPageSubtitle")}</p>
      </header>

      <div className="flex flex-col gap-6">
        <Section title={t("agentPageSectionSettings")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">{t("agentDisplayName")}</label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="off" />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">{t("agentPageIdentityName")}</label>
              <Input value={identityName} onChange={(e) => setIdentityName(e.target.value)} autoComplete="off" />
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-medium text-[var(--text-secondary)]">{t("agentPageIdentityEmoji")}</label>
              <Input value={identityEmoji} onChange={(e) => setIdentityEmoji(e.target.value)} autoComplete="off" />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">{t("descriptionOptional")}</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className={cn(
                  "flex w-full rounded-[var(--radius)] border border-[var(--border-default)] bg-transparent px-3 py-2 text-sm shadow-[var(--shadow-sm)]",
                  "placeholder:text-[var(--text-tertiary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)] resize-none",
                )}
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">{t("agentWorkspacePath")}</label>
              <Input
                value={workspace}
                onChange={(e) => setWorkspace(e.target.value)}
                className="font-mono text-xs"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-[var(--text-secondary)]">{t("agentModelOptional")}</label>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="font-mono text-xs"
                placeholder="anthropic/claude-sonnet-4-6"
                autoComplete="off"
              />
              <p className="text-[11px] text-[var(--text-tertiary)]">{t("agentModelHint")}</p>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="button" disabled={!displayName.trim() || updateAgent.isPending} onClick={handleSave}>
              {updateAgent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("saveAgent")}
            </Button>
          </div>
        </Section>

        {/* Agent workspace files — tabbed markdown viewer */}
        <AgentFileTabs files={data.workspace_files} />
      </div>
    </div>
    </div>
  );
}
