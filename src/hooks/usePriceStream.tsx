"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { API_CONFIG } from "@/lib/constants";

/* ─────────────────────────────────────────────────────────────
 * Demand-based SSE price stream.
 *
 * Instead of fetching ALL 89+ stocks, the provider tracks which
 * tickers are currently mounted on screen.  It opens a single
 * EventSource to /api/stream/demand?tickers=A,B,C  so the
 * backend only hits Groww for what's actually visible.
 *
 * Connection goes DIRECTLY to the backend (port 8001) — no
 * Next.js proxy — to eliminate buffering latency.
 * ────────────────────────────────────────────────────────────── */

const BACKEND = API_CONFIG.baseUrl; // e.g. http://localhost:8001

export interface TickerPrice {
  ltp: number;
  change: number;
  changePercent: number;
  name?: string;
}

export interface IndexPrice {
  name: string;
  value: number;
  change: number;
  changePercent: number;
}

interface PriceStreamCtx {
  /** Live prices keyed by ticker */
  prices: Record<string, TickerPrice>;
  /** Commodity prices */
  commodities: Record<string, TickerPrice>;
  /** Index data (from the legacy global stream) */
  indices: IndexPrice[];
  /** Whether the SSE connection is open */
  connected: boolean;
  /** Register a ticker as "on screen" — call on mount */
  subscribe: (ticker: string) => void;
  /** Unregister a ticker — call on unmount */
  unsubscribe: (ticker: string) => void;
}

const PriceStreamContext = createContext<PriceStreamCtx>({
  prices: {},
  commodities: {},
  indices: [],
  connected: false,
  subscribe: () => {},
  unsubscribe: () => {},
});

