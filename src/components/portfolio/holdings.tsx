"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { usePortfolio } from "@/hooks/usePortfolio";
import { cn, formatCurrency, formatPercentage, getPriceChangeColor } from "@/lib/utils";
import { MOCK_COMMODITIES, FNO_UNDERLYINGS } from "@/lib/constants";
import { Briefcase, ArrowUpRight, ArrowDownRight, CandlestickChart, Search, WalletCards } from "lucide-react";
import Link from "next/link";
import { OrderPad } from "@/components/trading/order-pad";
import { StockLogo } from "@/components/market/stock-logo";
import { useToast } from "@/components/toast-provider";
import { useAllStreamPrices } from "@/hooks/usePriceStream";
import type { OrderType, Position } from "@/lib/types";
import { apiGetJson } from "@/services/request-cache";

const COMMON_FNO_LOT_SIZES = [5500, 1600, 1100, 900, 750, 700, 550, 400, 350, 250, 175, 125, 100, 75, 65, 50, 30, 25, 20, 15];
function isFnoPosition(position: Position): boolean {
  return /(CE|PE|FUT)$/i.test(position.ticker) || /(CE|PE|FUT)/i.test(position.stockName || "");
}

function extractFnoUnderlying(position: Position): string {
  const ticker = position.ticker.toUpperCase();
  const stockName = (position.stockName || "").toUpperCase();
  const hasUnderlying = (value: string) => FNO_UNDERLYINGS.some((u) => u.ticker === value);

  const tickerPrefixed = ticker.match(/^([A-Z]+)\d+(CE|PE)$/);
  if (tickerPrefixed?.[1] && hasUnderlying(tickerPrefixed[1])) {
    return tickerPrefixed[1];
  }

  const futPrefixed = ticker.match(/^([A-Z]+)FUT$/);
  if (futPrefixed?.[1] && hasUnderlying(futPrefixed[1])) {
    return futPrefixed[1];
  }

  for (const underlying of FNO_UNDERLYINGS) {
    if (stockName.includes(underlying.ticker)) return underlying.ticker;
  }

  return "NIFTY";
}

function inferFnoLotSize(position: Position): number {
  if (!position.ticker.includes("CE") && !position.ticker.includes("PE") && !position.ticker.includes("FUT")) {
    return 1;
  }
  if (position.lot_size && position.lot_size > 1) return position.lot_size;
  const qty = Math.max(1, Math.floor(position.quantity));
  const matched = COMMON_FNO_LOT_SIZES.find((lot) => qty % lot === 0);
  return matched ?? qty;
}

