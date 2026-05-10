"use client";

import { useCallback, useEffect, useState } from "react";

export type PriceAlertCondition = "above" | "below";
export type PriceAlertStatus = "ACTIVE" | "TRIGGERED";

export interface PriceAlert {
  id: string;
  ticker: string;
  condition: PriceAlertCondition;
  price: number;
  status: PriceAlertStatus;
  createdAt: string;
  triggeredAt?: string;
  triggeredPrice?: number;
}

const STORAGE_KEY = "equityflow_price_alerts";

function makeId() {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function loadAlerts(): PriceAlert[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PriceAlert[];
  } catch {
    return [];
  }
}

function saveAlerts(alerts: PriceAlert[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
  window.dispatchEvent(new Event("equityflow-alerts-change"));
}

export function useAlerts() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);

  useEffect(() => {
    setAlerts(loadAlerts());
    const sync = () => setAlerts(loadAlerts());
    window.addEventListener("storage", sync);
    window.addEventListener("equityflow-alerts-change", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("equityflow-alerts-change", sync);
    };
  }, []);

  const addAlert = useCallback((ticker: string, condition: PriceAlertCondition, price: number) => {
    const alert: PriceAlert = {
      id: makeId(),
      ticker: ticker.trim().toUpperCase(),
      condition,
      price,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    };
    const next = [alert, ...loadAlerts()].slice(0, 30);
    saveAlerts(next);
    setAlerts(next);
    return alert;
  }, []);

  const removeAlert = useCallback((id: string) => {
    const next = loadAlerts().filter((alert) => alert.id !== id);
    saveAlerts(next);
    setAlerts(next);
  }, []);

  const triggerAlert = useCallback((id: string, triggeredPrice: number) => {
    const next = loadAlerts().map((alert) => (
      alert.id === id && alert.status === "ACTIVE"
        ? { ...alert, status: "TRIGGERED" as const, triggeredAt: new Date().toISOString(), triggeredPrice }
        : alert
    ));
    saveAlerts(next);
    setAlerts(next);
  }, []);

  const clearTriggered = useCallback(() => {
    const next = loadAlerts().filter((alert) => alert.status !== "TRIGGERED");
    saveAlerts(next);
    setAlerts(next);
  }, []);

  return { alerts, addAlert, removeAlert, triggerAlert, clearTriggered };
}
