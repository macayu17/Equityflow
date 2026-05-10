"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { StockCard } from "@/components/market/stock-card";
import { Search, Grid3X3, List, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarketStatusBadge } from "@/components/market/market-status";
import { useAllStreamPrices } from "@/hooks/usePriceStream";
import { apiGetJson } from "@/services/request-cache";

interface StockListItem {
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  logoUrl?: string;
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
      const data = await apiGetJson<StockListItem[]>("/api/stocks", { ttlMs: 2 * 60_000 });
      if (data) {
        setStocks(data);
        setSource("api");
        setLoading(false);
        return;
      }
      setError("Failed to load stocks from backend");
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
    <div className="terminal-shell min-h-full px-3 py-3 md:px-4 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="terminal-title text-sm">Stocks</h1>
          <p className="terminal-subtle text-xs">
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
            className="terminal-badge rounded-sm p-2 transition-colors hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-accent)]"
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
            className="terminal-input h-9 w-full rounded-sm pl-9 pr-4 font-mono text-xs outline-none transition-colors focus:border-[color:var(--terminal-accent)]"
          />
        </div>

        {/* Sector Filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
          {SECTORS.map((s) => (
            <button
              key={s}
              onClick={() => setSector(s)}
              className={cn(
                "rounded-sm px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.05em] whitespace-nowrap transition-colors duration-150",
                sector === s
                  ? "bg-amber-400 text-black"
                  : "terminal-badge hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-accent)]"
              )}
            >
              {s}
            </button>
          ))}
        </div>

        {/* View Toggle */}
        <div className="terminal-badge flex gap-1 rounded-sm p-1">
          <button
            onClick={() => setView("grid")}
            className={cn(
              "p-2 rounded-md transition-all",
              view === "grid"
                ? "bg-amber-400 text-black"
                : "terminal-subtle hover:text-[var(--terminal-accent)]"
            )}
          >
            <Grid3X3 size={16} />
          </button>
          <button
            onClick={() => setView("list")}
            className={cn(
              "p-2 rounded-md transition-all",
              view === "list"
                ? "bg-amber-400 text-black"
                : "terminal-subtle hover:text-[var(--terminal-accent)]"
            )}
          >
            <List size={16} />
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="terminal-subtle font-mono text-[11px] uppercase tracking-[0.1em]">
        {filtered.length} stocks found
      </div>

      {view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((stock) => (
            <StockCard key={stock.ticker} ticker={stock.ticker} name={stock.name} logoUrl={stock.logoUrl} />
          ))}
        </div>
      ) : (
        <div className="terminal-panel divide-y divide-white/5 overflow-hidden">
          {filtered.map((stock) => (
            <StockCard
              key={stock.ticker}
              ticker={stock.ticker}
              name={stock.name}
              logoUrl={stock.logoUrl}
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
