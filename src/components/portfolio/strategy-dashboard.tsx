"use client";

import { usePortfolio } from "@/hooks/usePortfolio";
import { cn, formatCurrency, getPriceChangeColor } from "@/lib/utils";
import { BarChart3, Target, TrendingUp, TrendingDown, Award, AlertTriangle } from "lucide-react";

export function StrategyDashboard() {
  const { strategies } = usePortfolio();

  if (strategies.length === 0) {
    return (
      <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark p-8 text-center">
        <BarChart3
          size={40}
          className="mx-auto text-muted/30 dark:text-muted-dark/30 mb-3"
        />
        <h3 className="text-sm font-medium text-primary dark:text-primary-dark mb-1">
          No Strategy Data
        </h3>
        <p className="text-xs text-muted dark:text-muted-dark">
          Place trades with strategy tags to see performance analytics
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Strategy Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {strategies.map((strat) => (
          <div
            key={strat.tag}
            className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark p-4 hover:shadow-card transition-shadow"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                  <Target size={16} className="text-accent" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-primary dark:text-primary-dark">
                    {strat.tag}
                  </h3>
                  <div className="text-[10px] text-muted dark:text-muted-dark">
                    {strat.totalTrades} trades
                  </div>
                </div>
              </div>
              <div className={cn("text-base font-bold", getPriceChangeColor(strat.totalPnl))}>
                {strat.totalPnl >= 0 ? "+" : ""}
                {formatCurrency(strat.totalPnl)}
              </div>
            </div>

            {/* Win Rate Bar */}
            <div className="mb-3">
              <div className="flex justify-between text-[10px] text-muted dark:text-muted-dark mb-1">
                <span>Win Rate</span>
                <span className="font-medium">
                  {strat.winRate.toFixed(1)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-surface dark:bg-elevated-dark overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    strat.winRate >= 50 ? "bg-accent" : "bg-loss"
                  )}
                  style={{ width: `${Math.min(strat.winRate, 100)}%` }}
                />
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-1.5 text-xs">
                <TrendingUp size={12} className="text-accent" />
                <span className="text-muted dark:text-muted-dark">Wins:</span>
                <span className="font-medium text-primary dark:text-primary-dark">{strat.winCount}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <TrendingDown size={12} className="text-loss" />
                <span className="text-muted dark:text-muted-dark">Losses:</span>
                <span className="font-medium text-primary dark:text-primary-dark">{strat.lossCount}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <Award size={12} className="text-accent" />
                <span className="text-muted dark:text-muted-dark">Best:</span>
                <span className="font-medium text-accent">
                  {strat.bestTrade > 0 ? "+" : ""}{formatCurrency(strat.bestTrade)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <AlertTriangle size={12} className="text-loss" />
                <span className="text-muted dark:text-muted-dark">Worst:</span>
                <span className="font-medium text-loss">
                  {formatCurrency(strat.worstTrade)}
                </span>
              </div>
            </div>

            {/* Average P&L */}
            <div className="mt-3 pt-3 border-t border-border dark:border-border-dark flex justify-between items-center">
              <span className="text-[10px] text-muted dark:text-muted-dark">
                Avg P&L per trade
              </span>
              <span className={cn("text-xs font-semibold", getPriceChangeColor(strat.avgPnl))}>
                {strat.avgPnl >= 0 ? "+" : ""}{formatCurrency(strat.avgPnl)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
