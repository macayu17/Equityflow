"use client";

import { useState } from "react";
import { usePortfolio } from "@/hooks/usePortfolio";
import { cn, formatCurrency } from "@/lib/utils";
import type { OrderStatus, OrderType } from "@/lib/types";
import { ArrowUpRight, ArrowDownRight, Clock3, CheckCircle2, XCircle } from "lucide-react";
import { useToast } from "@/components/toast-provider";

const STATUS_TABS: Array<OrderStatus | "ALL"> = ["ALL", "PENDING", "COMPLETED", "REJECTED", "CANCELLED"];

function statusBadge(status: OrderStatus) {
  if (status === "COMPLETED") return "bg-profit/10 text-profit";
  if (status === "PENDING") return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400";
  if (status === "REJECTED") return "bg-loss/10 text-loss";
  return "bg-muted/20 text-muted dark:text-muted-dark";
}

function statusIcon(status: OrderStatus) {
  if (status === "COMPLETED") return <CheckCircle2 size={12} />;
  if (status === "PENDING") return <Clock3 size={12} />;
  return <XCircle size={12} />;
}

export function OrdersHistory() {
  const { orders, cancelOrder, modifyOrder } = usePortfolio();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "ALL">("ALL");
  const [sideFilter, setSideFilter] = useState<OrderType | "ALL">("ALL");
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState(0);
  const [editQty, setEditQty] = useState(0);

  const handleCancel = (orderId: string) => {
    if (!confirm("Cancel this pending order?")) return;
    const result = cancelOrder(orderId);
    toast({
      title: result.success ? "Order Cancelled" : "Cancel Failed",
      description: result.message,
      variant: result.success ? "success" : "error",
    });
  };

  const startModify = (orderId: string, currentPrice: number, currentQty: number) => {
    setEditingOrderId(orderId);
    setEditPrice(currentPrice);
    setEditQty(currentQty);
  };

  const cancelModify = () => {
    setEditingOrderId(null);
    setEditPrice(0);
    setEditQty(0);
  };

  const saveModify = (orderId: string) => {
    const nextPrice = Number(editPrice);
    const nextQty = Number(editQty);
    const result = modifyOrder(orderId, { price: nextPrice, quantity: nextQty });
    toast({
      title: result.success ? "Order Modified" : "Modify Failed",
      description: result.message,
      variant: result.success ? "success" : "error",
    });
    if (result.success) {
      cancelModify();
    }
  };

  const filtered = orders.filter((o) => {
    if (statusFilter !== "ALL" && o.status !== statusFilter) return false;
    if (sideFilter !== "ALL" && o.type !== sideFilter) return false;
    return true;
  });

  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark p-6 text-center">
        <h3 className="text-sm font-medium text-primary dark:text-primary-dark mb-1">No Orders Yet</h3>
        <p className="text-xs text-muted dark:text-muted-dark">Your queued and executed orders will appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {(["ALL", "BUY", "SELL"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setSideFilter(t)}
              className={cn(
                "px-2.5 py-1 text-xs rounded-md transition-colors",
                sideFilter === t ? "bg-accent text-white" : "bg-surface dark:bg-elevated-dark text-muted dark:text-muted-dark hover:text-primary dark:hover:text-primary-dark"
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-2.5 py-1 text-xs rounded-md transition-colors whitespace-nowrap",
                statusFilter === s ? "bg-accent text-white" : "bg-surface dark:bg-elevated-dark text-muted dark:text-muted-dark hover:text-primary dark:hover:text-primary-dark"
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="ml-auto text-xs text-muted dark:text-muted-dark">{filtered.length} orders</div>
      </div>

      <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] font-medium text-muted dark:text-muted-dark uppercase tracking-wider border-b border-border dark:border-border-dark bg-surface/50 dark:bg-elevated-dark/50">
          <span className="col-span-1">Side</span>
          <span className="col-span-3">Instrument</span>
          <span className="col-span-2 text-right">Qty</span>
          <span className="col-span-2 text-right">Order Px</span>
          <span className="col-span-2 text-right">Exec Px</span>
          <span className="col-span-1 text-right">Status</span>
          <span className="col-span-1 text-right">Actions</span>
        </div>

        {filtered.map((o) => (
          <div
            key={o.id}
            className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center border-b last:border-b-0 border-border/50 dark:border-border-dark/50"
          >
            {(() => {
              const isEditing = editingOrderId === o.id;

              return (
                <>
            <div className="col-span-1">
              <span className={cn(
                "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold",
                o.type === "BUY" ? "bg-accent/10 text-accent" : "bg-loss/10 text-loss"
              )}>
                {o.type === "BUY" ? <ArrowUpRight size={8} /> : <ArrowDownRight size={8} />}
                {o.type}
              </span>
            </div>

            <div className="col-span-3 min-w-0">
              <div className="text-xs font-medium text-primary dark:text-primary-dark truncate">{o.stockName}</div>
              <div className="text-[10px] text-muted dark:text-muted-dark truncate">{o.ticker} · {o.product}</div>
            </div>

            <div className="col-span-2 text-right text-xs text-primary dark:text-primary-dark">
              {isEditing ? (
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={editQty}
                  onChange={(e) => setEditQty(Number(e.target.value))}
                  className="w-20 ml-auto px-2 py-1 rounded-md border border-border dark:border-border-dark bg-card dark:bg-card-dark text-xs text-right"
                />
              ) : (
                o.quantity.toLocaleString("en-IN")
              )}
            </div>
            <div className="col-span-2 text-right text-xs text-primary dark:text-primary-dark">
              {isEditing ? (
                <input
                  type="number"
                  min={0.01}
                  step={0.05}
                  value={editPrice}
                  onChange={(e) => setEditPrice(Number(e.target.value))}
                  className="w-24 ml-auto px-2 py-1 rounded-md border border-border dark:border-border-dark bg-card dark:bg-card-dark text-xs text-right"
                />
              ) : (
                formatCurrency(o.price)
              )}
            </div>
            <div className="col-span-2 text-right text-xs font-medium text-primary dark:text-primary-dark">
              {o.executed_price ? formatCurrency(o.executed_price) : "—"}
            </div>

            <div className="col-span-1 text-right">
              <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold", statusBadge(o.status))}>
                {statusIcon(o.status)}
                {o.status}
              </span>
              <div className="text-[10px] text-muted dark:text-muted-dark mt-0.5">
                {new Date(o.executed_at ?? o.timestamp).toLocaleString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>

            <div className="col-span-1 flex justify-end gap-1">
              {o.status === "PENDING" && (
                <>
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => saveModify(o.id)}
                        className="px-2 py-1 rounded text-[10px] font-semibold bg-profit/15 text-profit hover:bg-profit/25 transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={cancelModify}
                        className="px-2 py-1 rounded text-[10px] font-semibold bg-muted/20 text-muted-dark hover:bg-muted/30 transition-colors"
                      >
                        Close
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startModify(o.id, o.price, o.quantity)}
                        className="px-2 py-1 rounded text-[10px] font-semibold bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                      >
                        Modify
                      </button>
                      <button
                        onClick={() => handleCancel(o.id)}
                        className="px-2 py-1 rounded text-[10px] font-semibold bg-loss/15 text-loss hover:bg-loss/25 transition-colors"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
                </>
              );
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}
