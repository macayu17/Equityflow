"use client";

import { useState } from "react";
import { StockCard } from "@/components/market/stock-card";
import { MOCK_STOCKS } from "@/lib/constants";
import { Eye, Plus, X, Star } from "lucide-react";
import { cn } from "@/lib/utils";

// Default watchlist items
const DEFAULT_WATCHLIST = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "SBIN"];

export default function WatchlistPage() {
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("equityflow_watchlist");
      return stored ? JSON.parse(stored) : DEFAULT_WATCHLIST;
    }
    return DEFAULT_WATCHLIST;
  });
  const [showAdd, setShowAdd] = useState(false);

  const saveWatchlist = (items: string[]) => {
    setWatchlist(items);
    localStorage.setItem("equityflow_watchlist", JSON.stringify(items));
  };

  const removeFromWatchlist = (ticker: string) => {
    saveWatchlist(watchlist.filter((t) => t !== ticker));
  };

  const addToWatchlist = (ticker: string) => {
    if (!watchlist.includes(ticker)) {
      saveWatchlist([...watchlist, ticker]);
    }
  };

  const availableToAdd = MOCK_STOCKS.filter((s) => !watchlist.includes(s.ticker));

  return (
    <div className="px-4 md:px-6 py-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-accent/10 dark:bg-accent/[0.12] flex items-center justify-center">
              <Eye size={17} className="text-accent" strokeWidth={2.2} />
            </div>
            <h1 className="text-xl font-bold text-primary dark:text-primary-dark">
              Watchlist
            </h1>
          </div>
          <p className="text-sm text-secondary dark:text-secondary-dark ml-[42px]">
            {watchlist.length} stocks tracked
          </p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className={cn(
            "flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all duration-150",
            showAdd
              ? "bg-accent text-white shadow-xs"
              : "border border-border dark:border-border-dark text-secondary dark:text-secondary-dark hover:border-accent/40 hover:text-accent"
          )}
        >
          {showAdd ? <X size={12} /> : <Plus size={12} />}
          {showAdd ? "Done" : "Add Stock"}
        </button>
      </div>

      {/* Add Stock Panel */}
      {showAdd && (
        <div className="rounded-xl border border-accent/20 bg-accent/[0.03] dark:bg-accent/[0.06] p-4 animate-fade-in">
          <h3 className="text-xs font-semibold text-secondary dark:text-secondary-dark mb-3 uppercase tracking-wider">
            Add to Watchlist
          </h3>
          <div className="flex flex-wrap gap-2">
            {availableToAdd.map((stock) => (
              <button
                key={stock.ticker}
                onClick={() => addToWatchlist(stock.ticker)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border dark:border-border-dark bg-card dark:bg-card-dark text-xs font-medium text-primary dark:text-primary-dark hover:border-accent/40 transition-all"
              >
                <Plus size={10} />
                {stock.ticker}
              </button>
            ))}
            {availableToAdd.length === 0 && (
              <p className="text-xs text-muted dark:text-muted-dark">All available stocks are in your watchlist</p>
            )}
          </div>
        </div>
      )}

      {/* Watchlist Items */}
      {watchlist.length > 0 ? (
        <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark overflow-hidden">
          {watchlist.map((ticker) => {
            const stock = MOCK_STOCKS.find((s) => s.ticker === ticker);
            return (
              <div key={ticker} className="flex items-center border-b last:border-b-0 border-border/40 dark:border-border-dark/40">
                <div className="flex-1">
                  <StockCard
                    ticker={ticker}
                    name={stock?.name || ticker}
                    compact
                  />
                </div>
                <button
                  onClick={() => removeFromWatchlist(ticker)}
                  className="px-3 py-2 text-muted dark:text-muted-dark hover:text-loss transition-colors"
                  title="Remove from watchlist"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark p-10 text-center">
          <Star size={40} className="mx-auto text-muted/20 dark:text-muted-dark/20 mb-3" />
          <h3 className="text-sm font-semibold text-primary dark:text-primary-dark mb-1">
            Watchlist is Empty
          </h3>
          <p className="text-xs text-secondary dark:text-secondary-dark">
            Add stocks to keep track of their prices
          </p>
        </div>
      )}
    </div>
  );
}
