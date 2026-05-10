"use client";

import { useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { PortfolioSummaryCard, HoldingsList } from "@/components/portfolio/holdings";
import { PortfolioAnalyticsPanel } from "@/components/portfolio/portfolio-analytics";
import { PositionsSection } from "@/components/portfolio/positions-section";
import { OrdersHistory } from "@/components/portfolio/orders-history";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useAllStreamPrices } from "@/hooks/usePriceStream";
import type { Position } from "@/lib/types";
import { Activity, BriefcaseBusiness, CandlestickChart, Clock3, History, RotateCcw, Search, ShieldCheck } from "lucide-react";
import { useToast } from "@/components/toast-provider";
import { apiGetJson } from "@/services/request-cache";
import { cn, formatCurrency, formatPercentage, getPriceChangeColor } from "@/lib/utils";

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
  const { resetAccount, positions, updateLTP, summary, balance, orders } = usePortfolio();
  const { prices, commodities } = useAllStreamPrices();
  const { toast } = useToast();

  // Map simplified ticker → resolved Groww FNO trading symbol
  const resolvedSymbolsRef = useRef<Record<string, string | null>>({});

  const fnoPositions = useMemo(
    () => positions.filter((position) => isFnoPosition(position)),
    [positions]
  );
  const pendingOrders = useMemo(() => orders.filter((order) => order.status === "PENDING").length, [orders]);
  const netWorth = balance + summary.currentValue;
  const exposure = netWorth > 0 ? (summary.currentValue / netWorth) * 100 : 0;
  const pageActions = [
    { href: "/stocks", label: "Find Stocks", meta: "Equity watchlist", icon: Search },
    { href: "/fno", label: "Option Chain", meta: "Calls, puts, futures", icon: CandlestickChart },
    { href: "/strategies", label: "Strategies", meta: "Review signal P&L", icon: ShieldCheck },
    { href: "/transactions", label: "Ledger", meta: "Trade history", icon: History },
  ];

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
      const data = await apiGetJson<{ resolved?: boolean; tradingSymbol?: string }>(
        `/api/fno/resolve?ticker=${encodeURIComponent(simplified)}`
      );
      const symbol = data?.resolved ? data.tradingSymbol ?? null : null;
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
        const data = await apiGetJson<{ prices?: Record<string, number> }>(
          `/api/ltp?segment=FNO&exchange_symbols=${encodeURIComponent(exchangeSymbols)}`,
          { ttlMs: 5_000 }
        );
        if (data) {
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
    const timer = setInterval(refreshFnoLtps, 10_000);
    return () => clearInterval(timer);
  }, [fnoPositions, updateLTP, resolveSymbol]);

  const handleReset = () => {
    if (confirm("Are you sure you want to reset your portfolio? This will clear holdings, orders, and transactions.")) {
      resetAccount();
      toast({ title: "Portfolio Reset", description: "Virtual balance restored to ₹1,00,000", variant: "success" });
    }
  };

  return (
    <div className="terminal-shell min-h-full space-y-4 px-3 py-3 md:px-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-sm border border-[color:var(--terminal-border)] bg-[var(--terminal-accent-soft)] text-[var(--terminal-accent)]">
              <BriefcaseBusiness size={16} strokeWidth={2.1} />
            </div>
            <h1 className="terminal-title text-sm">Portfolio</h1>
          </div>
          <div className="ml-[42px] flex flex-wrap items-center gap-2">
            <span className="terminal-badge rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em]">
              Net {formatCurrency(netWorth)}
            </span>
            <span className={cn("rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em]", getPriceChangeColor(summary.netPnl))}>
              P&L {summary.netPnl >= 0 ? "+" : ""}{formatCurrency(summary.netPnl)} ({formatPercentage(summary.totalInvested > 0 ? (summary.netPnl / summary.totalInvested) * 100 : 0)})
            </span>
            <span className="terminal-subtle font-mono text-[10px] uppercase tracking-[0.1em]">
              {positions.length} holdings · {pendingOrders} open orders · {exposure.toFixed(2)}% deployed
            </span>
          </div>
        </div>
        <button
          onClick={handleReset}
          className="flex h-9 items-center justify-center gap-1.5 rounded-sm border border-loss/30 px-3.5 text-xs font-semibold uppercase tracking-[0.05em] text-loss transition-colors hover:bg-loss/10 lg:self-start"
        >
          <RotateCcw size={12} />
          Reset Portfolio
        </button>
      </div>

      <PortfolioSummaryCard />

      <PortfolioAnalyticsPanel />

      <div className="grid gap-2 md:grid-cols-4">
        {pageActions.map((action) => (
          <Link key={action.href} href={action.href} className="portfolio-action-tile group flex items-center gap-3 p-3">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-sm border border-[color:var(--terminal-grid)] bg-[var(--terminal-fill)] text-[var(--terminal-accent)] transition-colors group-hover:border-[color:var(--terminal-accent)]">
              <action.icon size={16} strokeWidth={2} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-bold uppercase tracking-[0.07em]">{action.label}</span>
              <span className="terminal-subtle block truncate text-[10px]">{action.meta}</span>
            </span>
          </Link>
        ))}
      </div>

      <PositionsSection />

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="terminal-title">Holdings</h2>
          <span className="terminal-subtle flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em]">
            <Activity size={11} />
            {positions.length} active
          </span>
        </div>
        <HoldingsList />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="terminal-title">Orders</h2>
          <span className="terminal-subtle flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em]">
            <Clock3 size={11} />
            {pendingOrders} pending
          </span>
        </div>
        <OrdersHistory />
      </div>
    </div>
  );
}
