"use client";

import { useState, useEffect, useCallback } from "react";
import { Eye, EyeOff, Plus, Trash2, Save, RefreshCw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface EnvEntry {
  key: string;
  value: string;
}

interface EnvResponse {
  entries: EnvEntry[];
}

interface EntryRowProps {
  entry: EnvEntry;
  index: number;
  onChange: (index: number, field: "key" | "value", value: string) => void;
  onDelete: (index: number) => void;
}

function EntryRow({ entry, index, onChange, onDelete }: EntryRowProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="flex items-center gap-2 group">
      <Input
        value={entry.key}
        onChange={(e) => onChange(index, "key", e.target.value)}
        placeholder="KEY"
        className="font-mono text-xs h-8 w-52 shrink-0 bg-[var(--surface-secondary)] border-[var(--border-default)]"
        spellCheck={false}
      />
      <span className="text-[var(--text-tertiary)] text-xs shrink-0">=</span>
      <div className="relative flex-1">
        <Input
          type={revealed ? "text" : "password"}
          value={entry.value}
          onChange={(e) => onChange(index, "value", e.target.value)}
          placeholder="value"
          className="font-mono text-xs h-8 pr-8 bg-[var(--surface-secondary)] border-[var(--border-default)]"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          tabIndex={-1}
        >
          {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
      <button
        type="button"
        onClick={() => onDelete(index)}
        className="opacity-0 group-hover:opacity-100 text-[var(--text-tertiary)] hover:text-[var(--color-destructive)] transition-all shrink-0"
        tabIndex={-1}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function SecretsTab() {
  const [entries, setEntries] = useState<EnvEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<EnvResponse>(API.SECRETS.ENV);
      setEntries(res.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load secrets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleChange = useCallback((index: number, field: "key" | "value", value: string) => {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, [field]: value } : e)));
  }, []);

  const handleDelete = useCallback((index: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAdd = useCallback(() => {
    setEntries((prev) => [...prev, { key: "", value: "" }]);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await api.put(API.SECRETS.ENV, { entries });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save secrets");
    } finally {
      setSaving(false);
    }
  }, [entries]);

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-start justify-between mb-1">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Secrets</h2>
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
              Environment variables loaded by OpenClaw from{" "}
              <code className="font-mono">~/.openclaw/.env</code>
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors disabled:opacity-40"
            title="Reload"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </section>

      <Separator />

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex items-center gap-2">
              <div className="h-8 w-52 rounded-md bg-[var(--surface-secondary)] animate-pulse" />
              <div className="h-8 flex-1 rounded-md bg-[var(--surface-secondary)] animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {entries.length === 0 && (
            <p className="text-xs text-[var(--text-tertiary)] py-2">
              No entries found. Add one below.
            </p>
          )}
          {entries.map((entry, i) => (
            <EntryRow
              key={i}
              entry={entry}
              index={i}
              onChange={handleChange}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs text-[var(--color-destructive)]">{error}</p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={handleAdd}
          disabled={loading}
        >
          <Plus className="h-3.5 w-3.5" />
          Add variable
        </Button>

        <Button
          size="sm"
          className="h-7 text-xs gap-1.5 ml-auto"
          onClick={handleSave}
          disabled={loading || saving}
        >
          {saved ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Saved
            </>
          ) : saving ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" />
              Save
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
