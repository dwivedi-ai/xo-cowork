"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Loader2, Download, Play, Square, RotateCw, RefreshCw, Eye, EyeOff, ExternalLink, Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { API, getBackendUrl, resolveCoworkApiUrl } from "@/lib/constants";
import { api, ApiError } from "@/lib/api";
import {
  useChannels,
  useOpenClawStatus,
  useOpenClawStart,
  useOpenClawStop,
  useAddChannel,
  useRemoveChannel,
} from "@/hooks/use-channels";
import { WhatsAppIcon, DiscordIcon, TelegramIcon, SlackIcon } from "@/components/icons/platform-icons";
import type { ChannelInfo, PlatformDef } from "@/types/channels";

/* ------------------------------------------------------------------ */
/* Tab content (embedded in Settings)                                  */
/* ------------------------------------------------------------------ */

export function RemoteTabContent() {
  return <OpenClawSection />;
}



/* ------------------------------------------------------------------ */
/* OpenClaw Channels Section                                           */
/* ------------------------------------------------------------------ */

const PLATFORMS: PlatformDef[] = [
  { id: "whatsapp", name: "WhatsApp", icon: <WhatsAppIcon size={18} />, color: "text-[#25D366]", auth: "qr",
    help: "Scan QR code with your phone to link WhatsApp" },
  { id: "discord", name: "Discord", icon: <DiscordIcon size={18} />, color: "text-[#5865F2]", auth: "token",
    help: "Create a bot at Discord Developer Portal",
    helpUrl: "https://discord.com/developers/applications",
    fields: [{ key: "token", label: "Bot Token", placeholder: "Paste Discord bot token", secret: true }] },
  { id: "telegram", name: "Telegram", icon: <TelegramIcon size={18} />, color: "text-[#26A5E4]", auth: "token",
    help: "Get a token from @BotFather on Telegram",
    helpUrl: "https://t.me/BotFather",
    fields: [{ key: "token", label: "Bot Token", placeholder: "123456:ABC-DEF...", secret: true }] },
  { id: "slack", name: "Slack", icon: <SlackIcon size={18} />, color: "text-[#E01E5A]", auth: "token",
    help: "Create an app at api.slack.com/apps",
    helpUrl: "https://api.slack.com/apps",
    fields: [
      { key: "bot_token", label: "Bot Token", placeholder: "xoxb-...", secret: true },
      { key: "app_token", label: "App Token", placeholder: "xapp-...", secret: true },
    ] },
];

