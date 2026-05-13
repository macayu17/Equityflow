"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
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
          "rounded-sm bg-[var(--terminal-accent-soft)] flex items-center justify-center text-[var(--terminal-accent)] font-bold",
          className,
          textClassName
        )}
      >
        {ticker.slice(0, 2)}
      </div>
    );
  }

  return (
    <div className={cn("rounded-sm bg-[var(--terminal-surface)] overflow-hidden border border-[color:var(--terminal-grid)]", className)}>
      <Image
        src={resolvedLogoUrl}
        alt={`${ticker} logo`}
        width={48}
        height={48}
        unoptimized={resolvedLogoUrl.includes("google.com/s2/favicons")}
        className="w-full h-full object-contain"
        onError={() => setLogoIndex((current) => current + 1)}
      />
    </div>
  );
}
