"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { useStockPrice, useMarketDepth, useStockDetails } from "@/hooks/useStockData";
import { useStreamPrice, useFastStockStream } from "@/hooks/usePriceStream";
import { usePortfolio } from "@/hooks/usePortfolio";
import { StockChart } from "@/components/market/stock-chart";
import { MarketDepthTable } from "@/components/market/market-depth";
import { StockLogo } from "@/components/market/stock-logo";
import { OrderPad } from "@/components/trading/order-pad";
import { cn, formatCurrency, formatPercentage, getPriceChangeColor, getPriceChangeBg } from "@/lib/utils";
import { MOCK_STOCKS } from "@/lib/constants";
import {
  ArrowUpRight,
  ArrowDownRight,
  Eye,
  Share2,
  Info,
  TrendingUp,
  BarChart3,
  Target,
  Activity,
} from "lucide-react";
import { MarketStatusBadge } from "@/components/market/market-status";
import { getMarketStatus } from "@/lib/market-hours";
import type { OrderType } from "@/lib/types";

export default function StockDetailPage() {
  const params = useParams();
  const ticker = (params.ticker as string)?.toUpperCase() || "";
  const fastStreamPrice = useFastStockStream(ticker);
  const streamPrice = useStreamPrice(ticker);
  const { data: ohlcQuote } = useStockPrice(ticker); // For OHLC data (open/high/low/close/volume)
  const { data: depth } = useMarketDepth(ticker);
  const { data: details } = useStockDetails(ticker);
  const { positions, updateLTP } = usePortfolio();

  const [orderOpen, setOrderOpen] = useState(false);
  const [orderType, setOrderType] = useState<OrderType>("BUY");
  const [pulseKey, setPulseKey] = useState(0);
  const prevPriceRef = useRef<number | null>(null);
  const [priceDir, setPriceDir] = useState<"up" | "down" | null>(null);

  const stockInfo = MOCK_STOCKS.find((s) => s.ticker === ticker);
  const position = positions.find((p) => p.ticker === ticker);
  const isEquityMarketOpen = getMarketStatus("equity").isOpen;

  // Use SSE stream for fast LTP, fall back to HTTP poll
  const ltp = fastStreamPrice?.ltp ?? streamPrice?.ltp ?? ohlcQuote?.ltp ?? 0;
  const change = fastStreamPrice?.change ?? streamPrice?.change ?? ohlcQuote?.change ?? 0;
  const changePercent = fastStreamPrice?.changePercent ?? streamPrice?.changePercent ?? ohlcQuote?.changePercent ?? 0;
  // Build a compatible quote object with all fields the template needs
  const quote = ltp > 0 ? {
    ltp,
    change,
    changePercent,
    exchange: ohlcQuote?.exchange ?? "NSE",
    open: ohlcQuote?.open ?? ltp,
    high: ohlcQuote?.high ?? ltp,
    low: ohlcQuote?.low ?? ltp,
    close: ohlcQuote?.close ?? ltp,
    volume: ohlcQuote?.volume ?? 0,
  } : null;

  // Update position LTP
  useEffect(() => {
    if (ltp > 0) {
      updateLTP(ticker, ltp);
    }
  }, [ltp, ticker, updateLTP]);

  // Detect price pulse
  useEffect(() => {
    if (ltp > 0 && prevPriceRef.current !== null && ltp !== prevPriceRef.current) {
      setPriceDir(ltp > prevPriceRef.current ? "up" : "down");
      setPulseKey((k) => k + 1);
    }
    if (ltp > 0) prevPriceRef.current = ltp;
  }, [ltp]);

  const openOrder = (type: OrderType) => {
    setOrderType(type);
    setOrderOpen(true);
  };

  if (!quote) {
    return (
      <div className="px-4 md:px-6 py-6 max-w-7xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-surface dark:bg-elevated-dark rounded-lg w-1/3" />
          <div className="h-[400px] bg-surface dark:bg-elevated-dark rounded-xl" />
        </div>
      </div>
    );
  }

  const isPositive = quote.change >= 0;

  // Details data (from backend /api/stock-details/)
  const fundamentals = details?.fundamentals;
  const technicals = details?.technicals;
  const sr = technicals?.supportResistance;
  const indicators = technicals?.indicators;
  const summary = technicals?.summary;

  return (
    <div className="px-4 md:px-6 py-6 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Stock Header */}
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <StockLogo ticker={ticker} className="w-12 h-12 rounded-full" textClassName="text-sm font-bold" />
                <div>
                  <h1 className="text-xl font-bold text-primary dark:text-primary-dark">
                    {stockInfo?.name || details?.name || ticker}
                  </h1>
                  <div className="text-xs text-secondary dark:text-secondary-dark mt-0.5">
                    {ticker} · {quote.exchange}{stockInfo?.sector ? ` · ${stockInfo.sector}` : ""}
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

            {/* Action buttons */}
            <div className="flex items-center gap-3">
              <MarketStatusBadge segment="equity" showTiming={false} />
              <button className="p-2 rounded-lg border border-border dark:border-border-dark hover:bg-surface dark:hover:bg-elevated-dark transition-colors">
                <Eye size={16} className="text-muted dark:text-muted-dark" />
              </button>
              <button className="p-2 rounded-lg border border-border dark:border-border-dark hover:bg-surface dark:hover:bg-elevated-dark transition-colors">
                <Share2 size={16} className="text-muted dark:text-muted-dark" />
              </button>
            </div>
          </div>

          {/* Chart */}
          <StockChart ticker={ticker} liveLtp={ltp} />

          {/* Performance Section */}
          <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark p-5 space-y-4">
            <h3 className="text-sm font-bold text-primary dark:text-primary-dark flex items-center gap-2">
              <BarChart3 size={16} className="text-accent" />
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
                  className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary dark:bg-primary-dark border-2 border-card dark:border-card-dark shadow-md"
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

            {/* 52W Range */}
            {details && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted dark:text-muted-dark">
                  <span>52W Low</span>
                  <span>52W High</span>
                </div>
                <div className="relative h-1.5 rounded-full bg-gradient-to-r from-loss via-yellow-400 to-profit">
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary dark:bg-primary-dark border-2 border-card dark:border-card-dark shadow-md"
                    style={{
                      left: `${Math.max(0, Math.min(100, details.week52High !== details.week52Low ? ((quote.ltp - details.week52Low) / (details.week52High - details.week52Low)) * 100 : 50))}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between text-xs font-medium text-primary dark:text-primary-dark">
                  <span>{formatCurrency(details.week52Low)}</span>
                  <span>{formatCurrency(details.week52High)}</span>
                </div>
              </div>
            )}

            {/* Key Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
              {[
                { label: "Open", value: formatCurrency(quote.open) },
                { label: "Prev Close", value: formatCurrency(quote.close) },
                { label: "Volume", value: quote.volume.toLocaleString("en-IN") },
                { label: "Total Traded Value", value: details?.totalTradedValue ? `₹${(details.totalTradedValue / 10000000).toFixed(2)} Cr` : "—" },
                { label: "Upper Circuit", value: details?.upperCircuit ? formatCurrency(details.upperCircuit) : "—" },
                { label: "Lower Circuit", value: details?.lowerCircuit ? formatCurrency(details.lowerCircuit) : "—" },
                { label: "52W High", value: details?.week52High ? formatCurrency(details.week52High) : "—" },
                { label: "52W Low", value: details?.week52Low ? formatCurrency(details.week52Low) : "—" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-lg border border-border/40 dark:border-border-dark/40 p-3"
                >
                  <div className="text-[10px] text-muted dark:text-muted-dark uppercase tracking-widest mb-1">
                    {stat.label}
                  </div>
                  <div className="text-xs font-bold text-primary dark:text-primary-dark">
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Fundamentals Section */}
          {fundamentals && (
            <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark p-5 space-y-4">
              <h3 className="text-sm font-bold text-primary dark:text-primary-dark flex items-center gap-2">
                <Info size={16} className="text-accent" />
                Fundamentals
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: "Market Cap", value: `₹${(fundamentals.marketCap / 100).toFixed(0)} Cr`, sub: fundamentals.marketCap > 50000 ? "Large Cap" : fundamentals.marketCap > 10000 ? "Mid Cap" : "Small Cap" },
                  { label: "P/E Ratio", value: fundamentals.pe.toFixed(2), sub: `Ind: ${fundamentals.industryPe.toFixed(2)}` },
                  { label: "P/B Ratio", value: fundamentals.pb.toFixed(2) },
                  { label: "EPS (TTM)", value: `₹${fundamentals.eps.toFixed(2)}` },
                  { label: "ROE", value: `${fundamentals.roe.toFixed(2)}%` },
                  { label: "Dividend Yield", value: `${fundamentals.dividendYield.toFixed(2)}%` },
                  { label: "Book Value", value: `₹${fundamentals.bookValue.toFixed(2)}` },
                  { label: "Face Value", value: `₹${fundamentals.faceValue}` },
                  { label: "Debt/Equity", value: fundamentals.debtToEquity.toFixed(2) },
                  { label: "Industry P/E", value: fundamentals.industryPe.toFixed(2) },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg border border-border/40 dark:border-border-dark/40 p-3"
                  >
                    <div className="text-[10px] text-muted dark:text-muted-dark uppercase tracking-widest mb-1">
                      {item.label}
                    </div>
                    <div className="text-xs font-bold text-primary dark:text-primary-dark">
                      {item.value}
                    </div>
                    {item.sub && (
                      <div className="text-[10px] text-secondary dark:text-secondary-dark mt-0.5">
                        {item.sub}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Technicals Section */}
          {technicals && (
            <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark p-5 space-y-4">
              <h3 className="text-sm font-bold text-primary dark:text-primary-dark flex items-center gap-2">
                <Activity size={16} className="text-accent" />
                Technicals
              </h3>

              {/* Summary Bar */}
              {summary && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted dark:text-muted-dark">Summary</span>
                    <span className={cn(
                      "text-xs font-semibold px-2 py-0.5 rounded-full",
                      summary.verdict === "Bullish" ? "bg-profit/10 text-profit" :
                      summary.verdict === "Bearish" ? "bg-loss/10 text-loss" :
                      "bg-yellow-500/10 text-yellow-500"
                    )}>
                      {summary.verdict}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 h-2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-loss rounded-l-full transition-all"
                      style={{ width: `${(summary.bearish / (summary.bearish + summary.neutral + summary.bullish)) * 100}%` }}
                    />
                    <div
                      className="h-full bg-yellow-400 transition-all"
                      style={{ width: `${(summary.neutral / (summary.bearish + summary.neutral + summary.bullish)) * 100}%` }}
                    />
                    <div
                      className="h-full bg-profit rounded-r-full transition-all"
                      style={{ width: `${(summary.bullish / (summary.bearish + summary.neutral + summary.bullish)) * 100}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted dark:text-muted-dark">
                    <span className="text-loss">{summary.bearish} Bearish</span>
                    <span>{summary.neutral} Neutral</span>
                    <span className="text-profit">{summary.bullish} Bullish</span>
                  </div>
                </div>
              )}

              {/* Indicators */}
              {indicators && (
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "RSI (14)", value: indicators.rsi.value, verdict: indicators.rsi.verdict, icon: <TrendingUp size={14} /> },
                    { label: "MACD", value: indicators.macd.value, verdict: indicators.macd.verdict, icon: <BarChart3 size={14} /> },
                    { label: "Beta", value: indicators.beta.value, verdict: indicators.beta.verdict, icon: <Activity size={14} /> },
                  ].map((ind) => (
                    <div
                      key={ind.label}
                      className="rounded-md border border-border/50 dark:border-border-dark/50 p-3 text-center"
                    >
                      <div className="flex items-center justify-center gap-1 text-muted dark:text-muted-dark mb-1">
                        {ind.icon}
                        <span className="text-[10px] uppercase tracking-wider">{ind.label}</span>
                      </div>
                      <div className="text-lg font-bold text-primary dark:text-primary-dark tabular-nums">
                        {ind.value}
                      </div>
                      <div className={cn(
                        "text-[10px] font-semibold mt-1 px-2 py-0.5 rounded-full inline-block",
                        ind.verdict === "Bullish" || ind.verdict === "Oversold" ? "bg-profit/10 text-profit" :
                        ind.verdict === "Bearish" || ind.verdict === "Overbought" ? "bg-loss/10 text-loss" :
                        ind.verdict === "Highly volatile" ? "bg-yellow-500/10 text-yellow-500" :
                        "bg-blue-500/10 text-blue-500"
                      )}>
                        {ind.verdict}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Support & Resistance */}
              {sr && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted dark:text-muted-dark">
                    <Target size={14} />
                    <span className="font-medium">Support & Resistance</span>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center">
                    {[
                      { label: "S3", value: sr.s3, type: "support" },
                      { label: "S2", value: sr.s2, type: "support" },
                      { label: "S1", value: sr.s1, type: "support" },
                      { label: "Pivot", value: sr.pivot, type: "pivot" },
                      { label: "R1", value: sr.r1, type: "resistance" },
                      { label: "R2", value: sr.r2, type: "resistance" },
                      { label: "R3", value: sr.r3, type: "resistance" },
                    ].map((level) => (
                      <div
                        key={level.label}
                        className={cn(
                          "rounded-md p-2 border",
                          level.type === "support" ? "border-loss/20 bg-loss/5" :
                          level.type === "resistance" ? "border-profit/20 bg-profit/5" :
                          "border-accent/20 bg-accent/5"
                        )}
                      >
                        <div className={cn(
                          "text-[10px] font-medium uppercase tracking-wider mb-1",
                          level.type === "support" ? "text-loss" :
                          level.type === "resistance" ? "text-profit" :
                          "text-accent"
                        )}>
                          {level.label}
                        </div>
                        <div className="text-xs font-bold text-primary dark:text-primary-dark tabular-nums">
                          {formatCurrency(level.value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Market Depth */}
          {isEquityMarketOpen && depth && <MarketDepthTable depth={depth} />}
        </div>

        {/* Right Sidebar */}
        <div className="space-y-4">
          {/* Buy/Sell Buttons */}
          <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark p-5 sticky top-20">
            <div className="grid grid-cols-2 gap-3 mb-4">
              <button
                onClick={() => openOrder("BUY")}
                className="py-3 rounded-lg bg-accent hover:bg-accent-dark text-white text-sm font-bold transition-colors active:scale-[0.98] shadow-xs"
              >
                BUY
              </button>
              <button
                onClick={() => openOrder("SELL")}
                className="py-3 rounded-lg bg-loss hover:bg-loss/90 text-white text-sm font-bold transition-colors active:scale-[0.98] shadow-xs"
              >
                SELL
              </button>
            </div>

            {/* Current Position */}
            {position && (
              <div className="rounded-lg bg-surface dark:bg-elevated-dark p-3.5 space-y-2.5">
                <div className="text-[10px] font-semibold text-muted dark:text-muted-dark uppercase tracking-widest">
                  Your Position
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-secondary dark:text-secondary-dark">Quantity</span>
                  <span className="text-primary dark:text-primary-dark font-medium">{position.quantity}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-secondary dark:text-secondary-dark">Avg Price</span>
                  <span className="text-primary dark:text-primary-dark font-medium">{formatCurrency(position.avg_price)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-secondary dark:text-secondary-dark">Invested</span>
                  <span className="text-primary dark:text-primary-dark font-medium">{formatCurrency(position.invested)}</span>
                </div>
                <div className="flex justify-between text-xs pt-2 border-t border-border dark:border-border-dark">
                  <span className="text-secondary dark:text-secondary-dark">P&L</span>
                  <span className={cn("font-semibold", getPriceChangeColor(position.pnl))}>
                    {position.pnl >= 0 ? "+" : ""}{formatCurrency(position.pnl)} ({formatPercentage(position.pnl_percent)})
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-secondary dark:text-secondary-dark">Strategy</span>
                  <span className="text-accent text-[10px] font-semibold bg-accent/[0.08] px-2 py-0.5 rounded-md">
                    {position.strategy_tag}
                  </span>
                </div>
              </div>
            )}

            {/* Stock Info */}
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-1 text-xs text-secondary dark:text-secondary-dark">
                <Info size={12} />
                <span>About {ticker}</span>
              </div>
              <p className="text-xs text-secondary dark:text-secondary-dark leading-relaxed">
                {stockInfo?.name || ticker} is listed on the {quote.exchange} exchange.
                {stockInfo?.sector ? ` Sector: ${stockInfo.sector}.` : ""}
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
          stockName={stockInfo?.name || ticker}
          ltp={quote.ltp}
          defaultType={orderType}
        />
      )}
    </div>
  );
}
