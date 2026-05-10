"use client";

import { useCallback, useEffect, useState } from "react";
import type { AlertMetricSnapshot, AlertRule } from "@/lib/alerts";

export type PriceAlertCondition = "above" | "below";
export type PriceAlertStatus = "ACTIVE" | "TRIGGERED";

export interface PriceAlert {
  id: string;
  ticker: string;
  condition: PriceAlertCondition;
  price: number;
  rule?: AlertRule;
  status: PriceAlertStatus;
  createdAt: string;
  triggeredAt?: string;
  triggeredPrice?: number;
  triggeredValue?: number;
  lastSnapshot?: AlertMetricSnapshot;
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
    const parsed = JSON.parse(raw) as PriceAlert[];
    return parsed.map((alert) => ({
      ...alert,
      ticker: alert.ticker.toUpperCase(),
      rule: alert.rule ?? {
        metric: "price",
        operator: alert.condition === "above" ? ">=" : "<=",
        value: alert.price,
      },
    }));
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
    const rule: AlertRule = {
      metric: "price",
      operator: condition === "above" ? ">=" : "<=",
      value: price,
    };
    const alert: PriceAlert = {
      id: makeId(),
      ticker: ticker.trim().toUpperCase(),
      condition,
      price,
      rule,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    };
    const next = [alert, ...loadAlerts()].slice(0, 30);
    saveAlerts(next);
    setAlerts(next);
    return alert;
  }, []);

  const addAdvancedAlert = useCallback((ticker: string, rule: AlertRule) => {
    const condition: PriceAlertCondition = rule.operator === ">=" ? "above" : "below";
    const alert: PriceAlert = {
      id: makeId(),
      ticker: ticker.trim().toUpperCase(),
      condition,
      price: rule.value,
      rule,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    };
    const next = [alert, ...loadAlerts()].slice(0, 40);
    saveAlerts(next);
    setAlerts(next);
    return alert;
  }, []);

  const removeAlert = useCallback((id: string) => {
    const next = loadAlerts().filter((alert) => alert.id !== id);
    saveAlerts(next);
    setAlerts(next);
  }, []);

  const triggerAlert = useCallback((id: string, triggeredPrice: number, triggeredValue?: number, snapshot?: AlertMetricSnapshot) => {
    const next = loadAlerts().map((alert) => (
      alert.id === id && alert.status === "ACTIVE"
        ? { ...alert, status: "TRIGGERED" as const, triggeredAt: new Date().toISOString(), triggeredPrice, triggeredValue, lastSnapshot: snapshot }
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

  return { alerts, addAlert, addAdvancedAlert, removeAlert, triggerAlert, clearTriggered };
}
