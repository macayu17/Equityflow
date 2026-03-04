"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { useCommodityQuote } from "@/hooks/useStockData";
import { useStreamCommodityPrice } from "@/hooks/usePriceStream";
import { usePortfolio } from "@/hooks/usePortfolio";
import { StockChart } from "@/components/market/stock-chart";
import { OrderPad } from "@/components/trading/order-pad";
import { cn, formatCurrency, formatPercentage, getPriceChangeColor, getPriceChangeBg } from "@/lib/utils";
import { MOCK_COMMODITIES } from "@/lib/constants";
import {
  ArrowUpRight,
  ArrowDownRight,
  Gem,
  BarChart3,
  Info,
} from "lucide-react";
import { MarketStatusBadge } from "@/components/market/market-status";
import type { OrderType } from "@/lib/types";

export default function CommodityDetailPage() {
  const params = useParams();
  const ticker = (params.ticker as string)?.toUpperCase() || "";
  const { data: httpQuote, isLoading } = useCommodityQuote(ticker);
  const streamPrice = useStreamCommodityPrice(ticker);
  const { positions, updateLTP } = usePortfolio();

  // Merge: SSE for fast LTP, HTTP for OHLC details
  const quote = httpQuote ? {
    ...httpQuote,
    ltp: streamPrice?.ltp ?? httpQuote.ltp,
    change: streamPrice?.change ?? httpQuote.change,
    changePercent: streamPrice?.changePercent ?? httpQuote.changePercent,
  } : streamPrice ? {
    ticker,
    name: streamPrice.name,
    exchange: "MCX" as const,
    ltp: streamPrice.ltp,
    change: streamPrice.change,
    changePercent: streamPrice.changePercent,
    open: 0, high: 0, low: 0, close: 0, volume: 0,
    timestamp: new Date().toISOString(),
    category: "", unit: "", expiry: "", lotSize: 1,
  } : null;

  const [orderOpen, setOrderOpen] = useState(false);
  const [orderType, setOrderType] = useState<OrderType>("BUY");
  const [pulseKey, setPulseKey] = useState(0);
  const prevPriceRef = useRef<number | null>(null);
  const [priceDir, setPriceDir] = useState<"up" | "down" | null>(null);

  const commodityInfo = MOCK_COMMODITIES.find((c) => c.ticker === ticker);
  const position = positions.find((p) => p.ticker === ticker);

  // Update position LTP
  useEffect(() => {
    if (quote) {
      updateLTP(ticker, quote.ltp);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.ltp, ticker, updateLTP]);

  // Detect price pulse
  useEffect(() => {
    if (quote && prevPriceRef.current !== null && quote.ltp !== prevPriceRef.current) {
      setPriceDir(quote.ltp > prevPriceRef.current ? "up" : "down");
      setPulseKey((k) => k + 1);
    }
    if (quote) prevPriceRef.current = quote.ltp;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.ltp]);

  const openOrder = (type: OrderType) => {
    setOrderType(type);
    setOrderOpen(true);
  };

  if (isLoading || !quote) {
    return (
      <div className="px-4 md:px-6 py-6 max-w-7xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-surface dark:bg-elevated-dark rounded w-1/3" />
          <div className="h-[400px] bg-surface dark:bg-elevated-dark rounded-lg" />
        </div>
      </div>
    );
  }

  const isPositive = quote.change >= 0;

  return (
    <div className="px-4 md:px-6 py-6 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Commodity Header */}
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 font-bold text-sm">
                  {ticker.slice(0, 2)}
                </div>
                <div>
                  <h1 className="text-xl font-bold text-primary dark:text-primary-dark">
                    {commodityInfo?.name || ticker}
                  </h1>
                  <div className="text-xs text-muted dark:text-muted-dark">
                    {ticker} · MCX{commodityInfo?.category ? ` · ${commodityInfo.category}` : ""}
                  </div>
                </div>
              </div>

              {/* Price */}
              <div className="flex items-baseline gap-3 mt-3">
                <div
                  key={pulseKey}
                  className={cn(
                    "text-3xl font-bold text-primary dark:text-primary-dark rounded px-1",
                    priceDir === "up" && "animate-pulse-green",
                    priceDir === "down" && "animate-pulse-red"
                  )}
                >
                  {formatCurrency(quote.ltp)}
                </div>
                <div className={cn("flex items-center gap-1 text-sm font-semibold", getPriceChangeColor(quote.change))}>
                  {isPositive ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                  {isPositive ? "+" : ""}{formatCurrency(Math.abs(quote.change))}
                  <span className={cn("px-1.5 py-0.5 rounded-full text-xs", getPriceChangeBg(quote.change))}>
                    {formatPercentage(quote.changePercent)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <MarketStatusBadge segment="commodity" showTiming={false} />
            </div>
          </div>

          {/* Chart — uses Groww charting API via backend; segment=COMMODITY, exchange=MCX */}
          <StockChart ticker={ticker} exchange="MCX" />

          {/* Performance */}
          <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark p-4 space-y-4">
            <h3 className="text-sm font-bold text-primary dark:text-primary-dark flex items-center gap-2">
              <BarChart3 size={16} className="text-amber-500" />
              Performance
            </h3>

            {/* Today's Range */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted dark:text-muted-dark">
                <span>Today&apos;s Low</span>
                <span>Today&apos;s High</span>
              </div>
              <div className="relative h-1.5 rounded-full bg-gradient-to-r from-loss via-yellow-400 to-profit">
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary dark:bg-white border-2 border-white dark:border-card-dark shadow-md"
                  style={{
                    left: `${Math.max(0, Math.min(100, quote.high !== quote.low ? ((quote.ltp - quote.low) / (quote.high - quote.low)) * 100 : 50))}%`,
                  }}
                />
              </div>
              <div className="flex justify-between text-xs font-medium text-primary dark:text-primary-dark">
                <span>{formatCurrency(quote.low)}</span>
                <span>{formatCurrency(quote.high)}</span>
              </div>
            </div>

            {/* Key Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
              {[
                { label: "Open", value: formatCurrency(quote.open) },
                { label: "Prev Close", value: formatCurrency(quote.close) },
                { label: "High", value: formatCurrency(quote.high) },
                { label: "Low", value: formatCurrency(quote.low) },
                { label: "Volume", value: quote.volume.toLocaleString("en-IN") },
                { label: "Lot Size", value: `${commodityInfo?.lotSize || "—"}` },
                { label: "Unit", value: commodityInfo?.unit || "—" },
                { label: "Expiry", value: commodityInfo?.expiry ? new Date(commodityInfo.expiry).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-md border border-border/50 dark:border-border-dark/50 p-2.5"
                >
                  <div className="text-[10px] text-muted dark:text-muted-dark uppercase tracking-wider mb-0.5">
                    {stat.label}
                  </div>
                  <div className="text-xs font-semibold text-primary dark:text-primary-dark">
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Contract Specifications */}
          <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark p-4 space-y-3">
            <h3 className="text-sm font-bold text-primary dark:text-primary-dark flex items-center gap-2">
              <Info size={16} className="text-amber-500" />
              Contract Specifications
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Exchange", value: "MCX" },
                { label: "Segment", value: "COMMODITY" },
                { label: "Category", value: commodityInfo?.category || "—" },
                { label: "Trading Unit", value: commodityInfo?.unit || "—" },
                { label: "Lot Size", value: `${commodityInfo?.lotSize || "—"}` },
                { label: "Expiry Date", value: commodityInfo?.expiry ? new Date(commodityInfo.expiry).toLocaleDateString("en-IN") : "—" },
                { label: "Contract Value", value: formatCurrency(quote.ltp * (commodityInfo?.lotSize || 1)) },
                { label: "Margin Required", value: formatCurrency(quote.ltp * (commodityInfo?.lotSize || 1) * 0.05) },
              ].map((item) => (
                <div key={item.label} className="flex justify-between items-center py-1.5 border-b border-border/30 dark:border-border-dark/30 last:border-b-0">
                  <span className="text-xs text-muted dark:text-muted-dark">{item.label}</span>
                  <span className="text-xs font-medium text-primary dark:text-primary-dark">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark p-4 sticky top-20">
            <div className="grid grid-cols-2 gap-3 mb-4">
              <button
                onClick={() => openOrder("BUY")}
                className="py-3 rounded-md bg-profit hover:bg-profit/90 text-white text-sm font-bold transition-colors active:scale-[0.98]"
              >
                BUY
              </button>
              <button
                onClick={() => openOrder("SELL")}
                className="py-3 rounded-md bg-loss hover:bg-loss/90 text-white text-sm font-bold transition-colors active:scale-[0.98]"
              >
                SELL
              </button>
            </div>

            {/* Position */}
            {position && (
              <div className="rounded-md bg-surface dark:bg-elevated-dark p-3 space-y-2">
                <div className="text-xs font-medium text-muted dark:text-muted-dark uppercase tracking-wider">
                  Your Position
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted dark:text-muted-dark">Quantity</span>
                  <span className="text-primary dark:text-primary-dark font-medium">{position.quantity}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted dark:text-muted-dark">Avg Price</span>
                  <span className="text-primary dark:text-primary-dark font-medium">{formatCurrency(position.avg_price)}</span>
                </div>
                <div className="flex justify-between text-xs pt-1 border-t border-border dark:border-border-dark">
                  <span className="text-muted dark:text-muted-dark">P&L</span>
                  <span className={cn("font-semibold", getPriceChangeColor(position.pnl))}>
                    {position.pnl >= 0 ? "+" : ""}{formatCurrency(position.pnl)} ({formatPercentage(position.pnl_percent)})
                  </span>
                </div>
              </div>
            )}

            {/* Info */}
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-1 text-xs text-muted dark:text-muted-dark">
                <Gem size={12} />
                <span>About {commodityInfo?.name || ticker}</span>
              </div>
              <p className="text-xs text-muted dark:text-muted-dark leading-relaxed">
                {commodityInfo?.name || ticker} is traded on MCX exchange.
                {commodityInfo?.category ? ` Category: ${commodityInfo.category}.` : ""}
                {" "}This is a paper trading simulation.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Order Pad Modal */}
      {quote && (
        <OrderPad
          open={orderOpen}
          onOpenChange={setOrderOpen}
          ticker={ticker}
          stockName={commodityInfo?.name || ticker}
          ltp={quote.ltp}
          defaultType={orderType}
          lotSize={commodityInfo?.lotSize || 1}
        />
      )}
    </div>
  );
}