function OpenClawSection() {
  const { t } = useTranslation("settings");
  const { data: clawStatus, refetch: refetchClaw } = useOpenClawStatus();
  const { data: channelsData, refetch: refetchChannels } = useChannels();
  const startClaw = useOpenClawStart();
  const stopClaw = useOpenClawStop();
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const [gatewayRestarting, setGatewayRestarting] = useState(false);

  const restartGateway = useCallback(async () => {
    setGatewayRestarting(true);
    try {
      const res = await api.post<{
        status: string;
        output?: string;
        error?: string | null;
      }>(resolveCoworkApiUrl(API.GATEWAY.RESTART));
      if (res.status === "restarted") {
        toast.success(t("gatewayRestarted"));
        refetchClaw();
      } else {
        const msg = [res.error, res.output].filter(Boolean).join("\n") || t("gatewayRestartFailed");
        toast.error(msg.length > 280 ? `${msg.slice(0, 280)}…` : msg);
      }
    } catch (e) {
      if (e instanceof ApiError) {
        const body = e.body;
        let msg = e.message;
        if (body && typeof body === "object" && "detail" in body) {
          const d = (body as { detail: unknown }).detail;
          if (typeof d === "string") msg = d;
          else if (d && typeof d === "object" && "error" in d) {
            msg = String((d as { error: unknown }).error);
          }
        }
        toast.error(msg.length > 280 ? `${msg.slice(0, 280)}…` : msg);
      } else {
        toast.error(t("gatewayRestartFailed"));
      }
    } finally {
      setGatewayRestarting(false);
    }
  }, [t, refetchClaw]);

  const installed = clawStatus?.installed ?? false;
  const running = clawStatus?.running ?? false;
  const channels = channelsData?.channels ?? {};

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold text-[var(--text-primary)]">{t("channelsTitle")}</h2>
      <p className="text-xs text-[var(--text-secondary)]">
        {t("channelsDesc")}
      </p>

      {/* OpenClaw runtime card */}
      <div className="rounded-lg border border-[var(--border-default)] p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${running ? "bg-emerald-500" : installed ? "bg-amber-400" : "bg-[var(--text-tertiary)]"}`} />
            <span className="text-xs font-medium text-[var(--text-primary)]">{t("openclawGateway")}</span>
            <span className="text-[10px] text-[var(--text-tertiary)]">
              {running ? t("gatewayRunning") : installed ? t("gatewayStopped") : t("gatewayNotInstalled")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!installed && <OpenClawSetupButton onComplete={() => refetchClaw()} />}
            {installed && !running && (
              <Button variant="outline" size="sm" className="h-7 text-[11px]"
                onClick={() => startClaw.mutate()} disabled={startClaw.isPending}>
                {startClaw.isPending ? <><Loader2 className="h-3 w-3 animate-spin" />{t("gatewayStarting")}</> : <><Play className="h-3 w-3" />{t("gatewayStart")}</>}
              </Button>
            )}
            {running && (
              <>
                <Button variant="outline" size="sm" className="h-7 text-[11px]"
                  onClick={restartGateway} disabled={gatewayRestarting}>
                  {gatewayRestarting ? <><RefreshCw className="h-3 w-3 animate-spin" />{t("gatewayRestarting")}</> : <><RefreshCw className="h-3 w-3" />{t("restartGateway")}</>}
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-[11px]"
                  onClick={() => stopClaw.mutate()} disabled={stopClaw.isPending}>
                  {stopClaw.isPending ? <><Loader2 className="h-3 w-3 animate-spin" />{t("gatewayStopping")}</> : <><Square className="h-3 w-3" />{t("gatewayStop")}</>}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Platform cards grid */}
      <div className="grid grid-cols-2 gap-2">
        {PLATFORMS.map((p) => {
          const connected = !!channels[p.id];
          const isExpanded = expandedPlatform === p.id;
          return (
            <div key={p.id} className={`rounded-lg border p-3 space-y-2 transition-colors ${
              connected ? "border-emerald-500/30 bg-emerald-500/5" : "border-[var(--border-default)]"
            } ${isExpanded ? "col-span-2" : ""}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={p.color}>{p.icon}</span>
                  <span className="text-xs font-medium text-[var(--text-primary)]">{p.name}</span>
                  {connected && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                </div>
                {!connected ? (
                  <Button variant="outline" size="sm" className="h-6 text-[10px] px-2"
                    disabled={!running && !isExpanded}
                    onClick={() => setExpandedPlatform(isExpanded ? null : p.id)}>
                    {isExpanded ? t("channelCancel") : t("channelConnect")}
                  </Button>
                ) : (
                  <RemoveChannelButton channel={p.id} onRemoved={() => refetchChannels()} />
                )}
              </div>

              {/* Expanded: setup form (stays visible during login even if gateway restarts) */}
              {isExpanded && (
                <div className="pt-1">
                  {p.auth === "qr" ? (
                    <QrLoginFlow channel={p.id} onDone={() => {
                      setExpandedPlatform(null);
                      // Auto-start gateway if it was stopped during login
                      if (!running) startClaw.mutate();
                      setTimeout(() => refetchChannels(), 2000);
                    }} />
                  ) : (
                    <TokenForm platform={p} onDone={() => { setExpandedPlatform(null); refetchChannels(); }} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!running && installed && (
        <p className="text-center text-[11px] text-[var(--text-tertiary)]">
          {t("gatewayHint")}
        </p>
      )}
    </div>
  );
}

/** Token-based channel setup form (Discord, Telegram, Slack, Feishu). */
function TokenForm({ platform, onDone }: { platform: PlatformDef; onDone: () => void }) {
  const { t } = useTranslation("settings");
  const [values, setValues] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const addChannel = useAddChannel();

  const handleSubmit = async () => {
    setError(null);
    const body: Record<string, string> = { channel: platform.id };
    for (const f of platform.fields || []) {
      if (!values[f.key]?.trim()) {
        setError(t("channelFieldRequired", { field: t(`fieldLabel_${f.key}`, f.label) }));
        return;
      }
      body[f.key] = values[f.key].trim();
    }

    addChannel.mutate(body, {
      onSuccess: (result) => {
        if (result.ok) { onDone(); }
        else { setError(result.message); }
      },
      onError: (e) => setError(String(e)),
    });
  };

  return (
    <div className="space-y-2">
      {platform.fields?.map((f) => (
        <div key={f.key} className="relative">
          <label className="text-[10px] text-[var(--text-tertiary)] mb-0.5 block">{t(`fieldLabel_${platform.id}_${f.key}`, t(`fieldLabel_${f.key}`, f.label))}</label>
          <div className="relative">
            <input
              type={f.secret && !showSecret[f.key] ? "password" : "text"}
              value={values[f.key] || ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={t(`fieldPlaceholder_${platform.id}_${f.key}`, f.placeholder)}
              autoComplete="one-time-code"
              className="w-full h-7 rounded-md border border-[var(--border-default)] bg-transparent px-2.5 pr-7 text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--border-focus)]"
            />
            {f.secret && (
              <button className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
                onClick={() => setShowSecret((s) => ({ ...s, [f.key]: !s[f.key] }))}>
                {showSecret[f.key] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
            )}
          </div>
        </div>
      ))}

      {platform.helpUrl && (
        <a href={platform.helpUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
          <ExternalLink className="h-2.5 w-2.5" />{t(`platformHelp_${platform.id}`, platform.help)}
        </a>
      )}

      {error && (
        <p className="text-[11px] text-red-400">{error}</p>
      )}

      <Button size="sm" className="h-7 text-[11px] w-full" onClick={handleSubmit}
        disabled={addChannel.isPending}>
        {addChannel.isPending ? <><Loader2 className="h-3 w-3 animate-spin" />{t("channelConnecting")}</> : t("channelConnect")}
      </Button>
    </div>
  );
}

/** WhatsApp QR login flow (SSE streaming). */
function QrLoginFlow({ channel, onDone }: { channel: string; onDone: () => void }) {
  const { t } = useTranslation("settings");
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrText, setQrText] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("qrPreparing");
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        const backendUrl = await getBackendUrl();
        const resp = await fetch(`${backendUrl}${API.CHANNELS.LOGIN}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel }),
        });

        if (!resp.ok || !resp.body) {
          setError(t("qrFailedLogin"));
          return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.status === "qr") {
                setQrUrl(data.qr_data_url);
                setQrText(null);
                setStatus("qrScanPhone");
              } else if (data.status === "qr_text") {
                setQrText(data.qr_text);
                setQrUrl(null);
                setStatus("qrScanWhatsapp");
              } else if (data.status === "connected" || data.status === "done") {
                setStatus(data.status === "connected" ? "qrConnected" : "qrDone");
                setTimeout(onDone, 1000);
                return;
              } else if (data.status === "error") {
                setError(data.message);
                return;
              } else if (data.status === "waiting") {
                setStatus(data.message || "qrWaiting");
              } else if (data.message) {
                setStatus(data.message);
              }
            } catch { /* ignore */ }
          }
        }
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [channel, onDone]);

  if (error) {
    return <p className="text-[11px] text-red-400 py-2">{error}</p>;
  }

  const hasQr = qrUrl || qrText;

  return (
    <div className="space-y-2 py-1">
      {qrUrl ? (
        <div className="flex justify-center p-3 rounded-lg bg-white">
          <img src={qrUrl} alt={t("qrCodeAlt")} className="w-48 h-48" style={{ imageRendering: "pixelated" }} />
        </div>
      ) : qrText ? (
        <div className="flex justify-center p-2 rounded-lg bg-white overflow-x-auto">
          <pre className="text-black text-[6px] leading-[7px] font-mono whitespace-pre select-none">{qrText}</pre>
        </div>
      ) : (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
        </div>
      )}
      <p className="text-center text-[11px] text-[var(--text-secondary)]">{t(status, status)}</p>
    </div>
  );
}

