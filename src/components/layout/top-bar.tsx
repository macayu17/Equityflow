"use client";

import { useState, useEffect, useRef } from "react";
import { Search, X, TrendingUp } from "lucide-react";
import Image from "next/image";
import { useStockSearch } from "@/hooks/useStockData";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { StockLogo } from "@/components/market/stock-logo";

export function TopBar() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: results } = useStockSearch(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (searchOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-40 h-14 flex items-center justify-between px-4 md:px-6 border-b border-border dark:border-border-dark glass">
        {/* Mobile Logo */}
        <div className="flex items-center gap-2.5 md:hidden">
          <Image src="/logo.png" alt="EquityFlow" width={32} height={32} className="rounded-lg" />
          <span className="text-[15px] font-bold text-primary dark:text-primary-dark">
            EquityFlow
          </span>
        </div>

        {/* Search */}
        <button
          onClick={() => setSearchOpen(true)}
          className={cn(
            "flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all duration-200",
            "bg-surface/50 dark:bg-white/[0.03]",
            "border-border/50 dark:border-border-dark/40",
            "text-muted dark:text-muted-dark",
            "hover:border-border-hover/70 dark:hover:border-border-hover-dark/50 hover:bg-surface/80 dark:hover:bg-white/[0.05]",
            "text-[13px] w-full max-w-md mx-auto md:mx-0"
          )}
        >
          <Search size={15} strokeWidth={1.8} />
          <span className="flex-1 text-left">Search stocks, F&O, commodities...</span>
          <kbd className="hidden md:inline-flex items-center gap-0.5 text-[10px] font-mono bg-card dark:bg-card-dark border border-border dark:border-border-dark rounded-md px-1.5 py-0.5 text-muted dark:text-muted-dark shadow-xs">
            Ctrl K
          </kbd>
        </button>

        <div className="w-8" />
      </header>

      {/* Search Overlay */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 dark:bg-black/50 backdrop-blur-sm animate-fade-in" onClick={() => { setSearchOpen(false); setQuery(""); }}>
          <div
            className="mx-auto mt-[12vh] w-full max-w-lg rounded-2xl shadow-modal overflow-hidden animate-scale-in border border-border/40 dark:border-border-dark/40 bg-card/95 dark:bg-[#0d0d0d]/95 backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border dark:border-border-dark">
              <Search size={16} className="text-muted dark:text-muted-dark flex-shrink-0" strokeWidth={1.8} />
              <input
                ref={inputRef}
                type="text"
                placeholder="Search stocks, ETFs, F&O..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm text-primary dark:text-primary-dark placeholder:text-muted dark:placeholder:text-muted-dark outline-none"
              />
              <button
                onClick={() => { setSearchOpen(false); setQuery(""); }}
                className="p-1 rounded-md hover:bg-surface dark:hover:bg-elevated-dark text-muted dark:text-muted-dark hover:text-primary dark:hover:text-primary-dark transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[360px] overflow-y-auto">
              {results && results.length > 0 ? (
                results.map((stock) => (
                  <button
                    key={stock.ticker}
                    onClick={() => {
                      router.push(`/stocks/${stock.ticker}`);
                      setSearchOpen(false);
                      setQuery("");
                    }}
                    className="flex items-center gap-3 w-full px-4 py-3 hover:bg-surface dark:hover:bg-elevated-dark transition-colors text-left"
                  >
                    <StockLogo ticker={stock.ticker} logoUrl={stock.logoUrl} className="w-9 h-9" textClassName="text-xs" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-primary dark:text-primary-dark truncate">
                        {stock.name}
                      </div>
                      <div className="text-[11px] text-muted dark:text-muted-dark mt-0.5">
                        {stock.ticker} · {stock.exchange}
                        {stock.sector && ` · ${stock.sector}`}
                      </div>
                    </div>
                  </button>
                ))
              ) : query.length > 0 ? (
                <div className="px-4 py-10 text-center">
                  <Search size={24} className="mx-auto text-muted/30 dark:text-muted-dark/30 mb-2" />
                  <p className="text-[13px] text-muted dark:text-muted-dark">
                    No results for &quot;{query}&quot;
                  </p>
                </div>
              ) : (
                <div className="px-4 py-3">
                  <div className="text-[10px] font-semibold text-muted dark:text-muted-dark mb-2 uppercase tracking-widest">
                    Popular
                  </div>
                  {["RELIANCE", "TCS", "HDFCBANK", "INFY", "SBIN"].map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        router.push(`/stocks/${t}`);
                        setSearchOpen(false);
                      }}
                      className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-[13px] text-secondary dark:text-secondary-dark hover:bg-surface dark:hover:bg-elevated-dark transition-colors"
                    >
                      <TrendingUp size={13} className="text-accent" strokeWidth={2} />
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
