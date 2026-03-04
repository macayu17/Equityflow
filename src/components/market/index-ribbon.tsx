"use client";

import { useStreamIndices, type IndexPrice } from "@/hooks/usePriceStream";
import { cn, formatNumber, formatPercentage } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

export function MarketIndexRibbon() {
  const indices = useStreamIndices();

  if (!indices || indices.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto px-4 md:px-6 py-2.5 border-b border-border/70 dark:border-border-dark/80 glass-panel liquid-glass scrollbar-hide">
      {indices.map((idx: IndexPrice) => {
        const isUp = idx.change >= 0;
        return (
          <div
            key={idx.name}
            className="flex items-center gap-3 flex-shrink-0 px-3 py-1.5 rounded-lg hover:bg-surface/80 dark:hover:bg-elevated-dark/80 transition-colors"
          >
            <div>
              <div className="text-[10px] font-semibold text-muted dark:text-muted-dark whitespace-nowrap uppercase tracking-wider">
                {idx.name}
              </div>
              <div className="text-[13px] font-bold tabular-nums text-primary dark:text-primary-dark">
                {formatNumber(idx.value)}
              </div>
            </div>
            <div className={cn(
              "flex items-center gap-0.5 text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md",
              isUp ? "bg-profit-bg dark:bg-profit-bg-dark text-profit" : "bg-loss-bg dark:bg-loss-bg-dark text-loss"
            )}>
              {isUp ? <ArrowUpRight size={12} strokeWidth={2.2} /> : <ArrowDownRight size={12} strokeWidth={2.2} />}
              <span>{idx.change !== 0 ? formatPercentage(idx.changePercent) : "0.00%"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
