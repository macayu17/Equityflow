"use client";

import { useState, useEffect } from "react";
import { getMarketStatus, type MarketSegment } from "@/lib/market-hours";
import { cn } from "@/lib/utils";

interface MarketStatusBadgeProps {
  segment: MarketSegment;
  className?: string;
  showTiming?: boolean;
}

export function MarketStatusBadge({ segment, className, showTiming = true }: MarketStatusBadgeProps) {
  const [status, setStatus] = useState(() => getMarketStatus(segment));

  useEffect(() => {
    setStatus(getMarketStatus(segment));
    const timer = setInterval(() => setStatus(getMarketStatus(segment)), 30_000);
    return () => clearInterval(timer);
  }, [segment]);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex items-center gap-1.5">
        <span className="relative flex h-2.5 w-2.5">
          {status.isOpen && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-profit opacity-60" />
          )}
          <span
            className={cn(
              "relative inline-flex h-2.5 w-2.5 rounded-full",
              status.isOpen ? "bg-profit" : "bg-loss"
            )}
          />
        </span>
        <span
          className={cn(
            "text-xs font-semibold",
            status.isOpen ? "text-profit" : "text-loss"
          )}
        >
          {status.label}
        </span>
      </div>
      {showTiming && (
        <span className="text-[11px] text-muted dark:text-muted-dark">
          {status.detail}
          {status.isOpen && status.minutesLeft !== undefined && status.minutesLeft <= 60 && (
            <span className="ml-1 text-orange-500 font-medium">
              ({status.minutesLeft}m left)
            </span>
          )}
        </span>
      )}
    </div>
  );
}
