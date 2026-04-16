"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Copy, Check, ChevronDown } from "lucide-react";
import { useMermaid } from "@/hooks/use-mermaid";
import { cn } from "@/lib/utils";

interface MermaidBlockProps {
  code: string;
  className?: string;
}

export function MermaidBlock({ code, className }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { renderMermaid, isReady } = useMermaid();

  useEffect(() => {
    if (!isReady || !containerRef.current) return;

    const render = async () => {
      try {
        setError(null);
        const { svg } = await renderMermaid(code);
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to render diagram");
      }
    };

    render();
  }, [code, isReady, renderMermaid]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);

  // Error state — graceful fallback: show the code block with a small failure pill.
  if (error) {
    const firstErrorLine = error.split("\n").find((l) => l.trim().length > 0) ?? error;
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] my-3 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-default)] bg-[var(--surface-primary)]">
          <AlertCircle className="h-3.5 w-3.5 text-[var(--text-tertiary)] shrink-0" />
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">Diagram failed to render</span>
          <span className="text-[11px] text-[var(--text-tertiary)]">·</span>
          <span className="text-[11px] text-[var(--text-tertiary)] truncate">mermaid</span>
          <button
            type="button"
            onClick={handleCopy}
            className="ml-auto inline-flex items-center justify-center h-6 w-6 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)] transition-colors"
            aria-label={copied ? "Copied" : "Copy source"}
          >
            {copied ? <Check className="h-3 w-3 text-[var(--color-success)]" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
        <pre className="px-3 py-2.5 text-[12px] leading-relaxed text-[var(--text-secondary)] overflow-x-auto font-mono whitespace-pre">
          <code>{code}</code>
        </pre>
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className="w-full flex items-center gap-1.5 px-3 py-1.5 border-t border-[var(--border-default)] text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface-primary)] transition-colors"
          aria-expanded={detailsOpen}
        >
          <ChevronDown className={`h-3 w-3 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
          <span>{detailsOpen ? "Hide parser output" : "Show parser output"}</span>
          {!detailsOpen && (
            <span className="ml-auto truncate text-[var(--text-tertiary)]">{firstErrorLine}</span>
          )}
        </button>
        {detailsOpen && (
          <pre className="px-3 py-2 text-[11px] leading-relaxed text-[var(--text-tertiary)] bg-[var(--surface-primary)] border-t border-[var(--border-default)] overflow-x-auto whitespace-pre-wrap font-mono">
            {error}
          </pre>
        )}
      </div>
    );
  }

  // Loading state
  if (!isReady) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-8 my-3 text-center">
        <div className="text-sm text-[var(--text-secondary)]">Loading diagram...</div>
      </div>
    );
  }

  // Normal rendering
  return (
    <div
      ref={containerRef}
      className={cn(
        "mermaid-container rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4 my-3 overflow-x-auto",
        className
      )}
    />
  );
}
