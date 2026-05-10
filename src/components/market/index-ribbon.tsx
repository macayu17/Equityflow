"use client";

import { useStreamIndices, type IndexPrice } from "@/hooks/usePriceStream";
import { cn, formatNumber, formatPercentage } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

export function MarketIndexRibbon() {
  const indices = useStreamIndices();

  if (!indices || indices.length === 0) return null;

  return (
    <div className="terminal-shell flex items-center gap-1.5 overflow-x-auto border-b border-[color:var(--terminal-border)] px-3 py-2 scrollbar-hide">
      {indices.map((idx: IndexPrice) => {
        const isUp = idx.change >= 0;
        return (
          <div
            key={idx.name}
            className="terminal-badge flex flex-shrink-0 items-center gap-3 rounded-sm px-3 py-1.5 transition-colors hover:border-[color:var(--terminal-accent)] hover:bg-[var(--terminal-hover)]"
          >
            <div>
              <div className="terminal-subtle whitespace-nowrap font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">
                {idx.name}
              </div>
              <div className="terminal-number terminal-fg text-[13px] font-bold">
                {formatNumber(idx.value)}
              </div>
            </div>
            <div className={cn(
              "terminal-number flex items-center gap-0.5 text-[11px] font-semibold px-1.5 py-0.5 rounded-sm",
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
