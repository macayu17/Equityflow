"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useFnoQuote, useOptionChain } from "@/hooks/useStockData";
import { cn, formatCurrency } from "@/lib/utils";
import { FNO_UNDERLYINGS, FNO_EXPIRY_DATES } from "@/lib/constants";
import { CandlestickChart, ArrowUpRight, ArrowDownRight, ChevronDown } from "lucide-react";
import { MarketStatusBadge } from "@/components/market/market-status";
import { StockChart } from "@/components/market/stock-chart";
import { OrderPad } from "@/components/trading/order-pad";
import type { OrderType } from "@/lib/types";

const TABS = ["Option Chain", "Futures"] as const;

type FutureRow = {
  ticker: string;
  expiry: string;
  ltp: number;
  change: number;
  changePercent: number;
  openInterest: number;
  volume: number;
  lotSize: number;
};

export default function FnoPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64 text-muted dark:text-muted-dark">Loading F&amp;O...</div>}>
      <FnoPageContent />
    </Suspense>
  );
}

function FnoPageContent() {
  const searchParams = useSearchParams();
  const initialUnderlying = searchParams.get("underlying")?.toUpperCase();
  const selectedFromQuery = FNO_UNDERLYINGS.find((u) => u.ticker === initialUnderlying);
  const [underlying, setUnderlying] = useState(FNO_UNDERLYINGS[0]);
  const [expiry, setExpiry] = useState(FNO_EXPIRY_DATES[0]);
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Option Chain");
  const [showUnderlyingSelect, setShowUnderlyingSelect] = useState(false);

  // Order pad state
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderType, setOrderType] = useState<OrderType>("BUY");
  const [orderTicker, setOrderTicker] = useState("");
  const [orderName, setOrderName] = useState("");
  const [orderLtp, setOrderLtp] = useState(0);
  const [orderLotSize, setOrderLotSize] = useState(1);

  // Option chart state
  const [chartOption, setChartOption] = useState<{ ticker: string; label: string } | null>(null);

  // Fetch live spot price
  const { data: quote } = useFnoQuote(underlying.ticker);
  const { data: optionChain } = useOptionChain(underlying.ticker, expiry, "NSE");

  useEffect(() => {
    if (selectedFromQuery && selectedFromQuery.ticker !== underlying.ticker) {
      setUnderlying(selectedFromQuery);
    }
  }, [selectedFromQuery, underlying.ticker]);

  // Prefer option-chain underlying spot, then live quote, then static fallback
  const spotPrice = optionChain?.underlyingLtp ?? quote?.ltp ?? underlying.ltp;
  // Calculate change from live quote or show 0 (no random jitter)
  const spotChange = quote ? quote.change : 0;
  const spotChangePercent = quote ? quote.changePercent : 0;

  const optionChainRows = useMemo(() => {
    const strikes = optionChain?.strikes;
    if (Array.isArray(strikes) && strikes.length > 0) {
      return strikes
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((row: any) => row?.CE && row?.PE)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((row: any) => ({
          strikePrice: Number(row.strikePrice),
          ce: {
            ticker: row.CE.tradingSymbol || `${underlying.ticker}${Math.round(Number(row.strikePrice))}CE`,
            underlying: underlying.ticker,
            strikePrice: Number(row.strikePrice),
            optionType: "CE" as const,
            expiry,
            expiryDate: new Date(expiry),
            lotSize: Number(row.CE.lotSize || underlying.lotSize),
            ltp: Number(row.CE.ltp || 0),
            change: Number(row.CE.change || 0),
            changePercent: Number(row.CE.changePct || 0),
            openInterest: Number(row.CE.openInterest || 0),
            oiChange: Number(row.CE.changeinOpenInterest || 0),
            volume: Number(row.CE.volume || 0),
            iv: Number(row.CE.greeks?.iv || 0),
            delta: Number(row.CE.greeks?.delta || 0),
            gamma: Number(row.CE.greeks?.gamma || 0),
            theta: Number(row.CE.greeks?.theta || 0),
            vega: Number(row.CE.greeks?.vega || 0),
          },
          pe: {
            ticker: row.PE.tradingSymbol || `${underlying.ticker}${Math.round(Number(row.strikePrice))}PE`,
            underlying: underlying.ticker,
            strikePrice: Number(row.strikePrice),
            optionType: "PE" as const,
            expiry,
            expiryDate: new Date(expiry),
            lotSize: Number(row.PE.lotSize || underlying.lotSize),
            ltp: Number(row.PE.ltp || 0),
            change: Number(row.PE.change || 0),
            changePercent: Number(row.PE.changePct || 0),
            openInterest: Number(row.PE.openInterest || 0),
            oiChange: Number(row.PE.changeinOpenInterest || 0),
            volume: Number(row.PE.volume || 0),
            iv: Number(row.PE.greeks?.iv || 0),
            delta: Number(row.PE.greeks?.delta || 0),
            gamma: Number(row.PE.greeks?.gamma || 0),
            theta: Number(row.PE.greeks?.theta || 0),
            vega: Number(row.PE.greeks?.vega || 0),
          },
        }));
    }

    return [];
  }, [optionChain, underlying.ticker, underlying.lotSize, expiry]);
  const futures = useMemo<FutureRow[]>(() => [], []);

  const openFnoOrder = (ticker: string, name: string, ltp: number, type: OrderType, lots: number = underlying.lotSize) => {
    setOrderTicker(ticker);
    setOrderName(name);
    setOrderLtp(ltp);
    setOrderType(type);
    setOrderLotSize(lots);
    setOrderOpen(true);
  };

  return (
    <div className="px-4 md:px-6 py-6 max-w-7xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-accent/10 dark:bg-accent/[0.12] flex items-center justify-center">
              <CandlestickChart size={17} className="text-accent" strokeWidth={2.2} />
            </div>
            <h1 className="text-xl font-bold text-primary dark:text-primary-dark">
              Futures & Options
            </h1>
          </div>
          <p className="text-[13px] text-secondary dark:text-secondary-dark ml-[42px]">
            Paper trade F&O with virtual margin
          </p>
        </div>
        <MarketStatusBadge segment="fno" />
      </div>

      {/* Underlying Selector + Spot Price */}
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
        <div className="relative">
          <button
            onClick={() => setShowUnderlyingSelect(!showUnderlyingSelect)}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-border dark:border-border-dark bg-card dark:bg-card-dark hover:border-accent/40 transition-all"
          >
            <span className="w-8 h-8 rounded-md bg-accent/10 flex items-center justify-center text-accent text-2xs font-bold">
              {underlying.ticker.slice(0, 2)}
            </span>
            <div className="text-left">
              <div className="text-[13px] font-semibold text-primary dark:text-primary-dark">
                {underlying.ticker}
              </div>
              <div className="text-2xs text-muted dark:text-muted-dark">
                Lot: {underlying.lotSize}
              </div>
            </div>
            <ChevronDown size={14} className="text-muted dark:text-muted-dark ml-2" />
          </button>
          {showUnderlyingSelect && (
            <div className="absolute top-full left-0 mt-1 z-20 w-56 rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark shadow-elevated py-1.5 animate-scale-in">
              {FNO_UNDERLYINGS.map((u) => (
                <button
                  key={u.ticker}
                  onClick={() => {
                    setUnderlying(u);
                    setShowUnderlyingSelect(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface dark:hover:bg-elevated-dark transition-colors",
                    underlying.ticker === u.ticker && "bg-accent/5"
                  )}
                >
                  <span className="w-6 h-6 rounded bg-accent/10 flex items-center justify-center text-accent text-2xs font-bold">
                    {u.ticker.slice(0, 2)}
                  </span>
                  <div>
                    <div className="text-[12px] font-medium text-primary dark:text-primary-dark">
                      {u.ticker}
                    </div>
                    <div className="text-2xs text-muted dark:text-muted-dark">Lot: {u.lotSize}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Spot Price */}
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums text-primary dark:text-primary-dark">
            {formatCurrency(spotPrice)}
          </span>
          <span className={cn(
            "flex items-center gap-0.5 text-[13px] font-semibold",
            spotChange >= 0 ? "text-profit" : "text-loss"
          )}>
            {spotChange >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {spotChange >= 0 ? "+" : ""}{spotChange.toFixed(2)} ({spotChangePercent.toFixed(2)}%)
          </span>
        </div>
      </div>

      {/* Underlying Chart */}
      <StockChart ticker={underlying.ticker} segment="CASH" height={320} />

      {/* Selected Option Contract Chart */}
      {chartOption && (
        <div className="rounded-xl border border-accent/20 bg-card dark:bg-card-dark overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border dark:border-border-dark bg-accent/[0.03] dark:bg-accent/[0.05]">
            <span className="text-[13px] font-semibold text-primary dark:text-primary-dark">
              {chartOption.label}
            </span>
            <button
              onClick={() => setChartOption(null)}
              className="p-1 rounded-xl border border-border dark:border-border-dark hover:bg-surface dark:hover:bg-elevated-dark hover:shadow-xs transition-all font-bold"
            >
              ✕
            </button>
          </div>
          <StockChart ticker={chartOption.ticker} exchange="NSE" segment="FNO" height={280} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-4 border-b border-border dark:border-border-dark">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "pb-2 text-[13px] font-bold border-b transition-colors -mb-px",
              activeTab === tab
                ? "border-accent text-accent"
                : "border-transparent text-muted dark:text-muted-dark hover:text-primary dark:hover:text-primary-dark"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "Option Chain" ? (
        <>
          {/* Expiry selector */}
          <div className="flex items-center gap-2">
            <span className="text-2xs font-medium text-muted dark:text-muted-dark">
              Expiry
            </span>
            <div className="flex gap-1.5">
              {FNO_EXPIRY_DATES.map((exp) => (
                <button
                  key={exp}
                  onClick={() => setExpiry(exp)}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-bold rounded-xl border transition-colors",
                    expiry === exp
                      ? "border-accent bg-accent/5 text-accent shadow-xs"
                      : "border-border dark:border-border-dark text-muted dark:text-muted-dark hover:border-accent/30"
                  )}
                >
                  {new Date(exp).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                </button>
              ))}
            </div>
          </div>

          {/* Option Chain Table */}
          <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border dark:border-border-dark bg-surface/50 dark:bg-elevated-dark/50">
                  <th className="px-1 py-2"></th>
                  <th colSpan={5} className="text-center py-2 text-profit font-semibold text-[12px] border-r border-border dark:border-border-dark">
                    CALLS
                  </th>
                  <th className="text-center py-2 text-2xs font-semibold text-primary dark:text-primary-dark">
                    STRIKE
                  </th>
                  <th colSpan={5} className="text-center py-2 text-loss font-semibold text-[12px] border-l border-border dark:border-border-dark">
                    PUTS
                  </th>
                  <th className="px-1 py-2"></th>
                </tr>
                <tr className="text-muted dark:text-muted-dark border-b border-border dark:border-border-dark bg-surface/30 dark:bg-elevated-dark/30">
                  <th className="px-1 py-1.5 text-center font-bold text-2xs">Trade</th>
                  <th className="px-2 py-1.5 text-right font-bold">OI</th>
                  <th className="px-2 py-1.5 text-right font-bold">Chg OI</th>
                  <th className="px-2 py-1.5 text-right font-bold">IV</th>
                  <th className="px-2 py-1.5 text-right font-bold">LTP</th>
                  <th className="px-2 py-1.5 text-right font-bold border-r border-border dark:border-border-dark">Chg</th>
                  <th className="px-3 py-1.5 text-center font-semibold text-primary dark:text-primary-dark">Price</th>
                  <th className="px-2 py-1.5 text-right font-bold border-l border-border dark:border-border-dark">Chg</th>
                  <th className="px-2 py-1.5 text-right font-bold">LTP</th>
                  <th className="px-2 py-1.5 text-right font-bold">IV</th>
                  <th className="px-2 py-1.5 text-right font-bold">Chg OI</th>
                  <th className="px-2 py-1.5 text-right font-bold">OI</th>
                  <th className="px-1 py-1.5 text-center font-bold text-2xs">Trade</th>
                </tr>
              </thead>
              <tbody>
                {optionChainRows.map((row) => {
                  const isATM = row.strikePrice === optionChainRows.reduce(
                    (closest, r) => Math.abs(r.strikePrice - spotPrice) < Math.abs(closest - spotPrice) ? r.strikePrice : closest,
                    optionChainRows[0]?.strikePrice || 0
                  );
                  const isITMCall = row.strikePrice < spotPrice;
                  const isITMPut = row.strikePrice > spotPrice;

                  const ceLabel = `${underlying.ticker} ${row.strikePrice} CE`;
                  const peLabel = `${underlying.ticker} ${row.strikePrice} PE`;

                  return (
                    <tr
                      key={row.strikePrice}
                      className={cn(
                        "border-b last:border-b-0 border-border/40 dark:border-border-dark/40 transition-colors hover:bg-surface/50 dark:hover:bg-elevated-dark/50 group",
                        isATM && "bg-accent/5 dark:bg-accent/10 font-medium"
                      )}
                    >
                      {/* Call trade buttons */}
                      <td className="px-1 py-1">
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openFnoOrder(row.ce.ticker, ceLabel, row.ce.ltp, "BUY", row.ce.lotSize)}
                            className="px-1 py-0.5 text-[9px] font-bold rounded bg-profit/10 text-profit hover:bg-profit/20 transition-colors"
                          >
                            B
                          </button>
                          <button
                            onClick={() => openFnoOrder(row.ce.ticker, ceLabel, row.ce.ltp, "SELL", row.ce.lotSize)}
                            className="px-1 py-0.5 text-[9px] font-bold rounded bg-loss/10 text-loss hover:bg-loss/20 transition-colors"
                          >
                            S
                          </button>
                        </div>
                      </td>

                      {/* Call side */}
                      <td className={cn("px-2 py-1.5 text-right tabular-nums", isITMCall ? "bg-profit/[0.03]" : "")}>
                        {(row.ce.openInterest / 1000).toFixed(0)}K
                      </td>
                      <td className={cn("px-2 py-1.5 text-right tabular-nums", isITMCall ? "bg-profit/[0.03]" : "", row.ce.oiChange >= 0 ? "text-profit" : "text-loss")}>
                        {row.ce.oiChange >= 0 ? "+" : ""}{(row.ce.oiChange / 1000).toFixed(1)}K
                      </td>
                      <td className={cn("px-2 py-1.5 text-right tabular-nums text-secondary dark:text-secondary-dark", isITMCall ? "bg-profit/[0.03]" : "")}>
                        {row.ce.iv.toFixed(1)}%
                      </td>
                      <td
                        onClick={() => setChartOption({ ticker: row.ce.ticker, label: ceLabel })}
                        className={cn("px-2 py-1.5 text-right tabular-nums font-medium text-primary dark:text-primary-dark cursor-pointer hover:text-accent hover:underline", isITMCall ? "bg-profit/[0.03]" : "")}>
                        {row.ce.ltp.toFixed(2)}
                      </td>
                      <td className={cn("px-2 py-1.5 text-right tabular-nums border-r border-border dark:border-border-dark", isITMCall ? "bg-profit/[0.03]" : "", row.ce.change >= 0 ? "text-profit" : "text-loss")}>
                        {row.ce.change >= 0 ? "+" : ""}{row.ce.change.toFixed(2)}
                      </td>

                      {/* Strike */}
                      <td className={cn(
                        "px-3 py-1.5 text-center font-semibold tabular-nums text-primary dark:text-primary-dark",
                        isATM && "text-accent"
                      )}>
                        {row.strikePrice}
                      </td>

                      {/* Put side */}
                      <td className={cn("px-2 py-1.5 text-right tabular-nums border-l border-border dark:border-border-dark", isITMPut ? "bg-loss/[0.03]" : "", row.pe.change >= 0 ? "text-profit" : "text-loss")}>
                        {row.pe.change >= 0 ? "+" : ""}{row.pe.change.toFixed(2)}
                      </td>
                      <td
                        onClick={() => setChartOption({ ticker: row.pe.ticker, label: peLabel })}
                        className={cn("px-2 py-1.5 text-right tabular-nums font-medium text-primary dark:text-primary-dark cursor-pointer hover:text-accent hover:underline", isITMPut ? "bg-loss/[0.03]" : "")}>
                        {row.pe.ltp.toFixed(2)}
                      </td>
                      <td className={cn("px-2 py-1.5 text-right tabular-nums text-secondary dark:text-secondary-dark", isITMPut ? "bg-loss/[0.03]" : "")}>
                        {row.pe.iv.toFixed(1)}%
                      </td>
                      <td className={cn("px-2 py-1.5 text-right tabular-nums", isITMPut ? "bg-loss/[0.03]" : "", row.pe.oiChange >= 0 ? "text-profit" : "text-loss")}>
                        {row.pe.oiChange >= 0 ? "+" : ""}{(row.pe.oiChange / 1000).toFixed(1)}K
                      </td>
                      <td className={cn("px-2 py-1.5 text-right tabular-nums", isITMPut ? "bg-loss/[0.03]" : "")}>
                        {(row.pe.openInterest / 1000).toFixed(0)}K
                      </td>

                      {/* Put trade buttons */}
                      <td className="px-1 py-1">
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openFnoOrder(row.pe.ticker, peLabel, row.pe.ltp, "BUY", row.pe.lotSize)}
                            className="px-1 py-0.5 text-[9px] font-bold rounded bg-profit/10 text-profit hover:bg-profit/20 transition-colors"
                          >
                            B
                          </button>
                          <button
                            onClick={() => openFnoOrder(row.pe.ticker, peLabel, row.pe.ltp, "SELL", row.pe.lotSize)}
                            className="px-1 py-0.5 text-[9px] font-bold rounded bg-loss/10 text-loss hover:bg-loss/20 transition-colors"
                          >
                            S
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Greeks Legend */}
          <div className="text-2xs text-muted dark:text-muted-dark text-center">
            OI = Open Interest · IV = Implied Volatility · LTP = Last Traded Price · ATM strike highlighted · Hover row to trade
          </div>
        </>
      ) : (
        /* Futures Tab */
        <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark overflow-hidden">
          <div className="grid grid-cols-8 gap-2 px-4 py-2.5 text-2xs font-medium text-muted dark:text-muted-dark uppercase tracking-wider border-b border-border dark:border-border-dark bg-surface/50 dark:bg-elevated-dark/50">
            <span className="col-span-2">Contract</span>
            <span className="text-right">LTP</span>
            <span className="text-right">Change</span>
            <span className="text-right">OI</span>
            <span className="text-right">Volume</span>
            <span className="text-right">Lot Size</span>
            <span className="text-center">Trade</span>
          </div>
          {futures.map((fut) => {
            const futLabel = `${underlying.ticker} FUT ${new Date(fut.expiry).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`;
            return (
              <div
                key={fut.expiry}
                className="grid grid-cols-8 gap-2 px-4 py-3 items-center border-b last:border-b-0 border-border/40 dark:border-border-dark/40 hover:bg-surface/50 dark:hover:bg-elevated-dark/30 transition-colors"
              >
                <div className="col-span-2">
                  <div className="text-[12px] font-medium text-primary dark:text-primary-dark">
                    {underlying.ticker} FUT
                  </div>
                  <div className="text-2xs text-muted dark:text-muted-dark">
                    {new Date(fut.expiry).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </div>
                </div>
                <div className="text-right text-[12px] font-medium tabular-nums text-primary dark:text-primary-dark">
                  {formatCurrency(fut.ltp)}
                </div>
                <div className={cn("text-right text-[12px] font-medium tabular-nums", fut.change >= 0 ? "text-profit" : "text-loss")}>
                  {fut.change >= 0 ? "+" : ""}{fut.change.toFixed(2)} ({fut.changePercent.toFixed(2)}%)
                </div>
                <div className="text-right text-[12px] tabular-nums text-secondary dark:text-secondary-dark">
                  {(fut.openInterest / 1000).toFixed(0)}K
                </div>
                <div className="text-right text-[12px] tabular-nums text-secondary dark:text-secondary-dark">
                  {(fut.volume / 1000).toFixed(0)}K
                </div>
                <div className="text-right text-[12px] tabular-nums text-muted dark:text-muted-dark">
                  {fut.lotSize}
                </div>
                <div className="flex justify-center gap-1.5">
                  <button
                    onClick={() => openFnoOrder(fut.ticker, futLabel, fut.ltp, "BUY", fut.lotSize)}
                    className="px-2 py-1 text-[10px] font-bold rounded bg-profit/10 text-profit hover:bg-profit hover:text-white transition-colors"
                  >
                    BUY
                  </button>
                  <button
                    onClick={() => openFnoOrder(fut.ticker, futLabel, fut.ltp, "SELL", fut.lotSize)}
                    className="px-2 py-1 text-[10px] font-bold rounded bg-loss/10 text-loss hover:bg-loss hover:text-white transition-colors"
                  >
                    SELL
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-2xs text-center text-muted dark:text-muted-dark">
        Paper trading F&O — all data from Groww API when available
      </p>

      {/* F&O Order Pad */}
      {orderOpen && (
        <OrderPad
          open={orderOpen}
          onOpenChange={setOrderOpen}
          ticker={orderTicker}
          stockName={orderName}
          ltp={orderLtp}
          defaultType={orderType}
          lotSize={orderLotSize}
        />
      )}
    </div>
  );
}
