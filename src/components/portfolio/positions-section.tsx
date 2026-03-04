"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { usePortfolio } from "@/hooks/usePortfolio";
import { cn, formatCurrency, formatPercentage, getPriceChangeColor } from "@/lib/utils";
import { MOCK_COMMODITIES, FNO_UNDERLYINGS } from "@/lib/constants";
import { ArrowUpRight, ArrowDownRight, X, Zap, TrendingUp } from "lucide-react";
import Link from "next/link";
import { OrderPad } from "@/components/trading/order-pad";
import { StockLogo } from "@/components/market/stock-logo";
import { useToast } from "@/components/toast-provider";
import { useAllStreamPrices } from "@/hooks/usePriceStream";
import { API_CONFIG } from "@/lib/constants";
import type { OrderType, Position } from "@/lib/types";

function isFnoContractTicker(ticker: string): boolean {
    const symbol = ticker.toUpperCase();
    const isFuture = symbol.endsWith("FUT");
    const isOption = (symbol.endsWith("CE") || symbol.endsWith("PE")) && /\d/.test(symbol);
    return isFuture || isOption;
}

function isFnoPosition(position: Position): boolean {
    return isFnoContractTicker(position.ticker) || isFnoContractTicker(position.stockName || "");
}

function isIntradayPosition(position: Position): boolean {
    return position.product === "INTRADAY" && !isFnoPosition(position);
}

function extractFnoUnderlying(position: Position): string {
    const ticker = position.ticker.toUpperCase();
    const stockName = (position.stockName || "").toUpperCase();
    const hasUnderlying = (value: string) => FNO_UNDERLYINGS.some((u) => u.ticker === value);

    const tickerPrefixed = ticker.match(/^([A-Z]+)\d+(CE|PE)$/);
    if (tickerPrefixed?.[1] && hasUnderlying(tickerPrefixed[1])) return tickerPrefixed[1];
    const futPrefixed = ticker.match(/^([A-Z]+)FUT$/);
    if (futPrefixed?.[1] && hasUnderlying(futPrefixed[1])) return futPrefixed[1];
    for (const underlying of FNO_UNDERLYINGS) {
        if (stockName.includes(underlying.ticker)) return underlying.ticker;
    }
    return "NIFTY";
}

const COMMON_FNO_LOT_SIZES = [5500, 1600, 1100, 900, 750, 700, 550, 400, 350, 250, 175, 125, 100, 75, 65, 50, 30, 25, 20, 15];
function inferFnoLotSize(position: Position): number {
    if (!isFnoContractTicker(position.ticker)) return 1;
    if (position.lot_size && position.lot_size > 1) return position.lot_size;
    const qty = Math.max(1, Math.floor(position.quantity));
    const matched = COMMON_FNO_LOT_SIZES.find((lot) => qty % lot === 0);
    return matched ?? qty;
}

interface PositionCardProps {
    position: Position;
    flash?: "up" | "down";
    onExit: (pos: Position) => void;
    onBuy: (pos: Position) => void;
    onSell: (pos: Position) => void;
    type: "fno" | "intraday";
}

