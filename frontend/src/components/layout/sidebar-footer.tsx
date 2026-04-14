"use client";

import { User, CreditCard, Settings, Key, Cpu } from "lucide-react";
import { useTranslation } from 'react-i18next';
import Link from "next/link";
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";

function formatTokenCompact(count: number): string {
  if (count >= 1_000_000) {
    const value = count / 1_000_000;
    const rounded = value.toFixed(1);
    return `${rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded}M`;
  }
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`;
  return count.toString();
}

function ProviderStatusBadge() {
  const { t } = useTranslation('common');
  const { activeProvider } = useSettingsStore();
  const { isConnected, user } = useAuthStore();

  // BYOK provider
  if (activeProvider === "byok") {
    return (
      <Link
        href="/settings?tab=providers"
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs hover:bg-[var(--surface-secondary)] transition-colors"
      >
        <Key className="h-3 w-3 text-[var(--color-success)]" />
        <span className="text-[var(--text-secondary)]">{t('apiKey')}</span>
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]" />
      </Link>
    );
  }

  // ChatGPT provider
  if (activeProvider === "chatgpt") {
    return (
      <Link
        href="/settings?tab=providers"
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs hover:bg-[var(--surface-secondary)] transition-colors"
      >
        <CreditCard className="h-3 w-3 text-[var(--color-success)]" />
        <span className="text-[var(--text-secondary)]">ChatGPT</span>
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]" />
      </Link>
    );
  }

  // Ollama provider
  if (activeProvider === "ollama") {
    return (
      <Link
        href="/settings?tab=providers"
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs hover:bg-[var(--surface-secondary)] transition-colors"
      >
        <Cpu className="h-3 w-3 text-[var(--color-success)]" />
        <span className="text-[var(--text-secondary)]">Ollama</span>
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)]" />
      </Link>
    );
  }

  // No provider set
  return (
    <Link
      href="/settings?tab=providers"
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--text-tertiary)] hover:bg-[var(--surface-secondary)] transition-colors"
    >
      <Settings className="h-3 w-3" />
      <span>{t('setUpProvider')}</span>
    </Link>
  );
}

export function SidebarFooter() {
  const { t } = useTranslation('common');
  const { isConnected, user } = useAuthStore();

  const displayName = isConnected && user ? user.email.split("@")[0] : t('localUser');

  return (
    <div className="border-t border-[var(--border-default)]">
      <ProviderStatusBadge />
      <div className="flex items-center gap-3 px-3 py-3.5">
        {/* User avatar */}
        <div className="h-9 w-9 rounded-full bg-[var(--surface-tertiary)] flex items-center justify-center shrink-0">
          <User className="h-[18px] w-[18px] text-[var(--text-secondary)]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate">{displayName}</p>
        </div>
        <Link
          href="/settings"
          className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-secondary)] transition-colors shrink-0"
          aria-label={t('settings')}
        >
          <Settings className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