export function PriceStreamProvider({ children }: { children: ReactNode }) {
  /* ── Subscriber tracking ── */
  const subsRef = useRef<Record<string, number>>({}); // ticker → refcount
  const [activeTickers, setActiveTickers] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const list = Object.keys(subsRef.current).filter((t) => subsRef.current[t] > 0);
      setActiveTickers((prev) => {
        const sorted = [...list].sort();
        const prevSorted = [...prev].sort();
        if (sorted.join(",") === prevSorted.join(",")) return prev;
        return sorted;
      });
    }, 80);
  }, []);

  const subscribe = useCallback(
    (ticker: string) => {
      subsRef.current[ticker] = (subsRef.current[ticker] || 0) + 1;
      flush();
    },
    [flush]
  );

  const unsubscribe = useCallback(
    (ticker: string) => {
      if (subsRef.current[ticker]) {
        subsRef.current[ticker]--;
        if (subsRef.current[ticker] <= 0) delete subsRef.current[ticker];
      }
      flush();
    },
    [flush]
  );

  /* ── Price state ── */
  const [prices, setPrices] = useState<Record<string, TickerPrice>>({});
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Demand-based stream ── */
  useEffect(() => {
    // Close previous connection when activeTickers change
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }

    if (activeTickers.length === 0) {
      setConnected(false);
      return;
    }

    let disposed = false;
    const tickerParam = activeTickers.join(",");

    function connect() {
      if (disposed) return;
      const url = `${BACKEND}/api/stream/demand?tickers=${encodeURIComponent(tickerParam)}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        if (!disposed) setConnected(true);
      };

      es.onmessage = (event) => {
        if (disposed) return;
        try {
          const data: Record<string, { ltp: number; change: number; changePercent: number }> =
            JSON.parse(event.data);
          // Merge into prices (additive — keeps previously seen tickers)
          setPrices((prev) => {
            const next = { ...prev };
            for (const [t, p] of Object.entries(data)) {
              if (typeof p.ltp === "number" && p.ltp > 0) {
                next[t] = p;
              }
            }
            return next;
          });
        } catch {
          // ignore
        }
      };

      es.onerror = () => {
        if (disposed) return;
        setConnected(false);
        es.close();
        esRef.current = null;
        reconnectTimer.current = setTimeout(connect, 800);
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [activeTickers]);

  /* ── Legacy: commodities & indices come from the global stream ── */
  const [commodities, setCommodities] = useState<Record<string, TickerPrice>>({});
  const [indices, setIndices] = useState<IndexPrice[]>([]);
  const globalEsRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let disposed = false;
    function connectGlobal() {
      if (disposed) return;
      const es = new EventSource(`${BACKEND}/api/stream/prices`);
      globalEsRef.current = es;
      es.onmessage = (event) => {
        if (disposed) return;
        try {
          const data = JSON.parse(event.data);
          if (data.commodities && Object.keys(data.commodities).length) setCommodities(data.commodities);
          if (data.indices && data.indices.length) setIndices(data.indices);
          // Also pick up stock prices from global stream as a fallback
          if (data.prices && Object.keys(data.prices).length) {
            setPrices((prev) => {
              const next = { ...prev };
              for (const [t, p] of Object.entries(data.prices as Record<string, TickerPrice>)) {
                if (typeof p?.ltp === "number" && p.ltp > 0) {
                  next[t] = p;
                }
              }
              return next;
            });
          }
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        if (disposed) return;
        es.close();
        globalEsRef.current = null;
        setTimeout(connectGlobal, 2000);
      };
    }
    connectGlobal();
    return () => {
      disposed = true;
      if (globalEsRef.current) {
        globalEsRef.current.close();
        globalEsRef.current = null;
      }
    };
  }, []);

  return (
    <PriceStreamContext.Provider
      value={{ prices, commodities, indices, connected, subscribe, unsubscribe }}
    >
      {children}
    </PriceStreamContext.Provider>
  );
}

/**
 * Hook for a stock card to register itself + get live price.
 * Automatically subscribes on mount / unsubscribes on unmount.
 */
export function useStreamPrice(ticker: string | null): TickerPrice | null {
  const { prices, subscribe, unsubscribe } = useContext(PriceStreamContext);

  useEffect(() => {
    if (!ticker) return;
    subscribe(ticker);
    return () => unsubscribe(ticker);
  }, [ticker, subscribe, unsubscribe]);

  if (!ticker) return null;
  return prices[ticker] ?? null;
}

/** Get commodity price for a single ticker from the SSE stream */
export function useStreamCommodityPrice(ticker: string | null): TickerPrice | null {
  const { commodities } = useContext(PriceStreamContext);
  if (!ticker) return null;
  return commodities[ticker] ?? null;
}

/** Get all streamed indices */
export function useStreamIndices(): IndexPrice[] {
  const { indices } = useContext(PriceStreamContext);
  return indices;
}

/** Get all prices from the SSE stream */
export function useAllStreamPrices() {
  return useContext(PriceStreamContext);
}

/**
 * Dedicated low-latency stream for a single stock detail page.
 * Connects DIRECTLY to backend — no proxy, no buffering.
 */
export function useFastStockStream(ticker: string | null): TickerPrice | null {
  const [price, setPrice] = useState<TickerPrice | null>(null);

  useEffect(() => {
    if (!ticker) {
      setPrice(null);
      return;
    }

    let disposed = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;
      es = new EventSource(
        `${BACKEND}/api/stream/stock/${encodeURIComponent(ticker)}`
      );

      es.onmessage = (event) => {
        if (disposed) return;
        try {
          const data = JSON.parse(event.data);
          if (typeof data?.ltp === "number" && data.ltp > 0) {
            setPrice({
              ltp: data.ltp,
              change: Number(data.change) || 0,
              changePercent: Number(data.changePercent) || 0,
              name: data.name || ticker,
            });
          }
        } catch {
          // ignore
        }
      };

      es.onerror = () => {
        if (disposed) return;
        if (es) {
          es.close();
          es = null;
        }
        reconnectTimer = setTimeout(connect, 400);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (es) es.close();
    };
  }, [ticker]);

  return price;
}
