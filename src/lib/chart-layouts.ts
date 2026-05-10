import type { Timeframe } from "@/lib/types";

export const MAX_TAB_CHARTS = 4;
export const DEFAULT_TAB_CHARTS = ["RELIANCE", "HDFCBANK"];

const STORAGE_KEY = "equityflow_tabs_chart_layout";

export interface SavedChartLayout {
  charts: string[];
  syncTimeframe: boolean;
  timeframe: Timeframe;
}

export function normalizeChartTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function sanitizeCharts(charts: unknown): string[] {
  if (!Array.isArray(charts)) return DEFAULT_TAB_CHARTS;
  const unique = Array.from(new Set(charts.map((ticker) => normalizeChartTicker(String(ticker))).filter(Boolean)));
  return unique.slice(0, MAX_TAB_CHARTS).length > 0 ? unique.slice(0, MAX_TAB_CHARTS) : DEFAULT_TAB_CHARTS;
}

export function loadChartLayout(): SavedChartLayout {
  if (typeof window === "undefined") {
    return { charts: DEFAULT_TAB_CHARTS, syncTimeframe: true, timeframe: "3M" };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("missing layout");
    const parsed = JSON.parse(raw) as Partial<SavedChartLayout>;
    return {
      charts: sanitizeCharts(parsed.charts),
      syncTimeframe: parsed.syncTimeframe ?? true,
      timeframe: parsed.timeframe ?? "3M",
    };
  } catch {
    return { charts: DEFAULT_TAB_CHARTS, syncTimeframe: true, timeframe: "3M" };
  }
}

export function saveChartLayout(layout: SavedChartLayout) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    charts: sanitizeCharts(layout.charts),
    syncTimeframe: layout.syncTimeframe,
    timeframe: layout.timeframe,
  }));
}

export function addChartToSavedLayout(ticker: string) {
  const symbol = normalizeChartTicker(ticker);
  if (!symbol || typeof window === "undefined") return loadChartLayout();
  const layout = loadChartLayout();
  const charts = layout.charts.includes(symbol)
    ? layout.charts
    : [...layout.charts, symbol].slice(0, MAX_TAB_CHARTS);
  const next = { ...layout, charts };
  saveChartLayout(next);
  window.dispatchEvent(new CustomEvent("equityflow-add-chart", { detail: { ticker: symbol } }));
  return next;
}
