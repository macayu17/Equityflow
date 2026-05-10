import type { Timeframe } from "@/lib/types";

export const MAX_TAB_CHARTS = 4;
export const DEFAULT_TAB_CHARTS = ["RELIANCE", "HDFCBANK"];

const STORAGE_KEY = "equityflow_tabs_chart_layout";

export interface SavedChartLayout {
  charts: string[];
  syncTimeframe: boolean;
  timeframe: Timeframe;
}

export interface ChartLayoutPreset extends SavedChartLayout {
  id: string;
  label: string;
  description: string;
}

export const CHART_LAYOUT_PRESETS: ChartLayoutPreset[] = [
  {
    id: "market",
    label: "Market Monitor",
    description: "Large-cap tape with banks and IT",
    charts: ["RELIANCE", "HDFCBANK", "TCS", "INFY"],
    syncTimeframe: true,
    timeframe: "3M",
  },
  {
    id: "banking",
    label: "Bank Desk",
    description: "Private and PSU banking leaders",
    charts: ["HDFCBANK", "ICICIBANK", "SBIN", "AXISBANK"],
    syncTimeframe: true,
    timeframe: "1M",
  },
  {
    id: "momentum",
    label: "Momentum",
    description: "High-beta daily movers",
    charts: ["TATAMOTORS", "BAJFINANCE", "TATASTEEL", "MARUTI"],
    syncTimeframe: true,
    timeframe: "1M",
  },
  {
    id: "defensive",
    label: "Defensive",
    description: "FMCG, pharma and telecom",
    charts: ["ITC", "SUNPHARMA", "BHARTIARTL", "NTPC"],
    syncTimeframe: true,
    timeframe: "6M",
  },
];

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

export function getChartLayoutPreset(id: string) {
  const key = id.trim().toLowerCase();
  return CHART_LAYOUT_PRESETS.find((preset) => preset.id === key || preset.label.toLowerCase().startsWith(key));
}

export function applyChartLayoutPreset(id: string) {
  const preset = getChartLayoutPreset(id);
  if (!preset) return null;
  const next: SavedChartLayout = {
    charts: sanitizeCharts(preset.charts),
    syncTimeframe: preset.syncTimeframe,
    timeframe: preset.timeframe,
  };
  saveChartLayout(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("equityflow-apply-chart-layout", {
      detail: { layout: next, presetId: preset.id },
    }));
  }
  return { preset, layout: next };
}
