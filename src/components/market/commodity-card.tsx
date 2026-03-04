"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStreamCommodityPrice } from "@/hooks/usePriceStream";
import { cn, formatCurrency } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { CommodityCategory } from "@/lib/types";

interface CommodityCardProps {
  ticker: string;
  name: string;
  category: CommodityCategory;
  exchange: string;
  lotSize: number;
  unit: string;
  expiry: string;
}

export function CommodityCard({ ticker, name, category, exchange, lotSize, unit, expiry }: CommodityCardProps) {
  const streamPrice = useStreamCommodityPrice(ticker);
  const prevPriceRef = useRef<number | null>(null);
  const [direction, setDirection] = useState<"up" | "down" | null>(null);

  const ltp = streamPrice?.ltp ?? 0;
  const change = streamPrice?.change ?? 0;
  const changePercent = streamPrice?.changePercent ?? 0;

  useEffect(() => {
    if (ltp && prevPriceRef.current !== null && ltp !== prevPriceRef.current) {
      setDirection(ltp > prevPriceRef.current ? "up" : "down");
    }
    if (ltp) prevPriceRef.current = ltp;
  }, [ltp]);

  if (!streamPrice) {
    return (
      <div className="rounded-lg border border-border dark:border-border-dark bg-card dark:bg-card-dark p-4 space-y-3">
        <div className="flex justify-between">
          <div className="w-10 h-10 bg-surface dark:bg-elevated-dark rounded-md shimmer" />
          <div className="w-16 h-5 bg-surface dark:bg-elevated-dark rounded shimmer" />
        </div>
        <div className="h-6 w-32 bg-surface dark:bg-elevated-dark rounded shimmer" />
        <div className="h-20 bg-surface dark:bg-elevated-dark rounded shimmer" />
      </div>
    );
  }

  const isPositive = change >= 0;

  return (
    <Link href={`/commodities/${ticker}`} className="block rounded-lg border border-border dark:border-border-dark bg-card dark:bg-card-dark p-4 hover:shadow-card transition-all group cursor-pointer">
      {/* Top row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-md bg-accent/10 flex items-center justify-center text-accent font-bold text-[11px] flex-shrink-0">
            {ticker.slice(0, 2)}
          </div>
          <div>
            <div className="text-[13px] font-semibold text-primary dark:text-primary-dark group-hover:text-accent transition-colors">
              {name}
            </div>
            <div className="text-2xs text-muted dark:text-muted-dark">
              {ticker} · {exchange}
            </div>
          </div>
        </div>
        <span className="text-2xs text-muted dark:text-muted-dark bg-surface dark:bg-elevated-dark px-1.5 py-0.5 rounded">
          {category}
        </span>
      </div>

      {/* Price */}
      <div className="flex items-baseline justify-between mb-3">
        <span className={cn(
          "text-lg font-bold tabular-nums text-primary dark:text-primary-dark transition-colors",
          direction === "up" && "text-profit",
          direction === "down" && "text-loss"
        )}>
          {formatCurrency(ltp)}
        </span>
        <span className={cn(
          "flex items-center gap-0.5 text-[12px] font-semibold",
          isPositive ? "text-profit" : "text-loss"
        )}>
          {isPositive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
          {isPositive ? "+" : ""}{changePercent.toFixed(2)}%
        </span>
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 py-2.5 border-t border-border/50 dark:border-border-dark/50">
        <div className="flex justify-between text-2xs">
          <span className="text-muted dark:text-muted-dark">Change</span>
          <span className={cn("tabular-nums font-medium", isPositive ? "text-profit" : "text-loss")}>
            {isPositive ? "+" : ""}{change.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between text-2xs">
          <span className="text-muted dark:text-muted-dark">%</span>
          <span className={cn("tabular-nums font-medium", isPositive ? "text-profit" : "text-loss")}>
            {isPositive ? "+" : ""}{changePercent.toFixed(2)}%
          </span>
        </div>
        <div className="flex justify-between text-2xs">
          <span className="text-muted dark:text-muted-dark">Lot</span>
          <span className="tabular-nums text-secondary dark:text-secondary-dark">
            {lotSize} {unit}
          </span>
        </div>
        <div className="flex justify-between text-2xs">
          <span className="text-muted dark:text-muted-dark">Expiry</span>
          <span className="tabular-nums text-secondary dark:text-secondary-dark">
            {new Date(expiry).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-2 mt-3">
        <button className="py-1.5 rounded-md bg-profit text-white text-[11px] font-semibold hover:bg-profit/90 transition-colors active:scale-[0.98]">
          BUY
        </button>
        <button className="py-1.5 rounded-md bg-loss text-white text-[11px] font-semibold hover:bg-loss/90 transition-colors active:scale-[0.98]">
          SELL
        </button>
      </div>
    </Link>
  );
}
