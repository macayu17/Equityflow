"use client";

import { useState, useCallback, useMemo, useEffect, useSyncExternalStore } from "react";
import { getPortfolioManager, type VirtualPortfolioManager } from "@/lib/engine";
import type { OrderRequest, Position, Transaction, PortfolioSummary, StrategyPerformance, Order } from "@/lib/types";
import { API_CONFIG, MOCK_COMMODITIES } from "@/lib/constants";
import type { MarketSegment } from "@/lib/market-hours";

// External store to sync portfolio state across components
let listeners: (() => void)[] = [];
let version = 0;

function emitChange() {
  version++;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function getVersion() {
  return version;
}

export function usePortfolio() {
  // Force re-render on portfolio changes
  const snapshot = useSyncExternalStore(subscribe, getVersion, getVersion);

  const [manager] = useState<VirtualPortfolioManager>(() => getPortfolioManager());
  const [hydrated, setHydrated] = useState(false);
  const commodityTickers = useMemo(() => new Set(MOCK_COMMODITIES.map((c) => c.ticker)), []);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const resolveOpenPrice = useCallback(async (ticker: string, segment: MarketSegment) => {
    try {
      if (segment === "commodity" || commodityTickers.has(ticker)) {
        const res = await fetch(`${API_CONFIG.baseUrl}/api/commodity/quote/${ticker}`, { cache: "no-store" });
        if (!res.ok) return null;
        const q = await res.json();
        return {
          openPrice: Number(q.open) || Number(q.ltp) || 0,
          ltp: Number(q.ltp) || 0,
        };
      }

      if (segment === "fno") {
        // Resolve simplified ticker (e.g. NIFTY25300CE) to real Groww FNO symbol
        const simplified = ticker.toUpperCase().replace(/\s+/g, "").replace(/-/g, "");
        const resolveRes = await fetch(`${API_CONFIG.baseUrl}/api/fno/resolve?ticker=${encodeURIComponent(simplified)}`, { cache: "no-store" });
        if (resolveRes.ok) {
          const resolveData = await resolveRes.json();
          if (resolveData?.resolved && resolveData.tradingSymbol) {
            const quoteRes = await fetch(
              `${API_CONFIG.baseUrl}/api/quote?exchange=NSE&segment=FNO&trading_symbol=${encodeURIComponent(resolveData.tradingSymbol)}`,
              { cache: "no-store" }
            );
            if (quoteRes.ok) {
              const q = await quoteRes.json();
              return {
                openPrice: Number(q.open) || Number(q.ltp) || 0,
                ltp: Number(q.ltp) || 0,
              };
            }
          }
        }
        // Fallback to underlying spot quote
        const res = await fetch(`${API_CONFIG.baseUrl}/api/fno/quote/${ticker}`, { cache: "no-store" });
        if (!res.ok) return null;
        const q = await res.json();
        return {
          openPrice: Number(q.open) || Number(q.ltp) || 0,
          ltp: Number(q.ltp) || 0,
        };
      }

      const res = await fetch(`${API_CONFIG.baseUrl}/api/stock/${ticker}`, { cache: "no-store" });
      if (!res.ok) return null;
      const q = await res.json();
      return {
        openPrice: Number(q.open) || Number(q.ltp) || 0,
        ltp: Number(q.ltp) || 0,
      };
    } catch {
      return null;
    }
  }, [commodityTickers]);

  useEffect(() => {
    if (!hydrated) return;
    let active = true;

    const run = async () => {
      const result = await manager.processPendingOrders(resolveOpenPrice);
      if (!active) return;
      if (result.executed > 0 || result.rejected > 0) {
        emitChange();
      }
    };

    run();
    const interval = setInterval(run, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [hydrated, manager, resolveOpenPrice]);

  const placeOrder = useCallback(
    (req: OrderRequest) => {
      const result = manager.placeOrder(req);
      if (result.success) emitChange();
      return result;
    },
    [manager]
  );

  const updateLTP = useCallback(
    (ticker: string, ltp: number) => {
      manager.updatePositionLTP(ticker, ltp);
      emitChange();
    },
    [manager]
  );

  const resetAccount = useCallback(() => {
    manager.resetAccount();
    emitChange();
  }, [manager]);

  const removeHolding = useCallback(
    (positionId: string) => {
      const result = manager.removeHolding(positionId);
      if (result.success) emitChange();
      return result;
    },
    [manager]
  );

  const cancelOrder = useCallback(
    (orderId: string) => {
      const result = manager.cancelOrder(orderId);
      if (result.success) emitChange();
      return result;
    },
    [manager]
  );

  const modifyOrder = useCallback(
    (orderId: string, updates: { price?: number; quantity?: number }) => {
      const result = manager.modifyOrder(orderId, updates);
      if (result.success) emitChange();
      return result;
    },
    [manager]
  );

  const setBalance = useCallback(
    (amount: number) => {
      manager.setBalance(amount);
      emitChange();
    },
    [manager]
  );

  void snapshot;

  const balance = hydrated ? manager.getBalance() : API_CONFIG.defaultBalance;
  const user = manager.getUser();
  const positions: Position[] = hydrated ? manager.getPositions() : [];
  const transactions: Transaction[] = hydrated ? manager.getTransactions() : [];
  const orders: Order[] = hydrated ? manager.getOrders() : [];
  const summary: PortfolioSummary = hydrated
    ? manager.getPortfolioSummary()
    : {
        totalInvested: 0,
        currentValue: 0,
        totalPnl: 0,
        totalPnlPercent: 0,
        dayPnl: 0,
        dayPnlPercent: 0,
        positions: [],
      };
  const strategies: StrategyPerformance[] = hydrated ? manager.getStrategyPerformance() : [];

  return {
    user,
    balance,
    positions,
    transactions,
    orders,
    summary,
    strategies,
    placeOrder,
    updateLTP,
    setBalance,
    resetAccount,
    removeHolding,
    cancelOrder,
    modifyOrder,
  };
}

// ─── Theme Hook ──────────────────────────────────────────────
export function useTheme() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("equityflow_theme");
    const isDark = stored === "dark";
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const toggle = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("equityflow_theme", next ? "dark" : "light");
      return next;
    });
  }, []);

  return { dark, toggle };
}

// ─── Mobile Detection ────────────────────────────────────────
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return isMobile;
}
