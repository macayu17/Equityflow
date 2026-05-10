"use client";

import { useEffect, useMemo, useCallback, useRef } from "react";
import { PortfolioSummaryCard, HoldingsList } from "@/components/portfolio/holdings";
import { PositionsSection } from "@/components/portfolio/positions-section";
import { OrdersHistory } from "@/components/portfolio/orders-history";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useAllStreamPrices } from "@/hooks/usePriceStream";
import { API_CONFIG } from "@/lib/constants";
import type { Position } from "@/lib/types";
import { RotateCcw } from "lucide-react";
import { useToast } from "@/components/toast-provider";

function isFnoContractTicker(ticker: string): boolean {
  const symbol = ticker.toUpperCase();
  const isFuture = symbol.endsWith("FUT");
  const isOption = (symbol.endsWith("CE") || symbol.endsWith("PE")) && /\d/.test(symbol);
  return isFuture || isOption;
}

function isFnoPosition(position: Position): boolean {
  return isFnoContractTicker(position.ticker) || isFnoContractTicker(position.stockName || "");
}

export default function PortfolioPage() {
  const { resetAccount, positions, updateLTP } = usePortfolio();
  const { prices, commodities } = useAllStreamPrices();
  const { toast } = useToast();

  // Map simplified ticker → resolved Groww FNO trading symbol
  const resolvedSymbolsRef = useRef<Record<string, string | null>>({});

  const fnoPositions = useMemo(
    () => positions.filter((position) => isFnoPosition(position)),
    [positions]
  );

  // SSE-based equity updates
  useEffect(() => {
    positions.forEach((position) => {
      const stream = prices[position.ticker] ?? commodities[position.ticker];
      if (!stream?.ltp || stream.ltp <= 0) return;
      if (stream.ltp !== position.ltp) {
        updateLTP(position.ticker, stream.ltp);
      }
    });
  }, [positions, prices, commodities, updateLTP]);

  // Resolve F&O symbols once using backend instruments.csv index
  const resolveSymbol = useCallback(async (ticker: string): Promise<string | null> => {
    // Already resolved?
    if (resolvedSymbolsRef.current[ticker] !== undefined) {
      return resolvedSymbolsRef.current[ticker];
    }
    try {
      const simplified = ticker.toUpperCase().replace(/\s+/g, "").replace(/-/g, "");
      const res = await fetch(
        `${API_CONFIG.baseUrl}/api/fno/resolve?ticker=${encodeURIComponent(simplified)}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        resolvedSymbolsRef.current[ticker] = null;
        return null;
      }
      const data = await res.json();
      const symbol = data?.resolved ? data.tradingSymbol : null;
      resolvedSymbolsRef.current[ticker] = symbol;
      return symbol;
    } catch {
      resolvedSymbolsRef.current[ticker] = null;
      return null;
    }
  }, []);

  // Poll F&O LTPs using resolved symbols and FNO segment
  useEffect(() => {
    if (fnoPositions.length === 0) return;

    const refreshFnoLtps = async () => {
      try {
        // Step 1: Resolve all tickers to Groww symbols
        const resolvedPairs: { ticker: string; symbol: string }[] = [];
        for (const pos of fnoPositions) {
          const symbol = await resolveSymbol(pos.ticker);
          if (symbol) {
            resolvedPairs.push({ ticker: pos.ticker, symbol });
          }
        }

        if (resolvedPairs.length === 0) {
          return;
        }

        // Step 2: Batch LTP fetch with FNO segment
        const exchangeSymbols = resolvedPairs.map((p) => `NSE_${p.symbol}`).join(",");
        const res = await fetch(
          `${API_CONFIG.baseUrl}/api/ltp?segment=FNO&exchange_symbols=${encodeURIComponent(exchangeSymbols)}`,
          { cache: "no-store" }
        );

        if (res.ok) {
          const data = await res.json();
          const ltpMap = data?.prices && typeof data.prices === "object" ? data.prices : {};

          for (const { ticker, symbol } of resolvedPairs) {
            const key = `NSE_${symbol}`;
            const ltp = Number(ltpMap[key]);
            if (ltp > 0) {
              const pos = fnoPositions.find((p) => p.ticker === ticker);
              if (pos && ltp !== pos.ltp) {
                updateLTP(ticker, ltp);
              }
            }
          }
        }
      } catch {
        // ignore transient API errors
      }
    };

    void refreshFnoLtps();
    const timer = setInterval(refreshFnoLtps, 3000);
    return () => clearInterval(timer);
  }, [fnoPositions, updateLTP, resolveSymbol]);

  const handleReset = () => {
    if (confirm("Are you sure you want to reset your portfolio? This will clear holdings, orders, and transactions.")) {
      resetAccount();
      toast({ title: "Portfolio Reset", description: "Virtual balance restored to ₹1,00,000", variant: "success" });
    }
  };

  return (
    <div className="terminal-shell min-h-full px-3 py-3 md:px-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="terminal-title text-sm">Portfolio</h1>
          <p className="terminal-subtle text-xs">
            Your virtual holdings & performance
          </p>
        </div>
        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 rounded-sm border border-loss/30 px-3.5 py-2 text-xs font-semibold uppercase tracking-[0.05em] text-loss transition-colors hover:bg-loss/10"
        >
          <RotateCcw size={12} />
          Reset Portfolio
        </button>
      </div>

      <PortfolioSummaryCard />

      <PositionsSection />

      <div>
        <h2 className="terminal-title mb-3">
          Holdings
        </h2>
        <HoldingsList />
      </div>

      <div>
        <h2 className="terminal-title mb-3">
          Orders
        </h2>
        <OrdersHistory />
      </div>
    </div>
  );
}
