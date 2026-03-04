"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { getStockLogoUrls } from "@/lib/stock-logos";

interface StockLogoProps {
  ticker: string;
  logoUrl?: string;
  className?: string;
  textClassName?: string;
}

export function StockLogo({ ticker, logoUrl, className, textClassName }: StockLogoProps) {
  const logoUrls = useMemo(() => getStockLogoUrls(ticker, logoUrl), [ticker, logoUrl]);
  const [logoIndex, setLogoIndex] = useState(0);

  useEffect(() => {
    setLogoIndex(0);
  }, [ticker, logoUrl]);

  const resolvedLogoUrl = logoUrls[logoIndex] ?? null;

  if (!resolvedLogoUrl) {
    return (
      <div
        className={cn(
          "rounded-lg bg-gradient-to-br from-accent/[0.06] to-accent/[0.12] dark:from-accent/[0.08] dark:to-accent/[0.16] flex items-center justify-center text-accent font-bold",
          className,
          textClassName
        )}
      >
        {ticker.slice(0, 2)}
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg bg-white dark:bg-card-dark overflow-hidden border border-border/50 dark:border-border-dark/60", className)}>
      <img
        src={resolvedLogoUrl}
        alt={`${ticker} logo`}
        className="w-full h-full object-contain"
        loading="lazy"
        onError={() => setLogoIndex((current) => current + 1)}
      />
    </div>
  );
}
