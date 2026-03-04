"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSparkline } from "@/hooks/useStockData";
import { useStreamPrice } from "@/hooks/usePriceStream";
import { Sparkline } from "@/components/market/sparkline";
import { StockLogo } from "@/components/market/stock-logo";
import { cn, formatCurrency, formatPercentage, getPriceChangeColor } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

interface StockCardProps {
  ticker: string;
  name: string;
  compact?: boolean;
}

export function StockCard({ ticker, name, compact = false }: StockCardProps) {
  // Use SSE stream instead of individual HTTP polling (60 cards × 500ms → 0 individual requests)
  const streamPrice = useStreamPrice(ticker);
  const { data: sparklineData } = useSparkline(ticker);
  const [pulseKey, setPulseKey] = useState(0);
  const prevPriceRef = useRef<number | null>(null);
  const [priceDirection, setPriceDirection] = useState<"up" | "down" | null>(null);

  const ltp = streamPrice?.ltp ?? 0;
  const change = streamPrice?.change ?? 0;
  const changePercent = streamPrice?.changePercent ?? 0;

  useEffect(() => {
    if (ltp > 0 && prevPriceRef.current !== null && ltp !== prevPriceRef.current) {
      setPriceDirection(ltp > prevPriceRef.current ? "up" : "down");
      setPulseKey((k) => k + 1);
    }
    if (ltp > 0) prevPriceRef.current = ltp;
  }, [ltp]);

  if (!streamPrice || ltp === 0) {
    return (
      <div className={cn(
        "premium-card",
        compact ? "flex items-center gap-3 px-4 py-3" : "p-4"
      )}>
        <div className="w-9 h-9 bg-surface dark:bg-elevated-dark rounded-lg shimmer" />
        <div className="flex-1 space-y-2 mt-2">
          <div className="h-3 bg-surface dark:bg-elevated-dark rounded-md w-3/4 shimmer" />
          <div className="h-4 bg-surface dark:bg-elevated-dark rounded-md w-1/2 shimmer" />
        </div>
      </div>
    );
  }

  const isPositive = change >= 0;

  if (compact) {
    return (
      <Link
        href={`/stocks/${ticker}`}
        className="flex items-center gap-3 px-4 py-3 hover:bg-surface/50 dark:hover:bg-elevated-dark/50 transition-colors"
      >
        <StockLogo ticker={ticker} className="w-9 h-9 flex-shrink-0" textClassName="text-[11px]" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-primary dark:text-primary-dark truncate">{name}</div>
          <div className="text-[11px] text-muted dark:text-muted-dark mt-0.5">{ticker}</div>
        </div>
        {sparklineData && (
          <Sparkline data={sparklineData} width={56} height={22} positive={isPositive} />
        )}
        <div className="text-right flex-shrink-0 min-w-[90px]">
          <div
            key={pulseKey}
            className={cn(
              "text-[13px] font-semibold tabular-nums text-primary dark:text-primary-dark rounded",
              priceDirection === "up" && "animate-pulse-green",
              priceDirection === "down" && "animate-pulse-red"
            )}
          >
            {formatCurrency(ltp)}
          </div>
          <div className={cn("text-[11px] font-medium tabular-nums mt-0.5", getPriceChangeColor(change))}>
            {formatPercentage(changePercent)}
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={`/stocks/${ticker}`}
      className="block rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark p-4 hover:border-border-hover dark:hover:border-border-hover-dark hover:shadow-sm transition-all duration-150 group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <StockLogo ticker={ticker} className="w-9 h-9" textClassName="text-[11px]" />
          <div>
            <div className="text-[13px] font-semibold text-primary dark:text-primary-dark group-hover:text-accent transition-colors truncate max-w-[120px]">
              {name}
            </div>
            <div className="text-[11px] text-muted dark:text-muted-dark mt-0.5">{ticker}</div>
          </div>
        </div>
        <div className={cn(
          "flex items-center gap-0.5 text-[11px] font-semibold px-2 py-1 rounded-md",
          isPositive ? "bg-profit-bg dark:bg-profit-bg-dark text-profit" : "bg-loss-bg dark:bg-loss-bg-dark text-loss"
        )}>
          {isPositive ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
          {formatPercentage(changePercent)}
        </div>
      </div>

      {/* Sparkline */}
      <div className="mb-3 flex justify-center">
        {sparklineData ? (
          <Sparkline data={sparklineData} width={180} height={36} positive={isPositive} />
        ) : (
          <div className="h-9 w-full bg-surface dark:bg-elevated-dark rounded-md shimmer" />
        )}
      </div>

      {/* Price */}
      <div className="flex items-end justify-between">
        <div
          key={pulseKey}
          className={cn(
            "text-base font-bold tabular-nums text-primary dark:text-primary-dark rounded px-0.5",
            priceDirection === "up" && "animate-pulse-green",
            priceDirection === "down" && "animate-pulse-red"
          )}
        >
          {formatCurrency(ltp)}
        </div>
        <div className={cn("text-[11px] font-medium tabular-nums", getPriceChangeColor(change))}>
          {isPositive ? "+" : ""}{formatCurrency(Math.abs(change))}
        </div>
      </div>
    </Link>
  );
}