export function PortfolioSummaryCard() {
  const { summary, balance, risk } = usePortfolio();
  const netWorth = balance + summary.currentValue;
  const deployedPercent = netWorth > 0 ? (summary.currentValue / netWorth) * 100 : 0;
  const cashPercent = Math.max(0, 100 - deployedPercent);
  const netPnlPercent = summary.totalInvested > 0 ? (summary.netPnl / summary.totalInvested) * 100 : 0;

  const cards = [
    { label: "Invested", value: summary.totalInvested, color: "terminal-fg" },
    { label: "Current Value", value: summary.currentValue, color: "terminal-fg" },
    { label: "Net P&L", value: summary.netPnl, pct: netPnlPercent, dynamic: true },
    { label: "Margin Used", value: risk.marginUsed, color: "text-info" },
    { label: "Day Returns", value: summary.dayPnl, pct: summary.dayPnlPercent, dynamic: true },
    { label: "Risk Score", value: risk.riskScore, suffix: "/100", color: risk.riskScore > 65 ? "text-loss" : risk.riskScore > 35 ? "text-warning" : "text-info" },
  ];

  return (
    <div className="grid gap-3 xl:grid-cols-[1.2fr_2fr]">
      <div className="portfolio-balance-panel p-4">
        <div className="relative z-10 flex h-full flex-col justify-between gap-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="terminal-subtle mb-1 text-[10px] font-bold uppercase tracking-[0.14em]">Available Cash</div>
              <div className="terminal-number text-3xl font-black tracking-tight text-[var(--terminal-accent)]">
                {formatCurrency(balance)}
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-[color:var(--terminal-border)] bg-[var(--terminal-fill)] text-[var(--terminal-accent)]">
              <WalletCards size={19} strokeWidth={1.9} />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.1em]">
              <span className="terminal-subtle">Cash {cashPercent.toFixed(2)}%</span>
              <span className="terminal-subtle">Deployed {deployedPercent.toFixed(2)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-sm border border-[color:var(--terminal-grid)] bg-[var(--terminal-fill)]">
              <div
                className="h-full bg-[var(--terminal-accent)] transition-[width] duration-300"
                style={{ width: `${Math.min(100, deployedPercent)}%` }}
              />
            </div>
            <div className="terminal-subtle mt-2 font-mono text-[10px] uppercase tracking-[0.1em]">
              Net liquidation {formatCurrency(netWorth)}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map((card) => (
          <div
            key={card.label}
            className="terminal-panel p-3.5"
          >
            <div className="terminal-subtle mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em]">
              {card.label}
            </div>
            <div className={cn("terminal-number text-base font-bold", card.dynamic ? getPriceChangeColor(card.value) : card.color)}>
              {card.dynamic && card.value > 0 && "+"}
              {card.label === "Risk Score" ? `${card.value}${card.suffix ?? ""}` : formatCurrency(card.value)}
            </div>
            {card.dynamic && card.pct !== undefined && (
              <div className={cn("mt-1 flex items-center gap-0.5 text-xs font-medium", getPriceChangeColor(card.value))}>
                {card.value >= 0 ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
                {formatPercentage(card.pct)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function HoldingsList() {
  const { positions, removeHolding, updateLTP } = usePortfolio();
  const { prices, commodities } = useAllStreamPrices();
  const { toast } = useToast();
  const commodityTickers = useMemo(() => new Set(MOCK_COMMODITIES.map((c) => c.ticker)), []);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderType, setOrderType] = useState<OrderType>("BUY");
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [ltpFlash, setLtpFlash] = useState<Record<string, "up" | "down">>({});
  const flashTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Helper to trigger LTP flash animation + update
  const flashAndUpdate = useCallback((posId: string, ticker: string, live: number, currentLtp: number) => {
    if (live === currentLtp) return;
    const direction: "up" | "down" = live > currentLtp ? "up" : "down";
    setLtpFlash((prev) => ({ ...prev, [posId]: direction }));
    if (flashTimersRef.current[posId]) clearTimeout(flashTimersRef.current[posId]);
    flashTimersRef.current[posId] = setTimeout(() => {
      setLtpFlash((prev) => {
        const next = { ...prev };
        delete next[posId];
        return next;
      });
      delete flashTimersRef.current[posId];
    }, 420);
    updateLTP(ticker, live);
  }, [updateLTP]);

  // ── SSE-based price sync for equity & commodity positions ──
  useEffect(() => {
    for (const pos of positions) {
      const isCommodity = commodityTickers.has(pos.ticker);
      if (isFnoPosition(pos)) continue; // FNO handled by polling below

      const live = isCommodity ? commodities[pos.ticker]?.ltp : prices[pos.ticker]?.ltp;
      if (typeof live !== "number" || live <= 0 || live === pos.ltp) continue;

      flashAndUpdate(pos.id, pos.ticker, live, pos.ltp);
    }
  }, [positions, prices, commodities, flashAndUpdate, commodityTickers]);

  // ── Polling-based price sync for F&O positions ──
  // SSE streams don't carry F&O data so we poll the /api/fno/quote endpoint
  useEffect(() => {
    const fnoPositions = positions.filter(isFnoPosition);
    if (fnoPositions.length === 0) return;

    let active = true;

    const fetchFnoPrices = async () => {
      for (const pos of fnoPositions) {
        if (!active) return;
        try {
          // Try resolving via the FNO resolve endpoint first (handles simplified tickers like NIFTY25300CE)
          const simplified = pos.ticker.toUpperCase().replace(/\s+/g, "").replace(/-/g, "");
          const resolveData = await apiGetJson<{ resolved?: boolean; tradingSymbol?: string }>(
            `/api/fno/resolve?ticker=${encodeURIComponent(simplified)}`
          );
          if (resolveData?.resolved && resolveData.tradingSymbol) {
            const q = await apiGetJson<{ ltp?: number }>(
              `/api/quote?exchange=NSE&segment=FNO&trading_symbol=${encodeURIComponent(resolveData.tradingSymbol)}`
            );
            const ltp = Number(q?.ltp);
            if (active && ltp > 0) {
              flashAndUpdate(pos.id, pos.ticker, ltp, pos.ltp);
              continue;
            }
          }

          // Fallback: direct FNO quote endpoint
          const q = await apiGetJson<{ ltp?: number }>(
            `/api/fno/quote/${encodeURIComponent(pos.ticker)}`
          );
          const ltp = Number(q?.ltp);
          if (active && ltp > 0) {
            flashAndUpdate(pos.id, pos.ticker, ltp, pos.ltp);
          }
        } catch {
          // Ignore individual fetch errors — will retry next cycle
        }
      }
    };

    fetchFnoPrices();
    const interval = setInterval(fetchFnoPrices, 15_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.map(p => p.id).join(","), flashAndUpdate]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(flashTimersRef.current)) clearTimeout(timer);
      flashTimersRef.current = {};
    };
  }, []);

  const openOrderPad = (pos: Position, type: OrderType) => {
    setSelectedPosition(pos);
    setOrderType(type);
    setOrderOpen(true);
  };

  const handleRemoveHolding = (pos: Position) => {
    if (!confirm(`Remove ${pos.stockName} from holdings at current LTP?`)) return;
    const result = removeHolding(pos.id);
    toast({
      title: result.success ? "Holding Removed" : "Action Failed",
      description: result.message,
      variant: result.success ? "success" : "error",
    });
  };

  if (positions.length === 0) {
    return (
      <div className="terminal-panel p-8 text-center">
        <Briefcase size={38} className="mx-auto mb-3 text-[var(--terminal-subtle)] opacity-45" />
        <h3 className="mb-1 text-sm font-semibold text-[var(--terminal-fg)]">
          No Holdings Yet
        </h3>
        <p className="terminal-subtle mb-4 text-xs">
          Start paper trading to build your portfolio
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link
            href="/stocks"
            className="terminal-action gap-1.5"
          >
            <Search size={12} />
            Explore Stocks
          </Link>
          <Link
            href="/fno"
            className="terminal-action gap-1.5"
          >
            <CandlestickChart size={12} />
            Open F&O
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] font-semibold text-muted dark:text-muted-dark uppercase tracking-wider border-b border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
        <span className="col-span-3">Stock</span>
        <span className="col-span-2 text-right">LTP</span>
        <span className="col-span-1 text-right">Qty</span>
        <span className="col-span-2 text-right">Avg Price</span>
        <span className="col-span-2 text-right">P&L</span>
        <span className="col-span-2 text-right">Actions</span>
      </div>

      {/* Holdings */}
      {positions.map((pos) => {
        const isProfit = pos.pnl >= 0;
        const isCommodity = commodityTickers.has(pos.ticker);
        const isFno = isFnoPosition(pos);
        const underlying = isFno ? extractFnoUnderlying(pos) : "";
        const absQuantity = Math.abs(pos.quantity);
        const sideLabel = pos.quantity < 0 ? "SHORT" : "LONG";
        const href = isCommodity
          ? `/commodities/${pos.ticker}`
          : isFno
            ? `/fno?underlying=${encodeURIComponent(underlying)}&contract=${encodeURIComponent(pos.ticker)}`
            : `/stocks/${pos.ticker}`;
        return (
          <div
            key={pos.id}
            className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-surface/50 dark:hover:bg-white/[0.02] transition-all duration-150 border-b last:border-b-0 border-border/20 dark:border-border-dark/20"
          >
            <div className="col-span-3 flex items-center gap-2">
              <StockLogo ticker={pos.ticker} className="w-8 h-8 rounded-full flex-shrink-0" textClassName="text-[10px] font-bold" />
              <div className="min-w-0">
                <Link href={href} className="text-xs font-medium text-primary dark:text-primary-dark truncate hover:text-accent transition-colors block">
                  {pos.stockName}
                </Link>
                <div className="text-[10px] text-muted dark:text-muted-dark">
                  {pos.product} · {pos.strategy_tag}
                </div>
              </div>
            </div>

            <div className={cn(
              "col-span-2 text-right text-[13px] font-bold tracking-tight text-primary dark:text-primary-dark rounded px-1 tabular-nums",
              ltpFlash[pos.id] === "up" && "animate-pulse-green",
              ltpFlash[pos.id] === "down" && "animate-pulse-red"
            )}>
              {formatCurrency(pos.ltp)}
            </div>

            <div className="col-span-1 text-right text-[13px] font-semibold text-primary dark:text-primary-dark tabular-nums">
              <span className="block text-[10px] font-bold text-muted dark:text-muted-dark">{sideLabel}</span>
              {absQuantity}
            </div>

            <div className="col-span-2 text-right text-[12px] font-medium text-muted dark:text-gray-400 tabular-nums">
              {formatCurrency(pos.avg_price)}
            </div>

            <div className={cn("col-span-2 text-right tabular-nums tracking-tight", getPriceChangeColor(pos.pnl))}>
              <div className="text-[13px] font-bold">
                {isProfit ? "+" : ""}{formatCurrency(pos.pnl)}
              </div>
              <div className="text-[10px] font-semibold opacity-90">
                {formatPercentage(pos.pnl_percent)}
              </div>
            </div>

            <div className="col-span-2 flex justify-end gap-1.5">
              <button
                onClick={() => openOrderPad(pos, "BUY")}
                className="px-2 py-1 rounded text-[10px] font-semibold bg-profit/15 text-profit hover:bg-profit/25 transition-colors"
              >
                BUY
              </button>
              <button
                onClick={() => openOrderPad(pos, "SELL")}
                className="px-2 py-1 rounded text-[10px] font-semibold bg-loss/15 text-loss hover:bg-loss/25 transition-colors"
              >
                SELL
              </button>
              <button
                onClick={() => handleRemoveHolding(pos)}
                className="px-2 py-1 rounded text-[10px] font-semibold bg-muted/20 text-muted-dark hover:bg-muted/30 transition-colors"
              >
                REMOVE
              </button>
            </div>
          </div>
        );
      })}

      {selectedPosition && (
        <OrderPad
          open={orderOpen}
          onOpenChange={setOrderOpen}
          ticker={selectedPosition.ticker}
          stockName={selectedPosition.stockName}
          ltp={selectedPosition.ltp}
          defaultType={orderType}
          defaultProduct={selectedPosition.product}
          defaultStrategyTag={selectedPosition.strategy_tag}
          lotSize={inferFnoLotSize(selectedPosition)}
        />
      )}
    </div>
  );
}
