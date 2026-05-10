"use client";

import { Activity, AlertTriangle, Database, RadioTower } from "lucide-react";
import { useApiDiagnostics, useApiStatus } from "@/hooks/useStockData";
import { cn } from "@/lib/utils";

function Metric({ label, value, tone = "terminal-fg" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="border border-[color:var(--terminal-grid)] bg-[var(--terminal-fill)] p-3">
      <div className="terminal-subtle text-[10px] uppercase tracking-[0.12em]">{label}</div>
      <div className={cn("terminal-number mt-1 text-lg font-bold", tone)}>{value}</div>
    </div>
  );
}

export default function DiagnosticsPage() {
  const { data: status } = useApiStatus();
  const { data, isLoading } = useApiDiagnostics();
  const providers = data?.providers ?? {};

  return (
    <div className="terminal-shell min-h-full px-4 py-5 md:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="terminal-title text-base">Provider Diagnostics</div>
          <div className="terminal-subtle mt-1 text-xs">Cache pressure, cooldowns, provider order, and stream health</div>
        </div>
        <div className="terminal-badge rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em]">
          {status?.provider ?? "unknown"} preferred
        </div>
      </div>

      {isLoading && <div className="terminal-panel p-6 text-sm terminal-subtle">Loading diagnostics...</div>}

      {data && (
        <div className="space-y-4">
          <section className="terminal-panel p-3">
            <div className="mb-3 flex items-center gap-2">
              <RadioTower size={15} className="text-[var(--terminal-accent)]" />
              <h2 className="terminal-title">Routing</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <Metric label="Provider Order" value={data.provider_order.join(" > ")} tone="text-[var(--terminal-accent)]" />
              <Metric label="Status" value={status?.connected ? "Connected" : "Degraded"} tone={status?.connected ? "text-profit" : "text-warning"} />
              <Metric label="Max Cooldown" value={`${status?.rate_limited_for_sec ?? 0}s`} tone={(status?.rate_limited_for_sec ?? 0) > 0 ? "text-warning" : "text-profit"} />
              <Metric label="Generated" value={new Date(data.generated_at).toLocaleTimeString("en-IN")} />
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-2">
            {Object.entries(providers).map(([name, provider]) => (
              <section key={name} className="terminal-panel overflow-hidden">
                <div className="terminal-panel-header">
                  <div className="flex items-center gap-2">
                    <Database size={15} className="text-[var(--terminal-accent)]" />
                    <h2 className="terminal-title">{name.toUpperCase()}</h2>
                  </div>
                  <span className={cn("font-mono text-[10px] uppercase", provider.configured ? "text-profit" : "text-warning")}>
                    {provider.configured ? "configured" : "not configured"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-3">
                  <Metric label="Cache Entries" value={provider.cache?.entries ?? 0} />
                  <Metric label="Fresh" value={provider.cache?.fresh ?? 0} tone="text-profit" />
                  <Metric label="Stale" value={provider.cache?.stale ?? 0} tone="text-warning" />
                  <Metric label="Inflight" value={provider.cache?.inflight ?? 0} tone="text-info" />
                  <Metric label="Cooldown" value={`${provider.rate_limited_for_sec ?? 0}s`} tone={(provider.rate_limited_for_sec ?? 0) > 0 ? "text-warning" : "terminal-fg"} />
                  <Metric label="Last Success" value={provider.last_success_at ? new Date(provider.last_success_at).toLocaleTimeString("en-IN") : "-"} />
                </div>
                {provider.last_error && Object.keys(provider.last_error).length > 0 && (
                  <div className="border-t border-[color:var(--terminal-grid)] p-3">
                    <div className="mb-2 flex items-center gap-2 text-warning">
                      <AlertTriangle size={13} />
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em]">Last error</span>
                    </div>
                    <pre className="max-h-36 overflow-auto rounded-sm bg-[var(--terminal-fill)] p-2 text-[10px] text-[var(--terminal-subtle)]">
                      {JSON.stringify(provider.last_error, null, 2)}
                    </pre>
                  </div>
                )}
              </section>
            ))}
          </div>

          <section className="terminal-panel p-3">
            <div className="mb-3 flex items-center gap-2">
              <Activity size={15} className="text-[var(--terminal-accent)]" />
              <h2 className="terminal-title">Stream Cache</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-5">
              <Metric label="Stocks" value={data.sse.stocks} />
              <Metric label="Commodities" value={data.sse.commodities} />
              <Metric label="Indices" value={data.sse.indices} />
              <Metric label="OHLC" value={data.sse.ohlc} />
              <Metric label="Age" value={data.sse.last_refresh_age_sec == null ? "-" : `${data.sse.last_refresh_age_sec}s`} />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
