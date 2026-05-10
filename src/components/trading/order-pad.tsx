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
  const { balance, placeOrder } = usePortfolio();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const isFnO = lotSize > 1;

  const [orderType, setOrderType] = useState<OrderType>(defaultType);
  const [variety, setVariety] = useState<OrderVariety>(defaultVariety);
  const [product, setProduct] = useState<ProductType>(defaultProduct ?? (isFnO ? "INTRADAY" : "DELIVERY"));
  const [strategyTag, setStrategyTag] = useState<StrategyTag>(defaultStrategyTag);
  const [quantity, setQuantity] = useState(1); // For F&O: number of lots; For equity: shares
  const [limitPrice, setLimitPrice] = useState(defaultLimitPrice ?? ltp);
  const [triggerPrice, setTriggerPrice] = useState(defaultTriggerPrice ?? ltp);

  useEffect(() => {
    if (!open) return;
    const initialQuantity = isFnO ? Math.max(1, Math.ceil(defaultQuantity / lotSize)) : Math.max(1, defaultQuantity);
    setOrderType(defaultType);
    setProduct(defaultProduct ?? (isFnO ? "INTRADAY" : "DELIVERY"));
    setStrategyTag(defaultStrategyTag);
    setVariety(defaultVariety);
    setQuantity(initialQuantity);
    setLimitPrice(defaultLimitPrice ?? ltp);
    setTriggerPrice(defaultTriggerPrice ?? ltp);
  }, [open, ticker, ltp, defaultType, defaultProduct, defaultStrategyTag, isFnO, defaultQuantity, lotSize, defaultVariety, defaultLimitPrice, defaultTriggerPrice]);

  const effectivePrice = variety === "MARKET" || variety === "SL-M" ? ltp : limitPrice;
  const totalQuantity = isFnO ? quantity * lotSize : quantity;
  const isBuy = orderType === "BUY";
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
  const upfrontDebit = margin.required;
  const requiresTrigger = variety === "SL" || variety === "SL-M";
  const hasValidOrder = effectivePrice > 0 && totalQuantity > 0 && (!requiresTrigger || triggerPrice > 0);

  const handleSubmit = () => {
    if (!hasValidOrder || (isBuy && balance < upfrontDebit)) {
      const insufficientFunds = isBuy && hasValidOrder && balance < upfrontDebit;
      toast({
        title: insufficientFunds ? "Insufficient Funds" : "Price Required",
        description: insufficientFunds
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
            "fixed z-50 bg-card dark:bg-card-dark outline-none",
            isMobile
              ? "bottom-0 left-0 right-0 rounded-t-xl max-h-[85vh] overflow-y-auto animate-slide-up shadow-modal"
              : "top-0 right-0 h-full w-[400px] border-l border-border dark:border-border-dark animate-slide-right shadow-elevated"
            )}
        >
          <Dialog.Title className="sr-only">
            {orderType} order ticket for {ticker}
          </Dialog.Title>
          {/* Header */}
          <div className={cn(
            "flex items-center justify-between px-5 py-3.5 border-b border-border dark:border-border-dark",
            isBuy ? "bg-profit/[0.03]" : "bg-loss/[0.03]"
          )}>
            <div className="flex min-w-0 items-center gap-3">
              <StockLogo ticker={ticker} className="h-9 w-9 flex-shrink-0 rounded-sm" textClassName="text-[9px]" />
              <div className="min-w-0">
              <div className="text-[13px] font-semibold text-primary dark:text-primary-dark">
                {stockName}
              </div>
              <div className="text-[11px] text-muted dark:text-muted-dark">
                {ticker} · NSE · {formatCurrency(ltp)}
                {isFnO && <span className="ml-1 text-accent font-medium">· Lot {lotSize}</span>}
              </div>
              </div>
            </div>
            <Dialog.Close className="p-1 rounded-md hover:bg-surface dark:hover:bg-elevated-dark transition-colors">
              <X size={16} className="text-muted dark:text-muted-dark" />
            </Dialog.Close>
          </div>

          <div className="px-5 py-4 space-y-4">
            {/* Buy/Sell Toggle */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-md bg-surface dark:bg-elevated-dark">
              <button
                onClick={() => setOrderType("BUY")}
                className={cn(
                  "py-2 rounded text-[13px] font-semibold transition-all",
                  isBuy
                    ? "bg-profit text-white shadow-xs"
                    : "text-muted dark:text-muted-dark hover:text-primary dark:hover:text-primary-dark"
                )}
              >
                BUY
              </button>
              <button
                onClick={() => setOrderType("SELL")}
                className={cn(
                  "py-2 rounded text-[13px] font-semibold transition-all",
                  !isBuy
                    ? "bg-loss text-white shadow-xs"
                    : "text-muted dark:text-muted-dark hover:text-primary dark:hover:text-primary-dark"
                )}
              >
                SELL
              </button>
            </div>

            {/* Product */}
            <div>
              <label className="text-[11px] font-medium text-muted dark:text-muted-dark uppercase tracking-wider mb-1.5 block">
                Product
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {(["DELIVERY", "INTRADAY"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setProduct(p)}
                    className={cn(
                      "py-1.5 rounded text-[12px] font-medium border transition-all",
                      product === p
                        ? "border-accent bg-accent-muted dark:bg-accent-muted-dark text-accent"
                        : "border-border dark:border-border-dark text-muted dark:text-muted-dark hover:border-accent/30"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Order Type */}
            <div>
              <label className="text-[11px] font-medium text-muted dark:text-muted-dark uppercase tracking-wider mb-1.5 block">
                Order Type
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {(["MARKET", "LIMIT", "SL", "SL-M"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setVariety(v)}
                    className={cn(
                      "py-1.5 rounded text-[12px] font-medium border transition-all",
                      variety === v
                        ? "border-accent bg-accent-muted dark:bg-accent-muted-dark text-accent"
                        : "border-border dark:border-border-dark text-muted dark:text-muted-dark hover:border-accent/30"
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {/* Quantity */}
            <div>
              <label className="text-[11px] font-medium text-muted dark:text-muted-dark uppercase tracking-wider mb-1.5 block">
                {isFnO ? `Lots (× ${lotSize})` : "Quantity"}
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setQuantity(Math.max(0, quantity - 1))}
                  className="w-9 h-9 rounded border border-border dark:border-border-dark flex items-center justify-center text-base font-medium hover:border-accent transition-colors text-secondary dark:text-secondary-dark"
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
                  className="flex-1 h-9 rounded border border-border dark:border-border-dark bg-transparent text-center text-[13px] font-semibold tabular-nums text-primary dark:text-primary-dark outline-none focus:border-accent transition-colors"
                />
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="w-9 h-9 rounded border border-border dark:border-border-dark flex items-center justify-center text-base font-medium hover:border-accent transition-colors text-secondary dark:text-secondary-dark"
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
                      "flex-1 py-1 text-[11px] rounded border transition-colors",
                      quantity === q
                        ? "border-accent text-accent bg-accent-muted dark:bg-accent-muted-dark"
                        : "border-border dark:border-border-dark text-muted dark:text-muted-dark"
                    )}
                  >
                    {isFnO ? `${q}L` : q}
                  </button>
                ))}
              </div>
              {isFnO && (
                <div className="text-2xs text-muted dark:text-muted-dark mt-1">
                  {quantity} lot{quantity > 1 ? "s" : ""} = {totalQuantity.toLocaleString("en-IN")} shares
                </div>
              )}
            </div>

            {/* Limit Price */}
            {(variety === "LIMIT" || variety === "SL") && (
              <div>
                <label className="text-[11px] font-medium text-muted dark:text-muted-dark uppercase tracking-wider mb-1.5 block">
                  {variety === "SL" ? "Limit Price After Trigger" : "Limit Price"}
                </label>
                <input
                  type="number"
                  step="0.05"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(parseFloat(e.target.value) || 0)}
                  className="w-full h-9 rounded border border-border dark:border-border-dark bg-transparent px-3 text-[13px] font-semibold tabular-nums text-primary dark:text-primary-dark outline-none focus:border-accent transition-colors"
                />
              </div>
            )}

            {requiresTrigger && (
              <div>
                <label className="text-[11px] font-medium text-muted dark:text-muted-dark uppercase tracking-wider mb-1.5 block">
                  Trigger Price
                </label>
                <input
                  type="number"
                  step="0.05"
                  value={triggerPrice}
                  onChange={(e) => setTriggerPrice(parseFloat(e.target.value) || 0)}
                  className="w-full h-9 rounded border border-border dark:border-border-dark bg-transparent px-3 text-[13px] font-semibold tabular-nums text-primary dark:text-primary-dark outline-none focus:border-accent transition-colors"
                />
              </div>
            )}

            {/* Strategy Tag */}
            <div>
              <label className="text-[11px] font-medium text-muted dark:text-muted-dark uppercase tracking-wider mb-1.5 block">
                Strategy
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {STRATEGY_TAGS.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setStrategyTag(tag)}
                    className={cn(
                      "py-1 rounded text-[11px] font-medium border transition-all",
                      strategyTag === tag
                        ? "border-accent bg-accent-muted dark:bg-accent-muted-dark text-accent"
                        : "border-border dark:border-border-dark text-muted dark:text-muted-dark hover:border-accent/30"
                    )}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div className="rounded-md bg-surface dark:bg-elevated-dark p-3 space-y-1.5">
              <div className="flex justify-between text-[11px] text-muted dark:text-muted-dark">
                <span>{isFnO ? `Price × ${quantity} lot${quantity > 1 ? "s" : ""} × ${lotSize}` : "Price × Qty"}</span>
                <span className="text-primary dark:text-primary-dark font-medium tabular-nums">
                  {formatCurrency(effectivePrice)} × {totalQuantity.toLocaleString("en-IN")}
                </span>
              </div>
              <div className="flex justify-between text-[11px] text-muted dark:text-muted-dark">
                <span>Est. charges</span>
                <span className="text-primary dark:text-primary-dark font-medium tabular-nums">
                  {formatCurrency(charges.total)}
                </span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="text-muted dark:text-muted-dark">{isBuy ? "Upfront" : "Credit"}</span>
                <span className="text-primary dark:text-primary-dark font-semibold tabular-nums">
                  {formatCurrency(isBuy ? upfrontDebit : charges.netAmount)}
                </span>
              </div>
              {requiresTrigger && (
                <div className="flex justify-between text-[11px] text-muted dark:text-muted-dark">
                  <span>Trigger</span>
                  <span className="text-primary dark:text-primary-dark font-medium tabular-nums">{formatCurrency(triggerPrice)}</span>
                </div>
              )}
              {margin.leverage > 1 && (
                <div className="flex justify-between text-[11px] text-muted dark:text-muted-dark">
                  <span>Margin leverage</span>
                  <span className="text-accent font-medium tabular-nums">{margin.leverage.toFixed(2)}x</span>
                </div>
              )}
              {isBuy && (
                <div className="flex justify-between text-[11px] pt-1.5 border-t border-border dark:border-border-dark">
                  <span className="text-muted dark:text-muted-dark">Available</span>
                  <span className={cn("font-medium tabular-nums", balance >= upfrontDebit ? "text-profit" : "text-loss")}>
                    {formatCurrency(balance)}
                  </span>
                </div>
              )}
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!hasValidOrder}
              className={cn(
                "w-full py-2.5 rounded-md text-[13px] font-semibold text-white transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45",
                isBuy
                  ? "bg-profit hover:bg-profit/90"
                  : "bg-loss hover:bg-loss/90"
              )}
            >
              {isBuy ? "BUY" : "SELL"} {ticker}
            </button>

            <p className="text-2xs text-center text-muted dark:text-muted-dark">
              Simulated paper trade — no real money involved
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