function PositionCard({ position, flash, onExit, onBuy, onSell, type }: PositionCardProps) {
    const pos = position;
    const isProfit = pos.pnl >= 0;
    const underlying = type === "fno" ? extractFnoUnderlying(pos) : "";
    const href = type === "fno"
        ? `/fno?underlying=${encodeURIComponent(underlying)}&contract=${encodeURIComponent(pos.ticker)}`
        : `/stocks/${pos.ticker}`;
    const lots = type === "fno" ? inferFnoLotSize(pos) : 1;
    const numLots = lots > 1 ? Math.floor(pos.quantity / lots) : pos.quantity;

    return (
        <div className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 border-border/20 dark:border-border-dark/20 hover:bg-surface/50 dark:hover:bg-white/[0.02] transition-colors group">
            {/* Stock info */}
            <StockLogo ticker={pos.ticker} className="w-9 h-9 rounded-full flex-shrink-0" textClassName="text-[10px] font-bold" />
            <div className="flex-1 min-w-0">
                <Link href={href} className="text-[13px] font-semibold text-primary dark:text-primary-dark truncate hover:text-accent transition-colors block">
                    {pos.stockName}
                </Link>
                <div className="text-[10px] text-muted dark:text-muted-dark flex items-center gap-1.5 font-medium mt-0.5">
                    {type === "fno" && lots > 1 && (
                        <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent font-bold">
                            {numLots} LOT{numLots > 1 ? "S" : ""}
                        </span>
                    )}
                    <span>{pos.quantity} qty</span>
                    <span>·</span>
                    <span className="tabular-nums">Avg {formatCurrency(pos.avg_price)}</span>
                </div>
            </div>

            {/* LTP */}
            <div className={cn(
                "text-right min-w-[70px] tabular-nums",
                flash === "up" && "animate-pulse-green rounded px-1",
                flash === "down" && "animate-pulse-red rounded px-1"
            )}>
                <div className="text-[13px] font-bold text-primary dark:text-primary-dark tracking-tight">
                    {formatCurrency(pos.ltp)}
                </div>
            </div>

            {/* P&L */}
            <div className={cn("text-right min-w-[80px]", getPriceChangeColor(pos.pnl))}>
                <div className="text-[13px] font-bold tabular-nums flex items-center justify-end gap-0.5 tracking-tight">
                    {isProfit ? <ArrowUpRight size={12} strokeWidth={2.5} /> : <ArrowDownRight size={12} strokeWidth={2.5} />}
                    {isProfit ? "+" : ""}{formatCurrency(pos.pnl)}
                </div>
                <div className="text-[10px] tabular-nums font-semibold opacity-90 inline-block">
                    {formatPercentage(pos.pnl_percent)}
                </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1.5 ml-3 opacity-90 group-hover:opacity-100 transition-opacity">
                <button
                    onClick={() => onBuy(pos)}
                    className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold bg-profit/10 text-profit hover:bg-profit/20 transition-all border border-profit/20 shadow-inner"
                >
                    BUY
                </button>
                <button
                    onClick={() => onSell(pos)}
                    className="px-2.5 py-1.5 rounded-lg text-[10px] font-bold bg-loss/10 text-loss hover:bg-loss/20 transition-all border border-loss/20 shadow-inner"
                >
                    SELL
                </button>
                <button
                    onClick={() => onExit(pos)}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-loss/15 text-loss hover:bg-loss hover:text-white transition-all flex items-center gap-1 border border-loss/25 shadow-inner"
                >
                    <X size={10} strokeWidth={3} />
                    EXIT
                </button>
            </div>
        </div>
    );
}

