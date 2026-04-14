"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAgentDetail, useUpdateAgent } from "@/hooks/use-agents";
import { ApiError } from "@/lib/api";
import { getChatRoute } from "@/lib/routes";
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

function JsonBlock({ value }: { value: unknown }) {
  const text = JSON.stringify(value ?? null, null, 2);
  return (
    <ScrollArea className="max-h-[min(24rem,50vh)] w-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)]">
      <pre className="p-3 text-[11px] leading-relaxed font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-words">
        {text}
      </pre>
    </ScrollArea>
  );
}

function MarkdownPanel({ title, content }: { title: string; content: string }) {
  return (
    <details className="group rounded-xl border border-[var(--border-default)] bg-[var(--surface-secondary)] open:ring-1 open:ring-[var(--border-heavy)]">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-tertiary)] rounded-xl">
        {title}
      </summary>
      <ScrollArea className="max-h-64 border-t border-[var(--border-default)]">
        <pre className="p-3 text-[11px] leading-relaxed font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-words">
          {content || "—"}
        </pre>
      </ScrollArea>
    </details>
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

  const workspaceEntries = Object.entries(data.workspace_files).filter(([, v]) => v != null && v !== "");

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 pb-24">
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

        <Section title={t("agentPageSectionOverview")}>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">{t("agentPageAgentId")}</dt>
              <dd className="font-mono text-[var(--text-primary)]">{data.id}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">{t("agentPageSessions")}</dt>
              <dd className="text-[var(--text-primary)]">{data.sessions.count}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">{t("agentPageWorkspaceDir")}</dt>
              <dd className="break-all font-mono text-xs text-[var(--text-secondary)]">{data.workspace}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">{t("agentPageAgentDataDir")}</dt>
              <dd className="break-all font-mono text-xs text-[var(--text-secondary)]">{data.on_disk.agent_dir}</dd>
            </div>
          </dl>
        </Section>

        <Section title={t("agentPageSectionIdentity")}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">{t("agentPageIdentityName")}</dt>
              <dd className="text-[var(--text-primary)]">{data.identity.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">{t("agentPageIdentityEmoji")}</dt>
              <dd className="text-[var(--text-primary)]">{data.identity.emoji ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">{t("agentPageBio")}</dt>
              <dd className="whitespace-pre-wrap text-[var(--text-secondary)]">{data.identity.bio || "—"}</dd>
            </div>
          </dl>
        </Section>

        <Section title={t("agentPageSectionWorkspaceFiles")}>
          {workspaceEntries.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)]">{t("agentPageNoWorkspaceFiles")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {workspaceEntries.map(([fname, content]) => (
                <MarkdownPanel key={fname} title={fname} content={content ?? ""} />
              ))}
            </div>
          )}
        </Section>

        <Section title={t("agentPageSectionModels")}>
          <p className="mb-2 text-xs text-[var(--text-tertiary)]">{t("agentPageEffectiveModel")}</p>
          <p className="mb-4 font-mono text-sm text-[var(--text-primary)]">{data.model ?? t("agentPageDefaultModel")}</p>
          <p className="mb-2 text-xs text-[var(--text-tertiary)]">{t("agentPageModelOverrideRaw")}</p>
          <JsonBlock value={data.model_raw} />
          <p className="mt-4 mb-2 text-xs text-[var(--text-tertiary)]">{t("agentPageModelsCatalog")}</p>
          <JsonBlock value={data.on_disk.models_catalog} />
          <p className="mt-4 mb-2 text-xs text-[var(--text-tertiary)]">{t("agentPageDefaultsTitle")}</p>
          <JsonBlock value={data.agents_defaults} />
        </Section>

        <Section title={t("agentPageSectionAccess")}>
          <p className="mb-2 text-xs text-[var(--text-tertiary)]">{t("agentPageAuthState")}</p>
          <JsonBlock value={data.on_disk.auth_state} />
          <p className="mt-4 mb-2 text-xs text-[var(--text-tertiary)]">{t("agentPageAuthProfiles")}</p>
          <JsonBlock value={data.on_disk.auth_profiles} />
          <p className="mt-4 mb-2 text-xs text-[var(--text-tertiary)]">{t("agentPageGlobalAuth")}</p>
          <JsonBlock value={data.openclaw_global_auth} />
        </Section>

        <Section title={t("agentPageSectionConfig")}>
          <JsonBlock value={data.config_entry} />
        </Section>

        <Section title={t("agentPageSectionSessions")}>
          <p className="mb-2 break-all font-mono text-[11px] text-[var(--text-tertiary)]">{data.sessions.index_path}</p>
          {data.sessions.session_ids.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)]">{t("agentPageNoSessions")}</p>
          ) : (
            <ul className="max-h-48 overflow-y-auto text-sm font-mono text-[var(--text-secondary)]">
              {data.sessions.session_ids.map((sid) => (
                <li key={sid}>
                  <Link href={getChatRoute(sid)} className="text-[var(--brand-primary)] hover:underline">
                    {sid}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
