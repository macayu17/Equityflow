"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { StockCard } from "@/components/market/stock-card";
import { API_CONFIG } from "@/lib/constants";
import { Search, Grid3X3, List, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarketStatusBadge } from "@/components/market/market-status";
import { useAllStreamPrices } from "@/hooks/usePriceStream";

interface StockListItem {
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  ltp: number;
  change: number;
  changePercent: number;
}

const SECTORS = [
  "All", "Banking", "IT", "Energy", "FMCG", "Pharma", "Automobile",
  "Infrastructure", "Finance", "Metals", "Power", "Telecom", "Consumer",
  "Defence", "Insurance", "Cement", "Mining", "Healthcare", "Chemicals",
];

export default function StocksPage() {
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("All");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [stocks, setStocks] = useState<StockListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"api" | "none">("none");
  const [error, setError] = useState<string | null>(null);
  const { connected } = useAllStreamPrices();
  const fetchedOnce = useRef(false);

  const fetchStocks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_CONFIG.baseUrl}/api/stocks`, { cache: "no-store" });
      if (res.ok) {
        const data: StockListItem[] = await res.json();
        setStocks(data);
        setSource("api");
        setLoading(false);
        return;
      }
      setError(`Failed to load stocks (HTTP ${res.status})`);
    } catch {
      setError("Backend unavailable. Check /api/status and Groww credentials.");
    }
    setStocks([]);
    setSource("none");
    setLoading(false);
  }, []);

  useEffect(() => {
    // Fetch stock list ONCE on mount (prices stream via SSE)
    if (!fetchedOnce.current) {
      fetchedOnce.current = true;
      fetchStocks();
    }
  }, [fetchStocks]);

  const normalizedSearch = search.trim().toLowerCase();

  const filtered = stocks.filter((s) => {
    const matchSearch =
      normalizedSearch.length === 0 ||
      s.ticker.toLowerCase().includes(normalizedSearch) ||
      s.name.toLowerCase().includes(normalizedSearch) ||
      s.sector.toLowerCase().includes(normalizedSearch);
    const matchSector = sector === "All" || s.sector === sector;
    return matchSearch && matchSector;
  });

  return (
    <div className="px-4 md:px-6 py-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-primary dark:text-primary-dark">Stocks</h1>
          <p className="text-sm text-secondary dark:text-secondary-dark">
            Browse and trade {stocks.length} NSE stocks
            {connected && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs px-1.5 py-0.5 bg-accent/[0.08] text-accent rounded-md">
                <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                Streaming
              </span>
            )}
            {!connected && source === "api" && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs px-1.5 py-0.5 bg-accent/[0.08] text-accent rounded-md">
                Live
              </span>
            )}
          </p>
          {error && (
            <p className="text-xs text-loss mt-1">{error}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchStocks}
            disabled={loading}
            className="p-2 rounded-md hover:bg-surface dark:hover:bg-elevated-dark transition-colors text-muted dark:text-muted-dark"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
          <MarketStatusBadge segment="equity" />
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col xl:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[240px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted dark:text-muted-dark" strokeWidth={1.8} />
          <input
            type="text"
            placeholder="Search stocks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-9 pr-4 rounded-lg border border-border dark:border-border-dark bg-card dark:bg-card-dark text-sm text-primary dark:text-primary-dark outline-none focus:border-accent/50 focus:shadow-xs transition-all"
          />
        </div>

        {/* Sector Filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
          {SECTORS.map((s) => (
            <button
              key={s}
              onClick={() => setSector(s)}
              className={cn(
                "px-3 py-2 text-xs font-semibold rounded-lg whitespace-nowrap transition-all duration-150",
                sector === s
                  ? "bg-accent text-white shadow-xs"
                  : "bg-surface dark:bg-elevated-dark text-secondary dark:text-secondary-dark hover:text-primary dark:hover:text-primary-dark"
              )}
            >
              {s}
            </button>
          ))}
        </div>

        {/* View Toggle */}
        <div className="flex gap-1 p-1 rounded-lg bg-surface dark:bg-elevated-dark">
          <button
            onClick={() => setView("grid")}
            className={cn(
              "p-2 rounded-md transition-all",
              view === "grid"
                ? "bg-card dark:bg-card-dark text-accent shadow-soft"
                : "text-muted dark:text-muted-dark hover:text-primary dark:hover:text-primary-dark"
            )}
          >
            <Grid3X3 size={16} />
          </button>
          <button
            onClick={() => setView("list")}
            className={cn(
              "p-2 rounded-md transition-all",
              view === "list"
                ? "bg-card dark:bg-card-dark text-accent shadow-soft"
                : "text-muted dark:text-muted-dark hover:text-primary dark:hover:text-primary-dark"
            )}
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="text-xs text-muted dark:text-muted-dark">
        {filtered.length} stocks found
      </div>

      {view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((stock) => (
            <StockCard key={stock.ticker} ticker={stock.ticker} name={stock.name} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark divide-y divide-border/40 dark:divide-border-dark/40 overflow-hidden">
          {filtered.map((stock) => (
            <StockCard
              key={stock.ticker}
              ticker={stock.ticker}
              name={stock.name}
              compact
            />
          ))}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-muted dark:text-muted-dark">
            No stocks found matching your criteria
          </p>
        </div>
      )}
    </div>
  );
}
