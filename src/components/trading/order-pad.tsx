"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { usePortfolio, useIsMobile } from "@/hooks/usePortfolio";
import { useToast } from "@/components/toast-provider";
import { StockLogo } from "@/components/market/stock-logo";
import type { OrderType, OrderVariety, ProductType, StrategyTag } from "@/lib/types";
import { STRATEGY_TAGS } from "@/lib/types";
import { estimateTradeCharges } from "@/lib/trading-charges";
import { estimateRequiredMargin } from "@/lib/risk-engine";

interface OrderPadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticker: string;
  stockName: string;
  ltp: number;
  defaultType?: OrderType;
  defaultProduct?: ProductType;
  defaultStrategyTag?: StrategyTag;
  lotSize?: number; // F&O lot size (1 for equities, >1 for F&O)
  defaultQuantity?: number;
  defaultVariety?: OrderVariety;
  defaultLimitPrice?: number;
  defaultTriggerPrice?: number;
}

export function OrderPad({
  open,
  onOpenChange,
  ticker,
  stockName,
  ltp,
  defaultType = "BUY",
  defaultProduct,
  defaultStrategyTag = "Manual",
  lotSize = 1,
  defaultQuantity = 1,
  defaultVariety = "MARKET",
  defaultLimitPrice,
  defaultTriggerPrice,
}: OrderPadProps) {
  const { balance, positions, placeOrder } = usePortfolio();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const isFnO = lotSize > 1;
  const initialProduct = isFnO ? "INTRADAY" : (defaultProduct ?? "DELIVERY");

  const [orderType, setOrderType] = useState<OrderType>(defaultType);
  const [variety, setVariety] = useState<OrderVariety>(defaultVariety);
  const [product, setProduct] = useState<ProductType>(initialProduct);
  const [strategyTag, setStrategyTag] = useState<StrategyTag>(defaultStrategyTag);
  const [quantity, setQuantity] = useState(1); // For F&O: number of lots; For equity: shares
  const [limitPrice, setLimitPrice] = useState(defaultLimitPrice ?? ltp);
  const [triggerPrice, setTriggerPrice] = useState(defaultTriggerPrice ?? ltp);

  useEffect(() => {
    if (!open) return;
    const initialQuantity = isFnO ? Math.max(1, Math.ceil(defaultQuantity / lotSize)) : Math.max(1, defaultQuantity);
    setOrderType(defaultType);
    setProduct(isFnO ? "INTRADAY" : (defaultProduct ?? "DELIVERY"));
    setStrategyTag(defaultStrategyTag);
    setVariety(defaultVariety);
    setQuantity(initialQuantity);
    setLimitPrice(defaultLimitPrice ?? ltp);
    setTriggerPrice(defaultTriggerPrice ?? ltp);
  }, [open, ticker, ltp, defaultType, defaultProduct, defaultStrategyTag, isFnO, defaultQuantity, lotSize, defaultVariety, defaultLimitPrice, defaultTriggerPrice]);

  const effectivePrice = variety === "MARKET" || variety === "SL-M" ? ltp : limitPrice;
  const totalQuantity = isFnO ? quantity * lotSize : quantity;
  const isBuy = orderType === "BUY";
  const marginProduct = product === "INTRADAY" || isFnO;
  const matchingQuantity = positions
    .filter((position) => position.ticker === ticker && position.product === product)
    .reduce((sum, position) => sum + position.quantity, 0);
  const signedDelta = isBuy ? totalQuantity : -totalQuantity;
  const openingQuantity = marginProduct
    ? (matchingQuantity === 0 || Math.sign(matchingQuantity) === Math.sign(signedDelta)
      ? Math.abs(signedDelta)
      : Math.max(0, Math.abs(signedDelta) - Math.abs(matchingQuantity)))
    : isBuy ? totalQuantity : 0;
  const charges = estimateTradeCharges({
    type: orderType,
    product,
    price: effectivePrice,
    quantity: totalQuantity,
    segment: isFnO ? "fno" : "equity",
  });
  const margin = estimateRequiredMargin({
    type: orderType,
    ticker,
    product,
    price: effectivePrice,
    quantity: totalQuantity,
    lotSize,
  });
  const openingMargin = openingQuantity > 0
    ? estimateRequiredMargin({
      type: orderType,
      ticker,
      product,
      price: effectivePrice,
      quantity: openingQuantity,
      lotSize,
    })
    : { ...margin, required: 0, leverage: 0 };
  const upfrontDebit = marginProduct ? openingMargin.required : isBuy ? margin.required : 0;
  const requiresTrigger = variety === "SL" || variety === "SL-M";
  const hasValidOrder = effectivePrice > 0 && totalQuantity > 0 && (!requiresTrigger || triggerPrice > 0);
  const insufficientBalance = hasValidOrder && upfrontDebit > 0 && balance < upfrontDebit;
  const settlementLabel = marginProduct
    ? openingQuantity > 0 ? "Margin required" : "Closes position"
    : isBuy ? "Upfront" : "Credit";
  const settlementValue = marginProduct
    ? upfrontDebit
    : isBuy ? upfrontDebit : charges.netAmount;

  const handleSubmit = () => {
    if (!hasValidOrder || insufficientBalance) {
      toast({
        title: insufficientBalance ? (marginProduct ? "Insufficient Margin" : "Insufficient Funds") : "Price Required",
        description: insufficientBalance
          ? `Required ${formatCurrency(upfrontDebit)}, available ${formatCurrency(balance)}.`
          : requiresTrigger ? "Stop-loss orders need a valid trigger price." : "Order entry needs a valid executable price.",
        variant: "error",
      });
      return;
    }

    if (quantity <= 0) {
      toast({
        title: "Invalid Quantity",
        description: "Quantity must be greater than 0 to place an order.",
        variant: "error",
      });
      return;
    }

    const result = placeOrder({
      type: orderType,
      ticker,
      stockName,
      price: effectivePrice,
      trigger_price: requiresTrigger ? triggerPrice : undefined,
      market_ltp: ltp,
      lot_size: lotSize,
      quantity: totalQuantity,
      variety,
      product,
      strategy_tag: strategyTag,
    });

    if (result.success) {
      const isQueued = result.order?.status === "PENDING";
      toast({
        title: isQueued ? `${orderType} Order Queued` : `${orderType} Order Executed`,
        description: result.message,
        variant: "success",
      });
      onOpenChange(false);
      setQuantity(1);
    } else {
      toast({
        title: "Order Failed",
        description: result.message,
        variant: "error",
      });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 animate-fade-in" />
        <Dialog.Content
          className={cn(
            "fixed z-50 terminal-panel outline-none",
            isMobile
              ? "bottom-0 left-0 right-0 rounded-t-sm max-h-[85vh] overflow-y-auto animate-slide-up"
              : "top-0 right-0 h-full w-[400px] border-l border-[color:var(--terminal-border)] animate-slide-right"
            )}
        >
          <Dialog.Title className="sr-only">
            {orderType} order ticket for {ticker}
          </Dialog.Title>
          <div className={cn(
            "terminal-panel-header px-4 py-3",
            isBuy ? "border-b-profit/20" : "border-b-loss/20"
          )}>
            <div className="flex min-w-0 items-center gap-3">
              <StockLogo ticker={ticker} className="h-9 w-9 flex-shrink-0 rounded-sm" textClassName="text-[9px]" />
              <div className="min-w-0">
                <div className="terminal-title truncate text-[12px]">
                  {stockName}
                </div>
                <div className="terminal-subtle font-mono text-[10px] uppercase tracking-[0.08em]">
                  {ticker} · NSE · {formatCurrency(ltp)}
                  {isFnO && <span className="ml-1 text-accent font-medium">· Lot {lotSize}</span>}
                </div>
              </div>
            </div>
            <Dialog.Close className="terminal-action flex h-7 w-7 items-center justify-center px-0">
              <X size={14} />
            </Dialog.Close>
          </div>

          <div className="space-y-4 px-4 py-4">
            <div className="grid grid-cols-2 gap-1.5 rounded-sm border border-[color:var(--terminal-grid)] bg-[var(--terminal-fill)] p-1">
              <button
                onClick={() => setOrderType("BUY")}
                className={cn(
                  "rounded-sm py-2 font-mono text-[12px] font-bold uppercase tracking-[0.1em] transition-all",
                  isBuy
                    ? "bg-profit text-white"
                    : "terminal-subtle hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-accent)]"
                )}
              >
                BUY
              </button>
              <button
                onClick={() => setOrderType("SELL")}
                className={cn(
                  "rounded-sm py-2 font-mono text-[12px] font-bold uppercase tracking-[0.1em] transition-all",
                  !isBuy
                    ? "bg-loss text-white"
                    : "terminal-subtle hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-accent)]"
                )}
              >
                SELL
              </button>
            </div>

            <div>
              <label className="terminal-subtle mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
                Product
              </label>
              {isFnO ? (
                <div className="rounded-sm border border-[color:var(--terminal-accent)] bg-[var(--terminal-accent-soft)] py-1.5 text-center font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--terminal-accent)]">
                  F&O Margin
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {(["DELIVERY", "INTRADAY"] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setProduct(p)}
                      className={cn(
                        "rounded-sm border py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] transition-all",
                        product === p
                          ? "border-[color:var(--terminal-accent)] bg-[var(--terminal-accent-soft)] text-[var(--terminal-accent)]"
                          : "border-[color:var(--terminal-grid)] text-[var(--terminal-subtle)] hover:border-[color:var(--terminal-accent)]"
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="terminal-subtle mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
                Order Type
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {(["MARKET", "LIMIT", "SL", "SL-M"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setVariety(v)}
                    className={cn(
                      "rounded-sm border py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.08em] transition-all",
                      variety === v
                        ? "border-[color:var(--terminal-accent)] bg-[var(--terminal-accent-soft)] text-[var(--terminal-accent)]"
                        : "border-[color:var(--terminal-grid)] text-[var(--terminal-subtle)] hover:border-[color:var(--terminal-accent)]"
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="terminal-subtle mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
                {isFnO ? `Lots (× ${lotSize})` : "Quantity"}
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setQuantity(Math.max(0, quantity - 1))}
                  className="terminal-action flex h-9 w-9 items-center justify-center px-0 text-base"
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  value={quantity}
                  onChange={(e) => {
                    const rawValue = e.target.value;
                    if (rawValue === "") {
                      setQuantity(0);
                      return;
                    }
                    const nextQuantity = parseInt(rawValue, 10);
                    if (Number.isNaN(nextQuantity)) return;
                    setQuantity(Math.max(0, nextQuantity));
                  }}
                  className="terminal-input terminal-number h-9 flex-1 px-3 text-center text-[13px] font-semibold outline-none focus:border-[color:var(--terminal-accent)]"
                />
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="terminal-action flex h-9 w-9 items-center justify-center px-0 text-base"
                >
                  +
                </button>
              </div>
              <div className="flex gap-1.5 mt-1.5">
                {(isFnO ? [1, 2, 5, 10, 20] : [1, 5, 10, 25, 50]).map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuantity(q)}
                    className={cn(
                      "flex-1 rounded-sm border py-1 font-mono text-[10px] font-bold transition-colors",
                      quantity === q
                        ? "border-[color:var(--terminal-accent)] bg-[var(--terminal-accent-soft)] text-[var(--terminal-accent)]"
                        : "border-[color:var(--terminal-grid)] text-[var(--terminal-subtle)]"
                    )}
                  >
                    {isFnO ? `${q}L` : q}
                  </button>
                ))}
              </div>
              {isFnO && (
                <div className="terminal-subtle mt-1 text-2xs">
                  {quantity} lot{quantity > 1 ? "s" : ""} = {totalQuantity.toLocaleString("en-IN")} shares
                </div>
              )}
            </div>

            {(variety === "LIMIT" || variety === "SL") && (
              <div>
                <label className="terminal-subtle mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
                  {variety === "SL" ? "Limit Price After Trigger" : "Limit Price"}
                </label>
                <input
                  type="number"
                  step="0.05"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(parseFloat(e.target.value) || 0)}
                  className="terminal-input terminal-number h-9 w-full px-3 text-[13px] font-semibold outline-none focus:border-[color:var(--terminal-accent)]"
                />
              </div>
            )}

            {requiresTrigger && (
              <div>
                <label className="terminal-subtle mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
                  Trigger Price
                </label>
                <input
                  type="number"
                  step="0.05"
                  value={triggerPrice}
                  onChange={(e) => setTriggerPrice(parseFloat(e.target.value) || 0)}
                  className="terminal-input terminal-number h-9 w-full px-3 text-[13px] font-semibold outline-none focus:border-[color:var(--terminal-accent)]"
                />
              </div>
            )}

            <div>
              <label className="terminal-subtle mb-1.5 block font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
                Strategy
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {STRATEGY_TAGS.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setStrategyTag(tag)}
                    className={cn(
                      "rounded-sm border py-1 font-mono text-[10px] font-bold transition-all",
                      strategyTag === tag
                        ? "border-[color:var(--terminal-accent)] bg-[var(--terminal-accent-soft)] text-[var(--terminal-accent)]"
                        : "border-[color:var(--terminal-grid)] text-[var(--terminal-subtle)] hover:border-[color:var(--terminal-accent)]"
                    )}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            <div className="terminal-data-cell space-y-1.5 rounded-sm p-3">
              <div className="terminal-subtle flex justify-between text-[11px]">
                <span>{isFnO ? `Price × ${quantity} lot${quantity > 1 ? "s" : ""} × ${lotSize}` : "Price × Qty"}</span>
                <span className="terminal-number font-medium text-[var(--terminal-fg)]">
                  {formatCurrency(effectivePrice)} × {totalQuantity.toLocaleString("en-IN")}
                </span>
              </div>
              <div className="terminal-subtle flex justify-between text-[11px]">
                <span>Est. charges</span>
                <span className="terminal-number font-medium text-[var(--terminal-fg)]">
                  {formatCurrency(charges.total)}
                </span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="terminal-subtle">{settlementLabel}</span>
                <span className="terminal-number font-semibold text-[var(--terminal-fg)]">
                  {openingQuantity > 0 || !marginProduct ? formatCurrency(settlementValue) : "No new margin"}
                </span>
              </div>
              {requiresTrigger && (
                <div className="terminal-subtle flex justify-between text-[11px]">
                  <span>Trigger</span>
                  <span className="terminal-number font-medium text-[var(--terminal-fg)]">{formatCurrency(triggerPrice)}</span>
                </div>
              )}
              {(marginProduct ? openingMargin.leverage : margin.leverage) > 1 && (
                <div className="terminal-subtle flex justify-between text-[11px]">
                  <span>Margin leverage</span>
                  <span className="terminal-number font-medium text-[var(--terminal-accent)]">
                    {(marginProduct ? openingMargin.leverage : margin.leverage).toFixed(2)}x
                  </span>
                </div>
              )}
              {(isBuy || upfrontDebit > 0) && (
                <div className="flex justify-between border-t border-[color:var(--terminal-grid)] pt-1.5 text-[11px]">
                  <span className="terminal-subtle">Available</span>
                  <span className={cn("terminal-number font-medium", !insufficientBalance ? "text-profit" : "text-loss")}>
                    {formatCurrency(balance)}
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={!hasValidOrder}
              className={cn(
                "w-full rounded-sm py-2.5 font-mono text-[13px] font-bold uppercase tracking-[0.12em] text-white transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45",
                isBuy
                  ? "bg-profit hover:bg-profit/90"
                  : "bg-loss hover:bg-loss/90"
              )}
            >
              {isBuy ? "BUY" : "SELL"} {ticker}
            </button>

            <p className="terminal-subtle text-center text-2xs">
              Simulated paper trade - no real money involved
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
