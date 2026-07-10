"use client";

import { useState, useCallback, useMemo, useEffect, useSyncExternalStore } from "react";
import { getPortfolioManager, type VirtualPortfolioManager } from "@/lib/engine";
import type { OrderRequest, Position, Transaction, PortfolioSummary, StrategyPerformance, Order, PortfolioAnalytics, PortfolioRiskSummary } from "@/lib/types";
import { API_CONFIG, MOCK_COMMODITIES } from "@/lib/constants";
import type { MarketSegment } from "@/lib/market-hours";
import { apiGetJson } from "@/services/request-cache";
import { getFnoContractKind } from "@/lib/fno-pricing";

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
    const autoSquaredOff = manager.reconcileExpiredIntradayPositions();
    setHydrated(true);
    if (autoSquaredOff > 0) emitChange();
  }, [manager]);

  const resolveOpenPrice = useCallback(async (ticker: string, segment: MarketSegment) => {
    try {
      if (segment === "commodity" || commodityTickers.has(ticker)) {
        const q = await apiGetJson<{ open?: number; ltp?: number }>(`/api/commodity/quote/${ticker}`);
        if (!q) return null;
        return {
          openPrice: Number(q.open) || Number(q.ltp) || 0,
          ltp: Number(q.ltp) || 0,
        };
      }

      if (segment === "fno") {
        // Resolve simplified ticker (e.g. NIFTY25300CE) to real Groww FNO symbol
        const simplified = ticker.toUpperCase().replace(/\s+/g, "").replace(/-/g, "");
        const contractKind = getFnoContractKind(ticker);
        const resolveData = await apiGetJson<{ resolved?: boolean; tradingSymbol?: string }>(
          `/api/fno/resolve?ticker=${encodeURIComponent(simplified)}`
        );
        if (resolveData?.resolved && resolveData.tradingSymbol) {
          const q = await apiGetJson<{ open?: number; ltp?: number }>(
            `/api/quote?exchange=NSE&segment=FNO&trading_symbol=${encodeURIComponent(resolveData.tradingSymbol)}`
          );
          if (q) {
            return {
              openPrice: Number(q.open) || Number(q.ltp) || 0,
              ltp: Number(q.ltp) || 0,
            };
          }
        }
        if (contractKind === "OPT") {
          return null;
        }

        // Fallback to futures/underlying quote. Option orders must not execute at spot/index prices.
        const q = await apiGetJson<{ open?: number; ltp?: number }>(`/api/fno/quote/${ticker}`);
        if (!q) return null;
        return {
          openPrice: Number(q.open) || Number(q.ltp) || 0,
          ltp: Number(q.ltp) || 0,
        };
      }

      const q = await apiGetJson<{ open?: number; ltp?: number }>(`/api/stock/${ticker}`);
      if (!q) return null;
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
      if (result.executed > 0 || result.rejected > 0 || result.autoSquaredOff > 0) {
        emitChange();
      }
    };

    run();
    const interval = setInterval(run, 10_000);
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
      if (manager.updatePositionLTP(ticker, ltp)) {
        emitChange();
      }
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
        realizedPnl: 0,
        netPnl: 0,
        marginUsed: 0,
        marginAvailable: API_CONFIG.defaultBalance,
        grossExposure: 0,
        leverage: 0,
        riskScore: 0,
      };
  const risk: PortfolioRiskSummary = hydrated
    ? manager.getRiskSummary()
    : {
        grossExposure: 0,
        marginUsed: 0,
        marginAvailable: API_CONFIG.defaultBalance,
        leverage: 0,
        riskScore: 0,
        concentration: [],
        warnings: [],
      };
  const strategies: StrategyPerformance[] = hydrated ? manager.getStrategyPerformance() : [];
  const analytics: PortfolioAnalytics = hydrated
    ? manager.getPortfolioAnalytics()
    : {
        realizedPnl: 0,
        unrealizedPnl: 0,
        netPnl: 0,
        winRate: 0,
        totalClosedTrades: 0,
        bestTrade: null,
        worstTrade: null,
        allocationByAssetClass: [],
        allocationByProduct: [],
        dailyPnl: [],
      };

  return {
    user,
    balance,
    positions,
    transactions,
    orders,
    summary,
    risk,
    analytics,
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
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("equityflow_theme");
    const isDark = stored ? stored === "dark" : true;
    document.documentElement.classList.toggle("dark", isDark);
    setDark(isDark);

    const syncFromDom = () => {
      setDark(document.documentElement.classList.contains("dark"));
    };

    const observer = new MutationObserver(syncFromDom);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== "equityflow_theme") return;
      const next = event.newValue ? event.newValue === "dark" : true;
      document.documentElement.classList.toggle("dark", next);
      setDark(next);
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      observer.disconnect();
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("equityflow_theme", next ? "dark" : "light");
    setDark(next);
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
