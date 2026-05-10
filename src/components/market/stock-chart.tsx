"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { Timeframe } from "@/lib/types";
import { TIMEFRAMES } from "@/lib/types";
import { API_CONFIG } from "@/lib/constants";
import { getMarketStatus } from "@/lib/market-hours";

interface StockChartProps {
  ticker: string;
  exchange?: string;
  segment?: string;
  height?: number;
  liveLtp?: number;
  timeframeValue?: Timeframe;
  onTimeframeChange?: (timeframe: Timeframe) => void;
}

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type ChartTime = number | { year: number; month: number; day: number };
export type ChartInterval = "1T" | "10T" | "100T" | "1000T" | "1M" | "2M" | "3M" | "5M" | "10M" | "15M" | "30M" | "45M" | "1H" | "2H" | "3H" | "4H";
type IndicatorKey = "EMA20" | "SMA50" | "VWAP";

const CHART_INTERVALS: { label: string; value: ChartInterval }[] = [
  { label: "1 tick", value: "1T" },
  { label: "10 ticks", value: "10T" },
  { label: "100 ticks", value: "100T" },
  { label: "1000 ticks", value: "1000T" },
  { label: "1 minute", value: "1M" },
  { label: "2 minutes", value: "2M" },
  { label: "3 minutes", value: "3M" },
  { label: "5 minutes", value: "5M" },
  { label: "10 minutes", value: "10M" },
  { label: "15 minutes", value: "15M" },
  { label: "30 minutes", value: "30M" },
  { label: "45 minutes", value: "45M" },
  { label: "1 hour", value: "1H" },
  { label: "2 hours", value: "2H" },
  { label: "3 hours", value: "3H" },
  { label: "4 hours", value: "4H" },
];

const INDICATORS: { key: IndicatorKey; label: string; color: string }[] = [
  { key: "EMA20", label: "EMA 20", color: "#f59e0b" },
  { key: "SMA50", label: "SMA 50", color: "#38bdf8" },
  { key: "VWAP", label: "VWAP", color: "#a78bfa" },
];

const candleCache = new Map<string, { expiresAt: number; data: CandleData[] }>();