export function PositionsSection() {
    const { positions, removeHolding, updateLTP } = usePortfolio();
    const { prices, commodities } = useAllStreamPrices();
    const { toast } = useToast();
    const commodityTickers = useMemo(() => new Set(MOCK_COMMODITIES.map((c) => c.ticker)), []);

    const [orderOpen, setOrderOpen] = useState(false);
    const [orderType, setOrderType] = useState<OrderType>("BUY");
    const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
    const [ltpFlash, setLtpFlash] = useState<Record<string, "up" | "down">>({});
    const flashTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

    const fnoPositions = useMemo(() => positions.filter(isFnoPosition), [positions]);
    const intradayPositions = useMemo(() => positions.filter(isIntradayPosition), [positions]);

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

    // SSE-based price sync for intraday equity positions
    useEffect(() => {
        for (const pos of intradayPositions) {
            const isCommodity = commodityTickers.has(pos.ticker);
            const live = isCommodity ? commodities[pos.ticker]?.ltp : prices[pos.ticker]?.ltp;
            if (typeof live !== "number" || live <= 0 || live === pos.ltp) continue;
            flashAndUpdate(pos.id, pos.ticker, live, pos.ltp);
        }
    }, [intradayPositions, prices, commodities, flashAndUpdate, commodityTickers]);

    // Polling-based price sync for F&O positions
    useEffect(() => {
        if (fnoPositions.length === 0) return;
        let active = true;

        const fetchFnoPrices = async () => {
            for (const pos of fnoPositions) {
                if (!active) return;
                try {
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
                    // Fallback to option chain lookup
                    const underlying = extractFnoUnderlying(pos);
                    const isOption = pos.ticker.includes("CE") || pos.ticker.includes("PE");
                    if (isOption && underlying) {
                        const chainRes = await fetch(
                            `${API_CONFIG.baseUrl}/api/fno/option-chain?underlying=${encodeURIComponent(underlying)}`,
                            { cache: "no-store" }
                        );
                        if (chainRes.ok) {
                            const chainData = await chainRes.json();
                            const optionType = pos.ticker.includes("CE") ? "CE" : "PE";
                            const strikeMatch = pos.ticker.match(/\d+/);
                            if (strikeMatch) {
                                const strikePrice = Number(strikeMatch[0]);
                                const row = chainData.optionChain?.find((r: any) => r.strikePrice === strikePrice);
                                if (row && row[optionType]) {
                                    const ltp = Number(row[optionType].ltp);
                                    if (active && ltp > 0) {
                                        flashAndUpdate(pos.id, pos.ticker, ltp, pos.ltp);
                                        continue;
                                    }
                                }
                            }
                        }
                    }

                    // Final fallback to quote API (mostly for futures)
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
                    // ignore
                }
            }
        };

        fetchFnoPrices();
        const interval = setInterval(fetchFnoPrices, 3000);
        return () => { active = false; clearInterval(interval); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fnoPositions.map(p => p.id).join(","), flashAndUpdate]);

    useEffect(() => {
        return () => {
            for (const timer of Object.values(flashTimersRef.current)) clearTimeout(timer);
            flashTimersRef.current = {};
        };
    }, []);

    const handleExit = (pos: Position) => {
        if (!confirm(`Exit ${pos.stockName} at current LTP (₹${pos.ltp.toFixed(2)})?`)) return;
        const result = removeHolding(pos.id);
        toast({
            title: result.success ? "Position Exited" : "Exit Failed",
            description: result.message,
            variant: result.success ? "success" : "error",
        });
    };

    const openOrderPad = (pos: Position, type: OrderType) => {
        setSelectedPosition(pos);
        setOrderType(type);
        setOrderOpen(true);
    };

    if (fnoPositions.length === 0 && intradayPositions.length === 0) return null;

    return (
        <div className="space-y-4">
            {/* F&O Positions */}
            {fnoPositions.length > 0 && (
                <div className="glass-card overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-border dark:border-border-dark">
                        <Zap size={15} className="text-accent" />
                        <h3 className="text-[14px] font-bold text-primary dark:text-primary-dark tracking-tight leading-none">
                            F&O Positions
                        </h3>
                        <span className="ml-auto text-[11px] font-bold px-2 py-0.5 rounded-full bg-accent/10 text-accent">
                            {fnoPositions.length}
                        </span>
                    </div>
                    {fnoPositions.map((pos) => (
                        <PositionCard
                            key={pos.id}
                            position={pos}
                            flash={ltpFlash[pos.id]}
                            onExit={handleExit}
                            onBuy={(p) => openOrderPad(p, "BUY")}
                            onSell={(p) => openOrderPad(p, "SELL")}
                            type="fno"
                        />
                    ))}
                </div>
            )}

            {/* Intraday Positions */}
            {intradayPositions.length > 0 && (
                <div className="glass-card overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border dark:border-border-dark">
                        <TrendingUp size={14} className="text-profit" />
                        <h3 className="text-[13px] font-bold text-primary dark:text-primary-dark">
                            Intraday Positions
                        </h3>
                        <span className="ml-auto text-[11px] font-medium px-2 py-0.5 rounded-full bg-profit/10 text-profit">
                            {intradayPositions.length}
                        </span>
                    </div>
                    {intradayPositions.map((pos) => (
                        <PositionCard
                            key={pos.id}
                            position={pos}
                            flash={ltpFlash[pos.id]}
                            onExit={handleExit}
                            onBuy={(p) => openOrderPad(p, "BUY")}
                            onSell={(p) => openOrderPad(p, "SELL")}
                            type="intraday"
                        />
                    ))}
                </div>
            )}

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
