"use client";

import { formatNumber } from "@/lib/utils";
import type { MarketDepth } from "@/lib/types";

interface MarketDepthTableProps {
  depth: MarketDepth;
}

export function MarketDepthTable({ depth }: MarketDepthTableProps) {
  const allQty = [...depth.bids, ...depth.asks].map((level) => level.quantity);
  const maxQty = allQty.length > 0 ? Math.max(...allQty) : 1;

  return (
    <div className="rounded-lg border border-border dark:border-border-dark bg-card dark:bg-card-dark overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border dark:border-border-dark">
        <h3 className="text-[13px] font-semibold text-primary dark:text-primary-dark">
          Market Depth
        </h3>
      </div>

      <div className="grid grid-cols-2 divide-x divide-border dark:divide-border-dark">
        {/* Bids */}
        <div>
          <div className="grid grid-cols-3 px-3 py-1.5 text-2xs font-medium text-muted dark:text-muted-dark uppercase tracking-wider border-b border-border dark:border-border-dark">
            <span>Bid Qty</span>
            <span>Orders</span>
            <span className="text-right">Price</span>
          </div>
          {depth.bids.map((bid, i) => (
            <div key={i} className="grid grid-cols-3 px-3 py-1.5 text-[11px] relative">
              <div
                className="absolute left-0 top-0 bottom-0 bg-profit/5 dark:bg-profit/8"
                style={{ width: `${(bid.quantity / maxQty) * 100}%` }}
              />
              <span className="relative tabular-nums text-primary dark:text-primary-dark">{bid.quantity}</span>
              <span className="relative tabular-nums text-muted dark:text-muted-dark">{bid.orders}</span>
              <span className="relative text-right font-medium tabular-nums text-profit">{formatNumber(bid.price)}</span>
            </div>
          ))}
          <div className="px-3 py-1.5 text-[11px] font-medium text-muted dark:text-muted-dark border-t border-border dark:border-border-dark">
            Total: <span className="text-profit tabular-nums">{depth.totalBidQty}</span>
          </div>
        </div>

        {/* Asks */}
        <div>
          <div className="grid grid-cols-3 px-3 py-1.5 text-2xs font-medium text-muted dark:text-muted-dark uppercase tracking-wider border-b border-border dark:border-border-dark">
            <span>Price</span>
            <span>Orders</span>
            <span className="text-right">Ask Qty</span>
          </div>
          {depth.asks.map((ask, i) => (
            <div key={i} className="grid grid-cols-3 px-3 py-1.5 text-[11px] relative">
              <div
                className="absolute right-0 top-0 bottom-0 bg-loss/5 dark:bg-loss/8"
                style={{ width: `${(ask.quantity / maxQty) * 100}%` }}
              />
              <span className="relative font-medium tabular-nums text-loss">{formatNumber(ask.price)}</span>
              <span className="relative tabular-nums text-muted dark:text-muted-dark">{ask.orders}</span>
              <span className="relative text-right tabular-nums text-primary dark:text-primary-dark">{ask.quantity}</span>
            </div>
          ))}
          <div className="px-3 py-1.5 text-[11px] font-medium text-muted dark:text-muted-dark border-t border-border dark:border-border-dark">
            Total: <span className="text-loss tabular-nums">{depth.totalAskQty}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
