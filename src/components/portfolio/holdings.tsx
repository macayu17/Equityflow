"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { usePortfolio } from "@/hooks/usePortfolio";
import { cn, formatCurrency, formatPercentage, getPriceChangeColor } from "@/lib/utils";
import { MOCK_COMMODITIES, FNO_UNDERLYINGS } from "@/lib/constants";
import { Briefcase, ArrowUpRight, ArrowDownRight } from "lucide-react";
import Link from "next/link";
import { OrderPad } from "@/components/trading/order-pad";
import { StockLogo } from "@/components/market/stock-logo";
import { useToast } from "@/components/toast-provider";
import { useAllStreamPrices } from "@/hooks/usePriceStream";
import { API_CONFIG } from "@/lib/constants";
import type { OrderType, Position } from "@/lib/types";

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
  const { summary, balance } = usePortfolio();

  const cards = [
    { label: "Invested", value: summary.totalInvested, color: "text-primary dark:text-primary-dark" },
    { label: "Current Value", value: summary.currentValue, color: "text-primary dark:text-primary-dark" },
    { label: "Total Returns", value: summary.totalPnl, pct: summary.totalPnlPercent, dynamic: true },
    { label: "Day Returns", value: summary.dayPnl, pct: summary.dayPnlPercent, dynamic: true },
  ];

  return (
    <div className="space-y-4">
      {/* Virtual Balance Banner */}
      <div className="relative rounded-2xl overflow-hidden">
        <div className="absolute inset-0 bg-accent" />
        <div className="relative p-5 text-white">
          <div className="text-sm font-medium opacity-80 mb-1">Virtual Wallet Balance</div>
          <div className="text-3xl font-bold tabular-nums tracking-tight">{formatCurrency(balance)}</div>
          <div className="text-xs font-medium opacity-60 mt-1.5">Paper Trading Account</div>
        </div>
      </div>

      {/* Summary Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="premium-card p-3.5"
          >
            <div className="text-[11px] text-muted dark:text-muted-dark mb-1.5 font-medium uppercase tracking-wider">
              {card.label}
            </div>
            <div className={cn("text-base font-bold tabular-nums", card.dynamic ? getPriceChangeColor(card.value) : card.color)}>
              {card.dynamic && card.value > 0 && "+"}
              {formatCurrency(card.value)}
            </div>
            {card.dynamic && card.pct !== undefined && (
              <div className={cn("text-xs font-medium mt-1 flex items-center gap-0.5", getPriceChangeColor(card.value))}>
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
          const resolveRes = await fetch(
            `${API_CONFIG.baseUrl}/api/fno/resolve?ticker=${encodeURIComponent(simplified)}`,
            { cache: "no-store" }
          );
          if (resolveRes.ok) {
            const resolveData = await resolveRes.json();
            if (resolveData?.resolved && resolveData.tradingSymbol) {
              const quoteRes = await fetch(
                `${API_CONFIG.baseUrl}/api/quote?exchange=NSE&segment=FNO&trading_symbol=${encodeURIComponent(resolveData.tradingSymbol)}`,
                { cache: "no-store" }
              );
              if (quoteRes.ok) {
                const q = await quoteRes.json();
                const ltp = Number(q.ltp);
                if (active && ltp > 0) {
                  flashAndUpdate(pos.id, pos.ticker, ltp, pos.ltp);
                }
                continue;
              }
            }
          }

          // Fallback: direct FNO quote endpoint
          const res = await fetch(
            `${API_CONFIG.baseUrl}/api/fno/quote/${encodeURIComponent(pos.ticker)}`,
            { cache: "no-store" }
          );
          if (res.ok) {
            const q = await res.json();
            const ltp = Number(q.ltp);
            if (active && ltp > 0) {
              flashAndUpdate(pos.id, pos.ticker, ltp, pos.ltp);
            }
          }
        } catch {
          // Ignore individual fetch errors — will retry next cycle
        }
      }
    };

    fetchFnoPrices();
    const interval = setInterval(fetchFnoPrices, 5000);

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
      <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark p-8 text-center">
        <Briefcase size={40} className="mx-auto text-muted/30 dark:text-muted-dark/30 mb-3" />
        <h3 className="text-sm font-medium text-primary dark:text-primary-dark mb-1">
          No Holdings Yet
        </h3>
        <p className="text-xs text-muted dark:text-muted-dark mb-4">
          Start paper trading to build your portfolio
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-1 px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors"
        >
          Explore Stocks
        </Link>
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
              {pos.quantity}
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
