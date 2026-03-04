"use client";

import { useState } from "react";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { MOCK_COMMODITIES } from "@/lib/constants";
import {
  Gem,
  TrendingUp,
  CircleDot,
  Droplets,
  Flame,
  Zap,
  Box,
  Hexagon,
  Disc,
} from "lucide-react";
import type { CommodityCategory } from "@/lib/types";
import { MarketStatusBadge } from "@/components/market/market-status";
import { useStreamCommodityPrice } from "@/hooks/usePriceStream";
import Link from "next/link";

const CATEGORIES: ("All" | CommodityCategory)[] = [
  "All",
  "Crude Oil",
  "Gold",
  "Natural Gas",
  "Silver",
  "Zinc",
  "Copper",
  "Aluminium",
  "Electricity",
];

function CommodityRow({ ticker, name }: { ticker: string; name: string; expiry: string }) {
  const stream = useStreamCommodityPrice(ticker);
  const ltp = stream?.ltp ?? 0;
  const change = stream?.change ?? 0;
  const changePct = stream?.changePercent ?? 0;
  const isPositive = change >= 0;

  // Get icon and color based on category
  const getIconInfo = () => {
    if (ticker.startsWith("GOLD")) return { Icon: CircleDot, color: "text-yellow-500", bg: "bg-yellow-500/10" };
    if (ticker.startsWith("SILVER")) return { Icon: Disc, color: "text-slate-400", bg: "bg-slate-400/10" };
    if (ticker.startsWith("CRUDE")) return { Icon: Droplets, color: "text-amber-700 dark:text-amber-500", bg: "bg-amber-500/10" };
    if (ticker.startsWith("NATURAL") || ticker.startsWith("NATGAS")) return { Icon: Flame, color: "text-orange-500", bg: "bg-orange-500/10" };
    if (ticker.startsWith("COPPER")) return { Icon: Hexagon, color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-400/10" };
    if (ticker.startsWith("ZINC")) return { Icon: Box, color: "text-zinc-500", bg: "bg-zinc-500/10" };
    if (ticker.startsWith("ALUM")) return { Icon: Box, color: "text-blue-400", bg: "bg-blue-400/10" };
    if (ticker.startsWith("ELEC")) return { Icon: Zap, color: "text-yellow-400", bg: "bg-yellow-400/10" };
    return { Icon: Gem, color: "text-accent", bg: "bg-accent/10" };
  };
  const { Icon: CommodityIcon, color: iconColor, bg: iconBg } = getIconInfo();

  return (
    <Link
      href={`/commodities/${ticker}`}
      className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-3.5 hover:bg-surface/50 dark:hover:bg-elevated-dark/50 transition-colors border-b border-border/30 dark:border-border-dark/30 last:border-b-0"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0", iconBg)}>
          <CommodityIcon size={16} className={iconColor} strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-primary dark:text-primary-dark truncate">
            {name}
          </div>
          <div className="text-2xs text-muted dark:text-muted-dark">Fut</div>
        </div>
      </div>
      <div className="text-[13px] font-semibold tabular-nums text-primary dark:text-primary-dark text-right w-28">
        {ltp > 0 ? formatCurrency(ltp) : "—"}
      </div>
      <div className={cn(
        "text-[12px] font-medium tabular-nums text-right w-32",
        isPositive ? "text-profit" : "text-loss"
      )}>
        {ltp > 0 ? (
          <>
            {change > 0 ? "+" : ""}{formatNumber(change)} ({isPositive ? "+" : ""}{changePct.toFixed(2)}%)
          </>
        ) : "—"}
      </div>
      <div className="text-[12px] tabular-nums text-secondary dark:text-secondary-dark text-right w-20">
        {/* Volume placeholder - shown from stream if available */}
        —
      </div>
    </Link>
  );
}

export default function CommoditiesPage() {
  const [category, setCategory] = useState<"All" | CommodityCategory>("All");

  const filtered =
    category === "All"
      ? MOCK_COMMODITIES
      : MOCK_COMMODITIES.filter((c) => c.category === category);

  // Group by category for the "All" view
  const grouped = category === "All"
    ? CATEGORIES.filter(c => c !== "All").reduce((acc, cat) => {
        const items = filtered.filter(c => c.category === cat);
        if (items.length > 0) acc.push({ category: cat, items });
        return acc;
      }, [] as { category: string; items: typeof filtered }[])
    : [{ category, items: filtered }];

  return (
    <div className="px-4 md:px-6 py-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-accent/10 dark:bg-accent/[0.12] flex items-center justify-center">
              <Gem size={17} className="text-accent" strokeWidth={2.2} />
            </div>
            <h1 className="text-xl font-bold text-primary dark:text-primary-dark">
              Commodities
            </h1>
          </div>
          <p className="text-[13px] text-secondary dark:text-secondary-dark ml-[42px]">
            Trade commodities on MCX with virtual funds
          </p>
        </div>
        <MarketStatusBadge segment="commodity" />
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={cn(
              "px-3.5 py-1.5 text-[12px] font-semibold rounded-lg whitespace-nowrap transition-all duration-150",
              category === cat
                ? "bg-accent text-white shadow-xs"
                : "bg-surface dark:bg-elevated-dark text-secondary dark:text-secondary-dark hover:text-primary dark:hover:text-primary-dark hover:bg-surface dark:hover:bg-elevated-dark"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Commodity Tables grouped by category */}
      <div className="space-y-6">
        {grouped.map(({ category: cat, items }) => (
          <div key={cat}>
            <h2 className="text-[15px] font-bold text-primary dark:text-primary-dark mb-2.5">
              {cat}
            </h2>
            <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-2.5 border-b border-border dark:border-border-dark bg-surface/40 dark:bg-elevated-dark/40">
                <div className="text-[10px] font-semibold text-muted dark:text-muted-dark uppercase tracking-widest">
                  Commodity
                </div>
                <div className="text-[10px] font-semibold text-muted dark:text-muted-dark uppercase tracking-widest text-right w-28">
                  Price
                </div>
                <div className="text-[10px] font-semibold text-muted dark:text-muted-dark uppercase tracking-widest text-right w-32">
                  1D Change
                </div>
                <div className="text-[10px] font-semibold text-muted dark:text-muted-dark uppercase tracking-widest text-right w-20">
                  Volume
                </div>
              </div>
              {/* Rows */}
              {items.map((commodity) => (
                <CommodityRow
                  key={commodity.ticker}
                  ticker={commodity.ticker}
                  name={commodity.name}
                  expiry={commodity.expiry}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12">
          <TrendingUp size={40} className="mx-auto text-muted/30 mb-3" />
          <p className="text-[13px] text-muted dark:text-muted-dark">
            No commodities in this category
          </p>
        </div>
      )}

      <p className="text-2xs text-center text-muted dark:text-muted-dark">
        Simulated MCX commodity data — paper trading only
      </p>
    </div>
  );
}
