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
 * Consolidated workstation SSE stream.
 *
 * The provider tracks mounted stock tickers, then opens one
 * EventSource to /api/stream/workstation with visible symbols,
 * index data, commodity data, and backend health in a single feed.
 *
 * Connection goes directly to the backend to avoid proxy buffering.
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
  /** Backend/live-data health for terminal degradation states */
  status: {
    connected?: boolean;
    degraded_reason?: string;
    rate_limited_for_sec?: number;
    last_success_at?: string | null;
  } | null;
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
  status: null,
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
  const [commodities, setCommodities] = useState<Record<string, TickerPrice>>({});
  const [indices, setIndices] = useState<IndexPrice[]>([]);
  const [status, setStatus] = useState<PriceStreamCtx["status"]>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(2_500);
  const activeTickerKey = activeTickers.join(",");

  /* ── Consolidated workstation stream ── */
  useEffect(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }

    let disposed = false;

    function connect() {
      if (disposed) return;
      const params = new URLSearchParams({
        commodities: "true",
        indices: "true",
      });
      if (activeTickerKey) params.set("symbols", activeTickerKey);
      const url = `${BACKEND}/api/stream/workstation?${params.toString()}`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        if (!disposed) {
          reconnectDelayRef.current = 2_500;
          setConnected(true);
        }
      };

      es.onmessage = (event) => {
        if (disposed) return;
        try {
          const data = JSON.parse(event.data);
          if (data.status) setStatus(data.status);
          if (data.prices && typeof data.prices === "object") {
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
          if (data.commodities && typeof data.commodities === "object") {
            setCommodities(data.commodities);
          }
          if (Array.isArray(data.indices)) {
            setIndices(data.indices);
          }
          if (data.error) {
            setStatus((prev) => ({
              ...prev,
              connected: false,
              degraded_reason: data.error,
            }));
          }
        } catch {
          // ignore
        }
      };

      es.onerror = () => {
        if (disposed) return;
        setConnected(false);
        es.close();
        esRef.current = null;
        reconnectTimer.current = setTimeout(connect, reconnectDelayRef.current);
        reconnectDelayRef.current = Math.min(30_000, reconnectDelayRef.current * 2);
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
  }, [activeTickerKey]);

  return (
    <PriceStreamContext.Provider
      value={{ prices, commodities, indices, connected, status, subscribe, unsubscribe }}
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
  return useStreamPrice(ticker);
}
