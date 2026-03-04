"use client";

import { useState } from "react";
import { usePortfolio } from "@/hooks/usePortfolio";
import { cn, formatCurrency } from "@/lib/utils";
import { ArrowUpRight, ArrowDownRight, Filter } from "lucide-react";
import type { StrategyTag, OrderType } from "@/lib/types";
import { STRATEGY_TAGS } from "@/lib/types";

export function TransactionHistory() {
  const { transactions } = usePortfolio();
  const [filterType, setFilterType] = useState<OrderType | "ALL">("ALL");
  const [filterStrategy, setFilterStrategy] = useState<StrategyTag | "ALL">("ALL");
  const [page, setPage] = useState(0);
  const pageSize = 15;

  const filtered = transactions.filter((t) => {
    if (filterType !== "ALL" && t.type !== filterType) return false;
    if (filterStrategy !== "ALL" && t.strategy_tag !== filterStrategy) return false;
    return true;
  });

  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.ceil(filtered.length / pageSize);

  if (transactions.length === 0) {
    return (
      <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark p-8 text-center">
        <h3 className="text-sm font-medium text-primary dark:text-primary-dark mb-1">
          No Transactions
        </h3>
        <p className="text-xs text-muted dark:text-muted-dark">
          Your paper trade history will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Filter size={14} className="text-muted dark:text-muted-dark" />
          <span className="text-xs text-muted dark:text-muted-dark">Filter:</span>
        </div>

        <div className="flex gap-1">
          {(["ALL", "BUY", "SELL"] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setFilterType(t); setPage(0); }}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                filterType === t
                  ? "bg-accent text-white"
                  : "bg-surface dark:bg-elevated-dark text-muted dark:text-muted-dark hover:text-primary dark:hover:text-primary-dark"
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <select
          value={filterStrategy}
          onChange={(e) => { setFilterStrategy(e.target.value as StrategyTag | "ALL"); setPage(0); }}
          className="text-xs px-2 py-1 rounded-md border border-border dark:border-border-dark bg-card dark:bg-card-dark text-primary dark:text-primary-dark outline-none"
        >
          <option value="ALL">All Strategies</option>
          {STRATEGY_TAGS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <span className="text-xs text-muted dark:text-muted-dark ml-auto">
          {filtered.length} total
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] font-medium text-muted dark:text-muted-dark uppercase tracking-wider border-b border-border dark:border-border-dark bg-surface/50 dark:bg-elevated-dark/50">
          <span className="col-span-1">Type</span>
          <span className="col-span-3">Stock</span>
          <span className="col-span-2 text-right">Price</span>
          <span className="col-span-1 text-right">Qty</span>
          <span className="col-span-2 text-right">Total</span>
          <span className="col-span-1">Strategy</span>
          <span className="col-span-2 text-right">Time</span>
        </div>

        {paged.map((txn) => (
          <div
            key={txn.id}
            className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center border-b last:border-b-0 border-border/50 dark:border-border-dark/50 hover:bg-surface/50 dark:hover:bg-elevated-dark/30 transition-colors"
          >
            <div className="col-span-1">
              <span className={cn(
                "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold",
                txn.type === "BUY"
                  ? "bg-accent/10 text-accent"
                  : "bg-loss/10 text-loss"
              )}>
                {txn.type === "BUY" ? <ArrowUpRight size={8} /> : <ArrowDownRight size={8} />}
                {txn.type}
              </span>
            </div>
            <div className="col-span-3">
              <div className="text-xs font-medium text-primary dark:text-primary-dark truncate">
                {txn.stockName}
              </div>
              <div className="text-[10px] text-muted dark:text-muted-dark">
                {txn.ticker} · {txn.product}
              </div>
            </div>
            <div className="col-span-2 text-right text-xs text-primary dark:text-primary-dark">
              {formatCurrency(txn.price)}
            </div>
            <div className="col-span-1 text-right text-xs text-primary dark:text-primary-dark">
              {txn.quantity}
            </div>
            <div className="col-span-2 text-right text-xs font-medium text-primary dark:text-primary-dark">
              {formatCurrency(txn.total)}
            </div>
            <div className="col-span-1">
              <span className="text-[10px] font-medium text-accent bg-accent/10 px-1 py-0.5 rounded">
                {txn.strategy_tag}
              </span>
            </div>
            <div className="col-span-2 text-right text-[10px] text-muted dark:text-muted-dark">
              {new Date(txn.timestamp).toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="px-3 py-1 text-xs rounded-md border border-border dark:border-border-dark disabled:opacity-40 hover:border-accent transition-colors"
          >
            Previous
          </button>
          <span className="text-xs text-muted dark:text-muted-dark self-center">
            {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1 text-xs rounded-md border border-border dark:border-border-dark disabled:opacity-40 hover:border-accent transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
