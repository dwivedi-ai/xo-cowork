"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Eye, EyeOff, Plus, Trash2, Save, RefreshCw, Check, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";
import { cn } from "@/lib/utils";

// Shapes kept in sync with xo-cowork-api docs/bff-endpoints-design.md §9.2.
interface SecretSummary {
  key: string;
  is_set: boolean;
  preview: string | null;
}

interface ListSecretsResponse {
  items: SecretSummary[];
  total: number;
}

interface RevealResponse {
  key: string;
  value: string;
}

/** Per-row UI state. Combines what came from the server with the user's edits. */
interface Row {
  key: string;
  preview: string | null;
  is_set: boolean;
  /** User-entered new value; null = unchanged. */
  draftValue: string | null;
  /** Cached response from /reveal so the eye-toggle doesn't refetch. */
  revealedValue: string | null;
  /** True for rows added in the UI (not yet persisted). */
  isNew: boolean;
  /** Existing rows can be soft-deleted (toggle until Save). */
  isDeleted: boolean;
}

function rowFromSummary(s: SecretSummary): Row {
  return {
    key: s.key,
    preview: s.preview,
    is_set: s.is_set,
    draftValue: null,
    revealedValue: null,
    isNew: false,
    isDeleted: false,
  };
}

function newEmptyRow(): Row {
  return {
    key: "",
    preview: null,
    is_set: false,
    draftValue: "",
    revealedValue: null,
    isNew: true,
    isDeleted: false,
  };
}

interface EntryRowProps {
  row: Row;
  index: number;
  onKeyChange: (index: number, value: string) => void;
  onValueChange: (index: number, value: string) => void;
  onToggleReveal: (index: number, currentlyRevealed: boolean) => Promise<void> | void;
  onDelete: (index: number) => void;
}

function EntryRow({
  row, index, onKeyChange, onValueChange, onToggleReveal, onDelete,
}: EntryRowProps) {
  const [revealLoading, setRevealLoading] = useState(false);
  const hasFetchedValue = row.revealedValue !== null;
  const hasDraft = row.draftValue !== null;

  const shownValue =
    hasDraft
      ? row.draftValue ?? ""
      : hasFetchedValue
        ? row.revealedValue ?? ""
        : "";

  const inputType = hasDraft || hasFetchedValue ? "text" : "password";
  const placeholder =
    !hasDraft && !hasFetchedValue
      ? row.preview ?? "value"
      : "value";

  const handleToggleReveal = useCallback(async () => {
    if (row.isNew) return;
    setRevealLoading(true);
    try {
      await onToggleReveal(index, hasFetchedValue);
    } finally {
      setRevealLoading(false);
    }
  }, [row.isNew, hasFetchedValue, index, onToggleReveal]);

  return (
    <div className={cn("flex items-center gap-2 group", row.isDeleted && "opacity-40 line-through")}>
      <Input
        value={row.key}
        onChange={(e) => onKeyChange(index, e.target.value)}
        placeholder="KEY"
        className="font-mono text-xs h-8 w-52 shrink-0 bg-[var(--surface-secondary)] border-[var(--border-default)]"
        spellCheck={false}
        // Existing keys are immutable on the backend; to rename, delete + add.
        readOnly={!row.isNew}
        disabled={row.isDeleted}
      />
      <span className="text-[var(--text-tertiary)] text-xs shrink-0">=</span>
      <div className="relative flex-1">
        <Input
          type={inputType}
          value={shownValue}
          onChange={(e) => onValueChange(index, e.target.value)}
          placeholder={placeholder}
          className="font-mono text-xs h-8 pr-8 bg-[var(--surface-secondary)] border-[var(--border-default)]"
          spellCheck={false}
          disabled={row.isDeleted}
        />
        {!row.isNew && (
          <button
            type="button"
            onClick={handleToggleReveal}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors disabled:opacity-40"
            tabIndex={-1}
            disabled={row.isDeleted || revealLoading}
            title={hasFetchedValue ? "Hide" : "Reveal"}
          >
            {revealLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : hasFetchedValue ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDelete(index)}
        className="opacity-0 group-hover:opacity-100 text-[var(--text-tertiary)] hover:text-[var(--color-destructive)] transition-all shrink-0"
        tabIndex={-1}
        title={row.isDeleted ? "Undo delete" : "Delete"}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function SecretsTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ListSecretsResponse>(API.SECRETS.LIST);
      setRows(res.items.map(rowFromSummary));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load secrets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleKeyChange = useCallback((index: number, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, key: value } : r)));
  }, []);

  const handleValueChange = useCallback((index: number, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, draftValue: value } : r)));
  }, []);

  const handleToggleReveal = useCallback(async (index: number, currentlyRevealed: boolean) => {
    if (currentlyRevealed) {
      // Collapse — clear cached revealed value. The draft (if any) is preserved.
      setRows((prev) =>
        prev.map((r, i) => (i === index ? { ...r, revealedValue: null } : r)),
      );
      return;
    }
    const row = rows[index];
    if (!row || row.isNew) return;
    try {
      const res = await api.get<RevealResponse>(API.SECRETS.REVEAL(row.key));
      setRows((prev) =>
        prev.map((r, i) => (i === index ? { ...r, revealedValue: res.value } : r)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reveal value");
    }
  }, [rows]);

  const handleDelete = useCallback((index: number) => {
    setRows((prev) => {
      const r = prev[index];
      if (!r) return prev;
      if (r.isNew) {
        // Hard-remove new rows from the array — nothing to undo.
        return prev.filter((_, i) => i !== index);
      }
      // Existing rows toggle isDeleted so the user can undo before Save.
      return prev.map((row, i) => (i === index ? { ...row, isDeleted: !row.isDeleted } : row));
    });
  }, []);

  const handleAdd = useCallback(() => {
    setRows((prev) => [...prev, newEmptyRow()]);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const ops: Promise<unknown>[] = [];
      for (const row of rows) {
        if (row.isDeleted && !row.isNew) {
          ops.push(api.delete(API.SECRETS.ITEM(row.key)));
          continue;
        }
        if (row.isNew && !row.isDeleted) {
          const key = row.key.trim();
          if (!key || row.draftValue === null) continue;
          ops.push(api.patch(API.SECRETS.ITEM(key), { value: row.draftValue }));
          continue;
        }
        if (row.draftValue !== null && !row.isDeleted) {
          ops.push(api.patch(API.SECRETS.ITEM(row.key), { value: row.draftValue }));
        }
      }
      await Promise.all(ops);
      await load();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save secrets");
    } finally {
      setSaving(false);
    }
  }, [rows, load]);

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-start justify-between mb-1">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Secrets</h2>
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
              Environment variables your agents can read. Click the eye to reveal a value.
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
          {rows.length === 0 && (
            <p className="text-xs text-[var(--text-tertiary)] py-2">
              No entries found. Add one below.
            </p>
          )}
          {rows.map((row, i) => (
            <EntryRow
              key={row.isNew ? `new-${i}` : row.key}
              row={row}
              index={i}
              onKeyChange={handleKeyChange}
              onValueChange={handleValueChange}
              onToggleReveal={handleToggleReveal}
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
