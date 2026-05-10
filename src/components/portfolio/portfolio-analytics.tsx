"use client";

import { Activity, BarChart3, PieChart, Target, Trophy } from "lucide-react";
import { usePortfolio } from "@/hooks/usePortfolio";
import { cn, formatCurrency, formatPercentage, getPriceChangeColor } from "@/lib/utils";

function AllocationBars({ title, items }: { title: string; items: { label: string; value: number; percent: number }[] }) {
  return (
    <div className="terminal-panel overflow-hidden">
      <div className="terminal-panel-header">
        <div className="flex items-center gap-2">
          <PieChart size={13} className="text-[var(--terminal-accent)]" />
          <span className="terminal-title">{title}</span>
        </div>
      </div>
      <div className="space-y-2 p-3">
        {items.length === 0 ? (
          <div className="terminal-subtle py-4 text-center text-xs">No exposure yet</div>
        ) : (
          items.slice(0, 4).map((item) => (
            <div key={item.label}>
              <div className="mb-1 flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.08em]">
                <span className="truncate">{item.label}</span>
                <span className="terminal-subtle">{formatPercentage(item.percent)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-sm bg-[var(--terminal-fill)]">
                <div
                  className="h-full bg-[var(--terminal-accent)]"
                  style={{ width: `${Math.min(100, Math.max(0, item.percent))}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function PortfolioAnalyticsPanel() {
  const { analytics, summary } = usePortfolio();
  const best = analytics.bestTrade;
  const worst = analytics.worstTrade;
  const recentDays = analytics.dailyPnl.slice(-5).reverse();
  const stats = [
    {
      label: "Net P&L",
      value: analytics.netPnl,
      meta: `${formatCurrency(analytics.realizedPnl)} realized`,
      icon: Activity,
      dynamic: true,
    },
    {
      label: "Unrealized",
      value: analytics.unrealizedPnl,
      meta: `${summary.positions.length} open positions`,
      icon: BarChart3,
      dynamic: true,
    },
    {
      label: "Win Rate",
      value: analytics.winRate,
      meta: `${analytics.totalClosedTrades} closed trades`,
      icon: Target,
      percent: true,
    },
    {
      label: "Best Trade",
      value: best?.realizedPnl ?? 0,
      meta: best ? best.ticker : "No exits yet",
      icon: Trophy,
      dynamic: Boolean(best),
    },
  ];

  return (
    <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr_1fr]">
      <div className="terminal-panel overflow-hidden">
        <div className="terminal-panel-header">
          <div>
            <div className="terminal-title">Portfolio Analytics</div>
            <div className="terminal-subtle mt-1 text-[10px]">Realized, unrealized and closed-trade quality</div>
          </div>
          <span className="terminal-badge rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em]">
            {analytics.totalClosedTrades} exits
          </span>
        </div>
        <div className="grid gap-px bg-[var(--terminal-grid)] md:grid-cols-4">
          {stats.map((stat) => {
            const Icon = stat.icon;
            const valueColor = stat.dynamic ? getPriceChangeColor(stat.value) : "terminal-fg";
            return (
              <div key={stat.label} className="bg-[var(--terminal-surface)] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="terminal-subtle text-[10px] font-bold uppercase tracking-[0.1em]">{stat.label}</span>
                  <Icon size={13} className="text-[var(--terminal-accent)]" />
                </div>
                <div className={cn("terminal-number text-base font-bold", valueColor)}>
                  {stat.percent ? formatPercentage(stat.value) : `${stat.dynamic && stat.value > 0 ? "+" : ""}${formatCurrency(stat.value)}`}
                </div>
                <div className="terminal-subtle mt-1 truncate font-mono text-[10px]">{stat.meta}</div>
              </div>
            );
          })}
        </div>

        <div className="grid gap-px bg-[var(--terminal-grid)] md:grid-cols-2">
          <div className="bg-[var(--terminal-surface)] p-3">
            <div className="terminal-subtle mb-2 text-[10px] font-bold uppercase tracking-[0.1em]">Worst Trade</div>
            <div className={cn("terminal-number text-sm font-bold", worst ? getPriceChangeColor(worst.realizedPnl) : "terminal-fg")}>
              {worst ? `${worst.realizedPnl > 0 ? "+" : ""}${formatCurrency(worst.realizedPnl)}` : formatCurrency(0)}
            </div>
            <div className="terminal-subtle mt-1 font-mono text-[10px]">{worst?.ticker ?? "No closed losses yet"}</div>
          </div>
          <div className="bg-[var(--terminal-surface)] p-3">
            <div className="terminal-subtle mb-2 text-[10px] font-bold uppercase tracking-[0.1em]">Realized Tape</div>
            <div className="grid grid-cols-5 gap-1">
              {recentDays.length === 0 ? (
                <div className="terminal-subtle col-span-5 py-2 text-center text-xs">No realized P&L days yet</div>
              ) : (
                recentDays.map((day) => (
                  <div key={day.date} className="rounded-sm border border-[color:var(--terminal-grid)] bg-[var(--terminal-fill)] p-1.5 text-center">
                    <div className="terminal-subtle font-mono text-[9px]">{day.date.slice(5)}</div>
                    <div className={cn("terminal-number mt-1 text-[10px] font-bold", getPriceChangeColor(day.realizedPnl))}>
                      {day.realizedPnl > 0 ? "+" : ""}{formatCurrency(day.realizedPnl)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      <AllocationBars title="Asset Mix" items={analytics.allocationByAssetClass} />
      <AllocationBars title="Product Mix" items={analytics.allocationByProduct} />
    </div>
  );
}