/** Remove/disconnect channel button. */
function RemoveChannelButton({ channel, onRemoved }: { channel: string; onRemoved: () => void }) {
  const { t } = useTranslation("settings");
  const removeChannel = useRemoveChannel();
  const [removed, setRemoved] = useState(false);

  if (removed) {
    return <span className="text-[10px] text-[var(--text-tertiary)]">{t("channelRemoved")}</span>;
  }

  const handleRemove = async () => {
    try {
      await removeChannel.mutateAsync({ channel });
    } catch { /* ignore */ }
    setRemoved(true);
    // Delay slightly to let backend update
    setTimeout(onRemoved, 500);
  };

  return (
    <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 text-red-400 border-red-400/30 hover:bg-red-400/10"
      disabled={removeChannel.isPending}
      onClick={handleRemove}>
      {removeChannel.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Unplug className="h-3 w-3" />{t("channelDisconnect")}</>}
    </Button>
  );
}

/** SSE-streaming setup button (install + start OpenClaw). */
function OpenClawSetupButton({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation("settings");
  const [progress, setProgress] = useState<{ status: string; message?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startSetup = useCallback(async () => {
    setError(null);
    setProgress({ status: "starting" });
    try {
      const backendUrl = await getBackendUrl();
      const resp = await fetch(`${backendUrl}${API.CHANNELS.OPENCLAW_SETUP}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
      });
      if (!resp.ok || !resp.body) { setError(t("setupFailed")); setProgress(null); return; }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            setProgress(data);
            if (data.status === "error") { setError(data.message || t("setupFailed")); setProgress(null); return; }
            if (data.status === "ready") { setProgress(null); onComplete(); return; }
          } catch { /* ignore */ }
        }
      }
      setProgress(null);
      onComplete();
    } catch (e) { setError(String(e)); setProgress(null); }
  }, [onComplete]);

  if (error) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-red-400 max-w-[200px] truncate">{error}</span>
        <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={startSetup}>
          <RotateCw className="h-3 w-3" />{t("setupRetry")}
        </Button>
      </div>
    );
  }
  if (progress) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="max-w-[200px] truncate">{progress.message || progress.status}</span>
      </div>
    );
  }
  return (
    <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={startSetup}>
      <Download className="h-3 w-3" />{t("setupSetUp")}
    </Button>
  );
}
