"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  PlugZap,
  Radio,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  disconnectUpstox,
  exchangeUpstoxCode,
  getApiStatus,
  getUpstoxAuthUrl,
  type ApiStatus,
} from "@/services/api";
import { useToast } from "@/components/toast-provider";
import { cn } from "@/lib/utils";

type ProviderState = NonNullable<ApiStatus["providers"]>[string];

function providerTone(provider?: ProviderState) {
  if (provider?.connected) return "text-profit";
  if (provider?.configured) return "text-[var(--terminal-accent)]";
  return "text-loss";
}

function formatTime(value?: string | null) {
  if (!value) return "never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "unknown";
  return parsed.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ProviderRow({ label, provider }: { label: string; provider?: ProviderState }) {
  const connected = Boolean(provider?.connected);
  const configured = Boolean(provider?.configured);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-[color:var(--terminal-grid)] px-3 py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {connected ? (
            <CheckCircle2 size={13} className="text-profit" />
          ) : configured ? (
            <Radio size={13} className="text-[var(--terminal-accent)]" />
          ) : (
            <AlertTriangle size={13} className="text-loss" />
          )}
          <span className="text-[11px] font-bold uppercase tracking-[0.1em]">{label}</span>
        </div>
        <div className="terminal-subtle mt-1 truncate font-mono text-[10px]">
          {connected ? "connected" : configured ? "configured, waiting" : provider?.reason ?? "not configured"}
        </div>
      </div>
      <div className="text-right font-mono text-[10px]">
        <div className={providerTone(provider)}>{provider?.rate_limited_for_sec ? `${provider.rate_limited_for_sec}s cooldown` : connected ? "LIVE" : "IDLE"}</div>
        <div className="terminal-subtle mt-1">{formatTime(provider?.last_success_at)}</div>
      </div>
    </div>
  );
}

export function ProviderStatusPanel() {
  const { toast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ApiStatus | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (force = false) => {
    const next = await getApiStatus(force);
    setStatus(next);
  }, []);

  const exchangeCode = useCallback(async (code: string) => {
    const clean = code.trim();
    if (!clean) return;
    setBusy(true);
    try {
      const result = await exchangeUpstoxCode(clean);
      if (!result?.connected) {
        toast({ title: "Upstox Connect Failed", description: "Token exchange did not complete.", variant: "error" });
        return;
      }
      setManualCode("");
      toast({ title: "Upstox Connected", description: `Token source: ${result.token_source ?? "runtime"}.`, variant: "success" });
      await refresh(true);
    } finally {
      setBusy(false);
    }
  }, [refresh, toast]);

  useEffect(() => {
    void refresh(true);
    const timer = window.setInterval(() => void refresh(false), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) return;

    const storageKey = `equityflow-upstox-oauth-${code}`;
    if (window.sessionStorage.getItem(storageKey)) return;
    window.sessionStorage.setItem(storageKey, "1");
    void exchangeCode(code);

    params.delete("code");
    params.delete("state");
    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }, [exchangeCode]);

  const upstox = status?.providers?.upstox;
  const groww = status?.providers?.groww;
  const preferred = status?.provider ?? "upstox";
  const isConnected = Boolean(status?.connected);
  const degraded = status?.degraded_reason;

  const connect = async () => {
    setBusy(true);
    try {
      const auth = await getUpstoxAuthUrl();
      if (!auth?.configured || !auth.url) {
        toast({
          title: "Upstox OAuth Not Ready",
          description: `Missing ${(auth?.missing ?? ["UPSTOX_API_KEY", "UPSTOX_REDIRECT_URI"]).join(", ")}.`,
          variant: "error",
        });
        return;
      }
      window.open(auth.url, "_blank", "noopener,noreferrer");
      toast({ title: "Upstox Login Opened", description: "Approve login, then paste the returned code here if the app does not auto-detect it.", variant: "success" });
      setOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectUpstox();
      toast({ title: "Upstox Disconnected", description: "Runtime token removed from this machine.", variant: "success" });
      await refresh(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={containerRef} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "terminal-input flex h-9 items-center gap-2 rounded-sm px-2.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors",
          open && "border-[color:var(--terminal-accent)] bg-[var(--terminal-hover)]"
        )}
      >
        <span className={cn("flex h-2 w-2 rounded-full", isConnected ? "bg-profit" : "bg-loss")} />
        <ServerCog size={13} className={isConnected ? "text-profit" : "text-loss"} />
        <span className="hidden lg:inline">{preferred}</span>
      </button>

      {open && (
        <div className="terminal-panel absolute right-0 top-11 z-50 w-[min(360px,calc(100vw-24px))] overflow-hidden shadow-modal">
          <div className="terminal-panel-header px-3 py-2">
            <div>
              <div className="terminal-title">Provider Status</div>
              <div className="terminal-subtle mt-1 font-mono text-[10px]">
                Preferred: {preferred.toUpperCase()}{degraded ? ` / ${degraded}` : ""}
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="terminal-action flex h-7 w-7 px-0">
              <X size={13} />
            </button>
          </div>

          <ProviderRow label="Upstox" provider={upstox} />
          <ProviderRow label="Groww" provider={groww} />

          <div className="space-y-2 border-t border-[color:var(--terminal-border)] p-3">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={connect} disabled={busy} className="terminal-action gap-1.5">
                <PlugZap size={12} />
                Connect
              </button>
              <button type="button" onClick={() => void refresh(true)} disabled={busy} className="terminal-action gap-1.5">
                <RefreshCw size={12} />
                Refresh
              </button>
            </div>

            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value)}
                placeholder="Paste Upstox auth code"
                className="terminal-input h-8 rounded-sm px-2 font-mono text-[11px] outline-none"
              />
              <button
                type="button"
                disabled={busy || !manualCode.trim()}
                onClick={() => void exchangeCode(manualCode)}
                className="terminal-action h-8 gap-1.5"
              >
                <ShieldCheck size={12} />
                Verify
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px]">
              <span className="terminal-subtle">
                Upstox token: {upstox?.token_source || "none"} / expiry {formatTime(upstox?.token_expires_at)}
              </span>
              <button type="button" onClick={disconnect} disabled={busy || !upstox?.configured} className="inline-flex items-center gap-1 text-loss disabled:text-[var(--terminal-disabled-fg)]">
                <ExternalLink size={10} />
                disconnect
              </button>
            </div>

            {upstox?.missing_auth_fields && upstox.missing_auth_fields.length > 0 && (
              <div className="rounded-sm border border-loss/30 bg-loss/10 px-2 py-1.5 font-mono text-[10px] text-loss">
                Missing OAuth env: {upstox.missing_auth_fields.join(", ")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