export function StockChart({ ticker, exchange = "NSE", segment: segmentProp, height = 420, liveLtp, timeframeValue, onTimeframeChange }: StockChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  // ── Refs for chart lifecycle (cleaned up synchronously, no closure issues) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartApiRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleSeriesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const volumeSeriesRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const indicatorSeriesRef = useRef<Partial<Record<IndicatorKey, any>>>({});
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const disposedRef = useRef(false);
  const latestCandleRef = useRef<CandleData | null>(null);

  const [timeframe, setTimeframe] = useState<Timeframe>("3M");
  const [chartInterval, setChartInterval] = useState<ChartInterval>("5M");
  const [visibleIndicators, setVisibleIndicators] = useState<Record<IndicatorKey, boolean>>({
    EMA20: true,
    SMA50: false,
    VWAP: false,
  });
  const [isDark, setIsDark] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const segment = segmentProp || (exchange === "MCX" ? "COMMODITY" : "CASH");
  const marketSegment = exchange === "MCX" ? "commodity" : "equity";
  const marketOpen = getMarketStatus(marketSegment).isOpen;

  // Keep timeframe in a ref so chart formatters always read current value
  // without triggering chart recreation.
  const timeframeRef = useRef(timeframe);
  timeframeRef.current = timeframe;

  useEffect(() => {
    if (timeframeValue && timeframeValue !== timeframe) {
      setTimeframe(timeframeValue);
    }
  }, [timeframeValue, timeframe]);

  const normalizeCandleTime = useCallback((time: number) => {
    // Groww API returns seconds (10-digit). Only divide if truly milliseconds (13-digit).
    return time > 1_000_000_000_000 ? Math.floor(time / 1000) : time;
  }, []);

  const formatIstTime = useCallback((time: number) => {
    const date = new Date(time * 1000);
    const tf = timeframeRef.current;
    if (tf === "1D" || tf === "1W") {
      return new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(date);
    }
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(date);
  }, []);

  // tickMarkFormatter receives (time, tickMarkType, locale) in lightweight-charts v4.
  // tickMarkType: 0=Year, 1=Month, 2=DayOfMonth, 3=Time, 4=TimeWithSeconds
  const formatIstTickMark = useCallback((time: number, tickMarkType?: number) => {
    const date = new Date(time * 1000);
    const opts: Intl.DateTimeFormatOptions = { timeZone: "Asia/Kolkata" };

    switch (tickMarkType) {
      case 0: // Year
        opts.year = "numeric";
        break;
      case 1: // Month
        opts.month = "short";
        opts.year = "numeric";
        break;
      case 2: // DayOfMonth
        opts.day = "2-digit";
        opts.month = "short";
        break;
      case 3: // Time
        opts.hour = "2-digit";
        opts.minute = "2-digit";
        opts.hour12 = false;
        break;
      case 4: // TimeWithSeconds
        opts.hour = "2-digit";
        opts.minute = "2-digit";
        opts.second = "2-digit";
        opts.hour12 = false;
        break;
      default:
        // Fallback: show day + month
        opts.day = "2-digit";
        opts.month = "short";
        break;
    }

    return new Intl.DateTimeFormat("en-IN", opts).format(date);
  }, []);

  const getIntervalMinutes = useCallback((interval: ChartInterval): number | null => {
    if (interval.endsWith("T")) return null;
    if (interval.endsWith("H")) return parseInt(interval, 10) * 60;
    return parseInt(interval, 10);
  }, []);

  const transformCandlesByInterval = useCallback((candles: CandleData[], interval: ChartInterval): CandleData[] => {
    if (candles.length === 0) return candles;

    const sorted = [...candles]
      .map((c) => ({ ...c, time: normalizeCandleTime(c.time) }))
      .sort((a, b) => a.time - b.time);

    if (interval.endsWith("T")) {
      const ticksPerBar = Math.max(1, parseInt(interval, 10));
      const out: CandleData[] = [];
      for (let i = 0; i < sorted.length; i += ticksPerBar) {
        const chunk = sorted.slice(i, i + ticksPerBar);
        if (!chunk.length) continue;
        out.push({
          time: chunk[chunk.length - 1].time,
          open: chunk[0].open,
          close: chunk[chunk.length - 1].close,
          high: Math.max(...chunk.map((c) => c.high)),
          low: Math.min(...chunk.map((c) => c.low)),
          volume: chunk.reduce((sum, c) => sum + (c.volume ?? 0), 0),
        });
      }
      return out;
    }

    const intervalMinutes = getIntervalMinutes(interval);
    if (!intervalMinutes) return sorted;
    const bucketSeconds = intervalMinutes * 60;
    const grouped = new Map<number, CandleData[]>();
    for (const candle of sorted) {
      const bucket = Math.floor(candle.time / bucketSeconds) * bucketSeconds;
      const arr = grouped.get(bucket) ?? [];
      arr.push(candle);
      grouped.set(bucket, arr);
    }
    return Array.from(grouped.entries()).map(([bucket, bucketCandles]) => ({
      time: bucket,
      open: bucketCandles[0].open,
      close: bucketCandles[bucketCandles.length - 1].close,
      high: Math.max(...bucketCandles.map((c) => c.high)),
      low: Math.min(...bucketCandles.map((c) => c.low)),
      volume: bucketCandles.reduce((sum, c) => sum + (c.volume ?? 0), 0),
    }));
  }, [getIntervalMinutes, normalizeCandleTime]);

  const calculateLineData = useCallback((candles: CandleData[], indicator: IndicatorKey) => {
    type UTCTimestamp = import("lightweight-charts").UTCTimestamp;
    if (indicator === "SMA50") {
      return candles.map((candle, index) => {
        if (index < 49) return null;
        const window = candles.slice(index - 49, index + 1);
        const value = window.reduce((sum, item) => sum + item.close, 0) / window.length;
        return { time: normalizeCandleTime(candle.time) as UTCTimestamp, value: Number(value.toFixed(2)) };
      }).filter(Boolean);
    }

    if (indicator === "VWAP") {
      let cumulativePriceVolume = 0;
      let cumulativeVolume = 0;
      return candles.map((candle) => {
        const typical = (candle.high + candle.low + candle.close) / 3;
        const volume = candle.volume || 1;
        cumulativePriceVolume += typical * volume;
        cumulativeVolume += volume;
        return {
          time: normalizeCandleTime(candle.time) as UTCTimestamp,
          value: Number((cumulativePriceVolume / cumulativeVolume).toFixed(2)),
        };
      });
    }

    const smoothing = 2 / (20 + 1);
    let ema = candles[0]?.close ?? 0;
    return candles.map((candle, index) => {
      ema = index === 0 ? candle.close : candle.close * smoothing + ema * (1 - smoothing);
      return { time: normalizeCandleTime(candle.time) as UTCTimestamp, value: Number(ema.toFixed(2)) };
    });
  }, [normalizeCandleTime]);

  const updateIndicatorSeries = useCallback((candles: CandleData[]) => {
    for (const indicator of INDICATORS) {
      const series = indicatorSeriesRef.current[indicator.key];
      if (!series) continue;
      try {
        series.setData(visibleIndicators[indicator.key] ? calculateLineData(candles, indicator.key) : []);
      } catch {
        // Ignore chart disposal races.
      }
    }
  }, [calculateLineData, visibleIndicators]);

  // ── Detect dark mode ──
  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains("dark"));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // ── Suppress lightweight-charts internal "Object is disposed" errors ──
  useEffect(() => {
    const handler = (event: ErrorEvent) => {
      if (event.message?.includes("Object is disposed")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
      }
    };
    window.addEventListener("error", handler, true);
    return () => window.removeEventListener("error", handler, true);
  }, []);

  // ── Fetch candle data from backend ──
  const fetchCandles = useCallback(async (tf: string, signal?: AbortSignal): Promise<CandleData[]> => {
    try {
      const intervalMinutes = getIntervalMinutes(chartInterval);
      const cacheKey = [exchange, segment, ticker, tf, chartInterval].join(":");
      const cached = candleCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.data;

      const res = await fetch(
        `${API_CONFIG.baseUrl}/api/candles/${ticker}?tf=${tf}&segment=${segment}&exchange=${exchange}${intervalMinutes ? `&interval=${intervalMinutes}` : ""}`,
        { cache: "no-store", signal }
      );
      if (!res.ok) throw new Error("Failed to fetch candle data");
      const data = await res.json();
      candleCache.set(cacheKey, { data, expiresAt: Date.now() + (marketOpen ? 5000 : 30000) });
      if (candleCache.size > 80) {
        const firstKey = candleCache.keys().next().value;
        if (firstKey) candleCache.delete(firstKey);
      }
      return data;
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return [];
      return [];
    }
  }, [ticker, exchange, segment, chartInterval, getIntervalMinutes, marketOpen]);

  // ══════════════════════════════════════════════════════════════
  // Effect 1: Chart instance lifecycle
  //   - Creates the chart + series + resize observer
  //   - Only re-runs on theme / height changes (rare)
  //   - Cleanup is fully ref-based — never leaks ResizeObserver
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const container = chartContainerRef.current;
    let cancelled = false;
    disposedRef.current = false;

    (async () => {
      const { createChart } = await import("lightweight-charts");
      if (cancelled) return;

      const chart = createChart(container, {
        width: container.clientWidth,
        height: height - 8,
        layout: {
          background: { color: isDark ? "#000000" : "#ffffff" },
          textColor: isDark ? "#a0a0a0" : "#555555",
          fontFamily: "'Inter', -apple-system, sans-serif",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: isDark ? "#0d0d0d" : "#f0f0f0" },
          horzLines: { color: isDark ? "#0d0d0d" : "#f0f0f0" },
        },
        crosshair: {
          mode: 0,
          vertLine: { color: isDark ? "#2a2a2a" : "#cccccc", style: 2 },
          horzLine: { color: isDark ? "#2a2a2a" : "#cccccc", style: 2 },
        },
        rightPriceScale: {
          borderColor: isDark ? "#1a1a1a" : "#e0e0e0",
          scaleMargins: { top: 0.05, bottom: 0.25 },
        },
        timeScale: {
          borderColor: isDark ? "#1a1a1a" : "#e0e0e0",
          timeVisible: true,
          secondsVisible: false,
          tickMarkFormatter: (time: ChartTime, tickMarkType: number) => {
            if (typeof time === "number") return formatIstTickMark(time, tickMarkType);
            // Business day format fallback
            if (tickMarkType === 0) return `${time.year}`;
            if (tickMarkType === 1) return `${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][time.month] || time.month} ${time.year}`;
            return `${time.day.toString().padStart(2, "0")} ${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][time.month] || time.month}`;
          },
        },
        localization: {
          timeFormatter: (time: ChartTime) => {
            if (typeof time === "number") {
              const date = new Date(time * 1000);
              return new Intl.DateTimeFormat("en-IN", {
                timeZone: "Asia/Kolkata",
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }).format(date);
            }
            return `${time.day.toString().padStart(2, "0")} ${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][time.month] || time.month} ${time.year}`;
          },
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale: { mouseWheel: true, pinch: true },
      });

      if (cancelled) {
        try { chart.remove(); } catch {}
        return;
      }

      chartApiRef.current = chart;

      candleSeriesRef.current = chart.addCandlestickSeries({
        upColor: "#00c853",
        downColor: "#ef4444",
        borderUpColor: "#00c853",
        borderDownColor: "#ef4444",
        wickUpColor: "#00c853",
        wickDownColor: "#ef4444",
      });

      const volSeries = chart.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: "",
      });
      volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      volumeSeriesRef.current = volSeries;

      indicatorSeriesRef.current = {};
      for (const indicator of INDICATORS) {
        indicatorSeriesRef.current[indicator.key] = chart.addLineSeries({
          color: indicator.color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
        });
      }

      // Resize observer (stored in ref so cleanup always disconnects)
      const ro = new ResizeObserver((entries) => {
        if (disposedRef.current || !chartApiRef.current) return;
        for (const entry of entries) {
          try { chartApiRef.current.applyOptions({ width: entry.contentRect.width }); } catch {}
        }
      });
      ro.observe(container);
      resizeObserverRef.current = ro;
    })();

    return () => {
      cancelled = true;
      disposedRef.current = true;
      // Clear refresh timer
      if (refreshTimerRef.current) { clearInterval(refreshTimerRef.current); refreshTimerRef.current = null; }
      // Disconnect resize observer
      if (resizeObserverRef.current) { resizeObserverRef.current.disconnect(); resizeObserverRef.current = null; }
      // Remove chart instance
      const chart = chartApiRef.current;
      chartApiRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      indicatorSeriesRef.current = {};
      if (chart) { try { chart.remove(); } catch {} }
    };
  }, [isDark, height, formatIstTime, formatIstTickMark]);

  // ══════════════════════════════════════════════════════════════
  // Effect 2: Data loading
  //   - Fetches candles and pushes them into the existing series
  //   - Re-runs on ticker / timeframe / interval / market-status changes
  //   - NEVER destroys the chart — just swaps data
  // ══════════════════════════════════════════════════════════════
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadData = async () => {
      // Wait for chart to be created by Effect 1
      for (let attempt = 0; attempt < 60; attempt++) {
        if (candleSeriesRef.current && volumeSeriesRef.current) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      if (cancelled || !candleSeriesRef.current) return;

      setIsLoading(true);
      setError(null);

      const rawCandles = await fetchCandles(timeframe, controller.signal);
      if (cancelled) return;

      const candles = transformCandlesByInterval(rawCandles, chartInterval);
      if (candles.length === 0) {
        setError("No chart data available");
        setIsLoading(false);
        return;
      }

      latestCandleRef.current = candles[candles.length - 1] ?? null;

      type UTCTimestamp = import("lightweight-charts").UTCTimestamp;

      const candleData = candles.map((c) => ({
        time: normalizeCandleTime(c.time) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      const volData = candles.map((c) => ({
        time: normalizeCandleTime(c.time) as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open
          ? (isDark ? "rgba(0, 200, 83, 0.3)" : "rgba(0, 200, 83, 0.4)")
          : (isDark ? "rgba(239, 68, 68, 0.3)" : "rgba(239, 68, 68, 0.4)"),
      }));

      if (cancelled) return;

      try {
        candleSeriesRef.current?.setData(candleData);
        volumeSeriesRef.current?.setData(volData);
        updateIndicatorSeries(candles);
        chartApiRef.current?.timeScale().fitContent();
        setError(null);
      } catch {
        // Chart may have been disposed between checks
      }
      setIsLoading(false);
    };

    // ── Auto-refresh during market hours ──
    const setupRefresh = () => {
      if (refreshTimerRef.current) { clearInterval(refreshTimerRef.current); refreshTimerRef.current = null; }
      if (!marketOpen) return;

      const refreshMs = timeframe === "1D" ? 900 : 1800;
      refreshTimerRef.current = setInterval(async () => {
        if (cancelled || !candleSeriesRef.current) return;
        try {
          const raw = await fetchCandles(timeframe);
          if (cancelled) return;
          const processed = transformCandlesByInterval(raw, chartInterval);
          if (processed.length === 0) return;

          latestCandleRef.current = processed[processed.length - 1] ?? latestCandleRef.current;

          type UTCTimestamp = import("lightweight-charts").UTCTimestamp;
          candleSeriesRef.current?.setData(processed.map((c) => ({
            time: normalizeCandleTime(c.time) as UTCTimestamp,
            open: c.open, high: c.high, low: c.low, close: c.close,
          })));
          volumeSeriesRef.current?.setData(processed.map((c) => ({
            time: normalizeCandleTime(c.time) as UTCTimestamp,
            value: c.volume,
            color: c.close >= c.open
              ? (isDark ? "rgba(0,200,83,0.3)" : "rgba(0,200,83,0.4)")
              : (isDark ? "rgba(239,68,68,0.3)" : "rgba(239,68,68,0.4)"),
          })));
          updateIndicatorSeries(processed);
        } catch {
          // silently ignore refresh errors
        }
      }, refreshMs);
    };

    loadData().then(setupRefresh);

    return () => {
      cancelled = true;
      controller.abort();
      if (refreshTimerRef.current) { clearInterval(refreshTimerRef.current); refreshTimerRef.current = null; }
    };
  }, [ticker, timeframe, chartInterval, isDark, fetchCandles, normalizeCandleTime, transformCandlesByInterval, marketOpen, updateIndicatorSeries]);

  useEffect(() => {
    if (!liveLtp || liveLtp <= 0) return;
    if (!candleSeriesRef.current || !latestCandleRef.current) return;

    const last = latestCandleRef.current;
    const patched: CandleData = {
      ...last,
      high: Math.max(last.high, liveLtp),
      low: Math.min(last.low, liveLtp),
      close: liveLtp,
    };

    latestCandleRef.current = patched;

    try {
      type UTCTimestamp = import("lightweight-charts").UTCTimestamp;
      candleSeriesRef.current.update({
        time: normalizeCandleTime(patched.time) as UTCTimestamp,
        open: patched.open,
        high: patched.high,
        low: patched.low,
        close: patched.close,
      });
    } catch {
      // Ignore chart update races during disposal
    }
  }, [liveLtp, normalizeCandleTime]);

  const selectTimeframe = (nextTimeframe: Timeframe) => {
    setTimeframe(nextTimeframe);
    onTimeframeChange?.(nextTimeframe);
  };

  const toggleIndicator = (indicator: IndicatorKey) => {
    setVisibleIndicators((current) => ({ ...current, [indicator]: !current[indicator] }));
  };

  return (
    <div className="terminal-panel overflow-hidden">
      {/* Timeframe Controls */}
      <div className="terminal-panel-header gap-1">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => selectTimeframe(tf)}
            className={cn(
              "rounded-sm px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors duration-150",
              tf === timeframe
                ? "bg-amber-400 text-black"
                : "terminal-subtle hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-accent)]"
            )}
          >
            {tf}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-1 lg:flex">
            {INDICATORS.map((indicator) => (
              <button
                key={indicator.key}
                type="button"
                title={`Toggle ${indicator.label}`}
                onClick={() => toggleIndicator(indicator.key)}
                className={cn(
                  "rounded-sm border px-2 py-1 font-mono text-[10px] font-semibold uppercase transition-colors",
                  visibleIndicators[indicator.key]
                    ? "border-[color:var(--terminal-accent)] bg-[var(--terminal-accent-soft)] text-[var(--terminal-accent)]"
                    : "border-[color:var(--terminal-grid)] text-[var(--terminal-subtle)] hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-accent)]"
                )}
              >
                {indicator.key}
              </button>
            ))}
          </div>
          <select
            value={chartInterval}
            onChange={(e) => setChartInterval(e.target.value as ChartInterval)}
            className="terminal-input h-7 rounded-sm px-2 text-[11px] outline-none"
          >
            {CHART_INTERVALS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <span className="terminal-subtle font-mono text-2xs">{exchange}:{ticker}</span>
          <span className="terminal-subtle font-mono text-2xs">IST</span>
        </div>
      </div>

      {/* Chart */}
      <div className="relative" style={{ height }}>
        {isLoading && (
          <div className="terminal-overlay absolute inset-0 z-10 flex items-center justify-center">
            <div className="terminal-subtle flex items-center gap-2 text-sm">
              <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              Loading chart...
            </div>
          </div>
        )}
        {error && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="terminal-subtle text-sm">{error}</div>
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
