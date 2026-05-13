"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { Activity, ArrowDownRight, ArrowUpRight, Briefcase, CandlestickChart, History, Plus, Radio, Wallet, X } from "lucide-react";
import { MarketIndexRibbon } from "@/components/market/index-ribbon";
import { StockLogo } from "@/components/market/stock-logo";
import { StockChart } from "@/components/market/stock-chart";
import { OrderPad } from "@/components/trading/order-pad";
import { ReplayLab } from "@/components/workstation/replay-lab";
import { useToast } from "@/components/toast-provider";
import { useAlerts } from "@/hooks/useAlerts";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { useAllStreamPrices, useStreamPrice } from "@/hooks/usePriceStream";
import { usePortfolio } from "@/hooks/usePortfolio";
import { CHART_LAYOUT_PRESETS, loadChartLayout, MAX_TAB_CHARTS, saveChartLayout, type SavedChartLayout } from "@/lib/chart-layouts";
import { ALERT_METRIC_LABELS, describeAlertRule, evaluateAlertRule, type AlertMetric, type AlertMetricSnapshot, type AlertOperator } from "@/lib/alerts";
import { FNO_UNDERLYINGS, MOCK_COMMODITIES, MOCK_STOCKS } from "@/lib/constants";
import { cn, formatCurrency, formatNumber, formatPercentage, getPriceChangeColor } from "@/lib/utils";
import type { OrderType, OrderVariety, Timeframe } from "@/lib/types";

const CORE_SYMBOLS = ["RELIANCE", "HDFCBANK", "TCS", "INFY", "ICICIBANK", "SBIN", "ITC", "BHARTIARTL", "LT", "AXISBANK", "BAJFINANCE", "TATAMOTORS"];
const CHART_SYMBOLS = Array.from(new Set(CORE_SYMBOLS.concat(["SUNPHARMA", "MARUTI", "HCLTECH", "NTPC", "KOTAKBANK", "TATASTEEL"])));
const TAB_ITEMS = ["Charts", "NIFTY", "Replay", "Portfolio", "Orders"] as const;

type OrderDraft = {
  ticker: string;
  name: string;
  ltp: number;
  type: OrderType;
  lotSize?: number;
  defaultQuantity?: number;
  defaultVariety?: OrderVariety;
  defaultLimitPrice?: number;
  defaultTriggerPrice?: number;
} | null;

function stockMeta(ticker: string) {
  return MOCK_STOCKS.find((stock) => stock.ticker === ticker);
}

function ModeBadge() {
  const { mode, modes } = useLayoutMode();
  const active = modes.find((item) => item.value === mode);
  return (
    <div className="terminal-badge rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em]">
      {active?.shortLabel ?? "Dense"}
    </div>
  );
}

function StreamHealth() {
  const { connected, status } = useAllStreamPrices();
  const degraded = status?.degraded_reason;
  return (
    <div className={cn(
      "inline-flex items-center gap-2 rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em]",
      connected && !degraded
        ? "border-profit/30 bg-profit/10 text-profit"
        : "border-warning/30 bg-warning/10 text-warning"
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", connected && !degraded ? "bg-profit" : "bg-warning")} />
      {connected && !degraded ? "Live" : degraded || "Connecting"}
    </div>
  );
}

function DeskHeader() {
  const { balance, summary, risk, orders } = usePortfolio();
  const openOrders = orders.filter((order) => order.status === "PENDING" || order.status === "PARTIAL").length;
  const cells = [
    { label: "Cash", value: formatCurrency(balance), tone: "text-[var(--terminal-accent)]" },
    { label: "Exposure", value: formatCurrency(summary.currentValue), tone: "terminal-fg" },
    {
      label: "P&L",
      value: `${summary.totalPnl >= 0 ? "+" : ""}${formatCurrency(summary.totalPnl)}`,
      tone: summary.totalPnl >= 0 ? "text-profit" : "text-loss",
    },
    {
      label: "Risk",
      value: `${risk.riskScore}/100`,
      tone: risk.riskScore > 65 ? "text-loss" : risk.riskScore > 35 ? "text-warning" : "text-info",
    },
    { label: "Open", value: openOrders, tone: openOrders > 0 ? "text-warning" : "terminal-fg" },
  ];

  return (
    <div className="terminal-tape mb-3 overflow-hidden rounded-sm">
      <div className="grid gap-px bg-[var(--terminal-grid)] md:grid-cols-[minmax(240px,1fr)_auto]">
        <div className="bg-[var(--terminal-surface)] px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <ModeBadge />
            <StreamHealth />
            <span className="terminal-badge rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em]">
              NSE Paper Desk
            </span>
          </div>
          <div className="terminal-subtle mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em]">
            <Radio size={12} />
            <span>Terminal workspace</span>
            <History size={12} />
            <span>IST session</span>
          </div>
        </div>
        <div className="grid min-w-full grid-cols-5 bg-[var(--terminal-grid)] md:min-w-[520px]">
          {cells.map((cell) => (
            <div key={cell.label} className="bg-[var(--terminal-surface)] px-3 py-2">
              <div className="terminal-subtle font-mono text-[9px] uppercase tracking-[0.12em]">{cell.label}</div>
              <div className={cn("terminal-number mt-1 text-[12px] font-bold", cell.tone)}>{cell.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuoteRow({ ticker, onTrade }: { ticker: string; onTrade?: (draft: OrderDraft) => void }) {
  const fallback = stockMeta(ticker);
  const stream = useStreamPrice(ticker);
  const ltp = stream?.ltp ?? fallback?.ltp ?? 0;
  const change = stream?.change ?? fallback?.change ?? 0;
  const changePercent = stream?.changePercent ?? fallback?.changePercent ?? 0;
  const isUp = change >= 0;

  return (
    <div className="terminal-row grid-cols-[92px_1fr_78px_58px_32px] gap-1.5">
      <Link href={`/stocks/${ticker}`} className="flex min-w-0 items-center gap-2 font-mono font-bold text-[var(--terminal-accent)] hover:text-[var(--terminal-accent)]">
        <StockLogo ticker={ticker} className="h-6 w-6 flex-shrink-0 rounded-sm" textClassName="text-[8px]" />
        <span className="truncate">{ticker}</span>
      </Link>
      <span className="terminal-muted truncate">{fallback?.name ?? ticker}</span>
      <span className="terminal-number terminal-fg text-right">{ltp > 0 ? formatCurrency(ltp) : "-"}</span>
      <span className={cn("terminal-number flex items-center justify-end gap-1", getPriceChangeColor(change))}>
        {isUp ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
        {formatPercentage(changePercent)}
      </span>
      <button
        type="button"
        title={`Trade ${ticker}`}
        className="terminal-action h-6 px-1.5 text-[10px]"
        onClick={() => onTrade?.({ ticker, name: fallback?.name ?? ticker, ltp, type: "BUY" })}
        disabled={ltp <= 0}
      >
        T
      </button>
    </div>
  );
}

function QuoteBoard({ title, symbols, onTrade }: { title: string; symbols: string[]; onTrade: (draft: OrderDraft) => void }) {
  return (
    <section className="terminal-panel overflow-hidden">
      <div className="terminal-panel-header">
        <h2 className="terminal-title">{title}</h2>
        <span className="terminal-subtle font-mono text-[10px]">{symbols.length} SYM</span>
      </div>
      <div className="terminal-table-head grid grid-cols-[92px_1fr_78px_58px_32px] gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-[0.1em]">
        <span>Symbol</span>
        <span>Name</span>
        <span className="text-right">Last</span>
        <span className="text-right">Move</span>
        <span className="text-right">Act</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {symbols.map((ticker) => (
          <QuoteRow key={ticker} ticker={ticker} onTrade={onTrade} />
        ))}
      </div>
    </section>
  );
}

function PortfolioRail() {
  const { balance, summary, risk, positions } = usePortfolio();
  const cells = [
    { label: "Cash", value: formatCurrency(balance), tone: "text-[var(--terminal-accent)]" },
    { label: "Current", value: formatCurrency(summary.currentValue), tone: "terminal-fg" },
    { label: "P&L", value: `${summary.totalPnl >= 0 ? "+" : ""}${formatCurrency(summary.totalPnl)}`, tone: summary.totalPnl >= 0 ? "text-profit" : "text-loss" },
    { label: "Risk", value: `${risk.riskScore}/100`, tone: risk.riskScore > 65 ? "text-loss" : risk.riskScore > 35 ? "text-warning" : "text-info" },
  ];

  return (
    <section className="terminal-panel">
      <div className="terminal-panel-header">
        <h2 className="terminal-title">Account</h2>
        <Briefcase size={14} className="text-[var(--terminal-accent)]" />
      </div>
      <div className="grid grid-cols-2 border-b border-[color:var(--terminal-grid)]">
        {cells.map((cell) => (
          <div key={cell.label} className="border-r border-b border-[color:var(--terminal-grid)] px-3 py-2 last:border-r-0">
            <div className="terminal-subtle text-[10px] uppercase tracking-[0.1em]">{cell.label}</div>
            <div className={cn("terminal-number mt-1 text-[13px] font-bold", cell.tone)}>{cell.value}</div>
          </div>
        ))}
      </div>
      {risk.warnings[0] && (
        <div className="border-b border-[color:var(--terminal-grid)] px-3 py-2 text-[10px] text-warning">
          {risk.warnings[0].message}
        </div>
      )}
      <div className="max-h-[220px] overflow-y-auto">
        {positions.length === 0 ? (
          <div className="terminal-subtle px-3 py-5 text-center text-[11px]">No open paper positions</div>
        ) : (
          positions.slice(0, 8).map((position) => (
            <div key={position.id} className="terminal-row grid-cols-[1fr_60px_86px] gap-2">
              <span className="font-mono text-[var(--terminal-accent)]">{position.ticker}</span>
              <span className="terminal-number terminal-muted text-right">{position.quantity}</span>
              <span className={cn("terminal-number text-right", getPriceChangeColor(position.pnl))}>
                {position.pnl >= 0 ? "+" : ""}{formatCurrency(position.pnl)}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function CommodityStrip() {
  const { commodities } = useAllStreamPrices();
  const visible = MOCK_COMMODITIES.slice(0, 8);
  return (
    <section className="terminal-panel overflow-hidden">
      <div className="terminal-panel-header">
        <h2 className="terminal-title">Commodities</h2>
        <Activity size={14} className="text-[var(--terminal-accent)]" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2">
        {visible.map((commodity) => {
          const stream = commodities[commodity.ticker];
          const ltp = stream?.ltp ?? commodity.ltp;
          const change = stream?.change ?? commodity.change;
          return (
            <div key={commodity.ticker} className="terminal-row grid-cols-[1fr_90px_64px] gap-2">
              <span className="terminal-muted truncate">{commodity.name}</span>
              <span className="terminal-number terminal-fg text-right">{formatNumber(ltp)}</span>
              <span className={cn("terminal-number text-right", getPriceChangeColor(change))}>
                {formatPercentage(stream?.changePercent ?? commodity.changePercent)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FnoMiniChain({ onTrade }: { onTrade: (draft: OrderDraft) => void }) {
  return (
    <section className="terminal-panel overflow-hidden">
      <div className="terminal-panel-header">
        <h2 className="terminal-title">F&O Underlyings</h2>
        <CandlestickChart size={14} className="text-[var(--terminal-accent)]" />
      </div>
      {FNO_UNDERLYINGS.slice(0, 6).map((underlying) => (
        <div key={underlying.ticker} className="terminal-row grid-cols-[96px_1fr_76px_54px] gap-2">
          <Link href={`/fno?underlying=${underlying.ticker}`} className="flex min-w-0 items-center gap-2 font-mono font-bold text-[var(--terminal-accent)]">
            {stockMeta(underlying.ticker) ? (
              <StockLogo ticker={underlying.ticker} className="h-6 w-6 flex-shrink-0 rounded-sm" textClassName="text-[8px]" />
            ) : (
              <span className="terminal-badge flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-sm font-mono text-[8px]">
                {underlying.ticker.slice(0, 2)}
              </span>
            )}
            <span className="truncate">{underlying.ticker}</span>
          </Link>
          <span className="terminal-muted truncate">{underlying.name}</span>
          <span className="terminal-number terminal-fg text-right">{formatCurrency(underlying.ltp)}</span>
          <button
            type="button"
            className="terminal-action h-6 px-1.5 text-[10px]"
            onClick={() => onTrade({ ticker: underlying.ticker, name: underlying.name, ltp: underlying.ltp, type: "BUY", lotSize: underlying.lotSize })}
          >
            Trade
          </button>
        </div>
      ))}
    </section>
  );
}

function ActionRail({ onTrade }: { onTrade: (draft: OrderDraft) => void }) {
  const reliance = useStreamPrice("RELIANCE");
  const fallback = stockMeta("RELIANCE");
  const ltp = reliance?.ltp ?? fallback?.ltp ?? 0;
  return (
    <section className="terminal-panel">
      <div className="terminal-panel-header">
        <h2 className="terminal-title">Order Ticket</h2>
        <Wallet size={14} className="text-[var(--terminal-accent)]" />
      </div>
      <div className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <button className="terminal-action h-9 bg-profit/15 text-profit hover:bg-profit disabled:cursor-not-allowed disabled:opacity-40" disabled={ltp <= 0} onClick={() => onTrade({ ticker: "RELIANCE", name: fallback?.name ?? "RELIANCE", ltp, type: "BUY" })}>
            Buy REL
          </button>
          <button className="terminal-action h-9 border-loss/30 bg-loss/15 text-loss hover:bg-loss hover:text-white disabled:cursor-not-allowed disabled:opacity-40" disabled={ltp <= 0} onClick={() => onTrade({ ticker: "RELIANCE", name: fallback?.name ?? "RELIANCE", ltp, type: "SELL" })}>
            Sell REL
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            className="terminal-action h-7 px-1 text-[9px]"
            disabled={ltp <= 0}
            onClick={() => onTrade({ ticker: "RELIANCE", name: fallback?.name ?? "RELIANCE", ltp, type: "BUY", defaultVariety: "LIMIT", defaultLimitPrice: ltp })}
          >
            Limit
          </button>
          <button
            className="terminal-action h-7 px-1 text-[9px]"
            disabled={ltp <= 0}
            onClick={() => onTrade({ ticker: "RELIANCE", name: fallback?.name ?? "RELIANCE", ltp, type: "SELL", defaultVariety: "SL-M", defaultTriggerPrice: ltp * 0.98 })}
          >
            SL-M
          </button>
          <button
            className="terminal-action h-7 px-1 text-[9px]"
            disabled={ltp <= 0}
            onClick={() => onTrade({ ticker: "RELIANCE", name: fallback?.name ?? "RELIANCE", ltp, type: "BUY", defaultQuantity: 10 })}
          >
            10 Qty
          </button>
        </div>
        <div className="terminal-fill rounded-sm border border-[color:var(--terminal-grid)] p-3">
          <div className="terminal-subtle text-[10px] uppercase tracking-[0.12em]">Reference</div>
          <div className="terminal-number mt-1 text-2xl font-bold text-[var(--terminal-accent)]">{ltp > 0 ? formatCurrency(ltp) : "-"}</div>
          <div className="terminal-subtle mt-2 grid grid-cols-2 gap-2 font-mono text-[9px] uppercase tracking-[0.1em]">
            <span className="terminal-data-cell rounded-sm px-2 py-1">Market</span>
            <span className="terminal-data-cell rounded-sm px-2 py-1">SL/LMT</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function DenseCommandCenter({ onTrade }: { onTrade: (draft: OrderDraft) => void }) {
  return (
    <div className="space-y-3">
      <MarketIndexRibbon />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(270px,0.85fr)_minmax(420px,1.15fr)_minmax(240px,0.75fr)]">
        <QuoteBoard title="Equity Monitor" symbols={CORE_SYMBOLS} onTrade={onTrade} />
        <section className="terminal-panel overflow-hidden">
          <div className="terminal-panel-header">
            <h2 className="terminal-title">RELIANCE Chart</h2>
            <StreamHealth />
          </div>
          <StockChart ticker="RELIANCE" height={444} />
        </section>
        <div className="space-y-3">
          <ActionRail onTrade={onTrade} />
          <PortfolioRail />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <FnoMiniChain onTrade={onTrade} />
        <CommodityStrip />
      </div>
    </div>
  );
}

function ClassicBrokerage({ onTrade }: { onTrade: (draft: OrderDraft) => void }) {
  return (
    <div className="space-y-4">
      <MarketIndexRibbon />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <QuoteBoard title="Stocks" symbols={CORE_SYMBOLS.concat(["SUNPHARMA", "MARUTI", "HCLTECH", "NTPC"])} onTrade={onTrade} />
        <PortfolioRail />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FnoMiniChain onTrade={onTrade} />
        <CommodityStrip />
      </div>
    </div>
  );
}

function chartGridClass(count: number) {
  if (count <= 1) return "grid-cols-1";
  return "grid-cols-1 xl:grid-cols-2";
}

function chartHeight(count: number) {
  if (count <= 1) return 500;
  if (count === 2) return 420;
  return 250;
}

function AlertsPanel({ defaultTicker }: { defaultTicker: string }) {
  const { alerts, addAdvancedAlert, removeAlert, clearTriggered } = useAlerts();
  const [ticker, setTicker] = useState(defaultTicker);
  const [metric, setMetric] = useState<AlertMetric>("price");
  const [operator, setOperator] = useState<AlertOperator>(">=");
  const [value, setValue] = useState(() => String(stockMeta(defaultTicker)?.ltp ?? ""));
  const activeAlerts = alerts.filter((alert) => alert.status === "ACTIVE");

  const createAlert = () => {
    const triggerValue = Number(value);
    if (!ticker || !Number.isFinite(triggerValue) || triggerValue <= 0) return;
    addAdvancedAlert(ticker, { metric, operator, value: triggerValue });
    setValue("");
  };

  return (
    <section className="terminal-panel overflow-hidden">
      <div className="terminal-panel-header">
        <h2 className="terminal-title">Alerts</h2>
        <span className="terminal-subtle font-mono text-[10px]">{activeAlerts.length} active</span>
      </div>
      <div className="grid gap-2 p-3 md:grid-cols-[104px_110px_74px_1fr_74px]">
        <select value={ticker} onChange={(event) => setTicker(event.target.value)} className="terminal-input h-8 rounded-sm px-2 font-mono text-[11px]">
          {CHART_SYMBOLS.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
        </select>
        <select value={metric} onChange={(event) => setMetric(event.target.value as AlertMetric)} className="terminal-input h-8 rounded-sm px-2 font-mono text-[11px]">
          {(Object.keys(ALERT_METRIC_LABELS) as AlertMetric[]).map((item) => (
            <option key={item} value={item}>{ALERT_METRIC_LABELS[item]}</option>
          ))}
        </select>
        <select value={operator} onChange={(event) => setOperator(event.target.value as AlertOperator)} className="terminal-input h-8 rounded-sm px-2 font-mono text-[11px]">
          <option value=">=">&gt;=</option>
          <option value="<=">&lt;=</option>
        </select>
        <input
          type="number"
          min={0.01}
          step={metric === "price" ? 0.05 : 0.01}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Trigger value"
          className="terminal-input h-8 rounded-sm px-2 font-mono text-[11px] outline-none"
        />
        <button type="button" onClick={createAlert} className="terminal-action h-8 px-2 text-[10px]">
          Set
        </button>
      </div>
      <div className="max-h-36 overflow-y-auto border-t border-[color:var(--terminal-grid)]">
        {alerts.length === 0 ? (
          <div className="terminal-subtle px-3 py-3 text-[11px]">No price alerts configured</div>
        ) : (
          alerts.slice(0, 6).map((alert) => (
            <div key={alert.id} className="terminal-row grid-cols-[70px_1fr_70px_28px] gap-2">
              <span className="font-mono font-bold text-[var(--terminal-accent)]">{alert.ticker}</span>
              <span className="terminal-muted truncate">
                {describeAlertRule(alert.rule ?? { metric: "price", operator: alert.condition === "above" ? ">=" : "<=", value: alert.price })}
              </span>
              <span className={cn("font-mono text-[10px]", alert.status === "ACTIVE" ? "text-profit" : "text-warning")}>{alert.status}</span>
              <button type="button" title="Remove alert" onClick={() => removeAlert(alert.id)} className="terminal-action h-6 px-1">
                <X size={11} />
              </button>
            </div>
          ))
        )}
      </div>
      {alerts.some((alert) => alert.status === "TRIGGERED") && (
        <button type="button" onClick={clearTriggered} className="terminal-subtle w-full border-t border-[color:var(--terminal-grid)] px-3 py-2 text-left text-[10px] uppercase tracking-[0.12em] hover:bg-[var(--terminal-hover)]">
          Clear triggered alerts
        </button>
      )}
    </section>
  );
}

function MultiChartBoard({
  charts,
  setCharts,
  syncTimeframe,
  setSyncTimeframe,
  timeframe,
  setTimeframe,
}: {
  charts: string[];
  setCharts: Dispatch<SetStateAction<string[]>>;
  syncTimeframe: boolean;
  setSyncTimeframe: Dispatch<SetStateAction<boolean>>;
  timeframe: Timeframe;
  setTimeframe: Dispatch<SetStateAction<Timeframe>>;
}) {
  const [selectedSymbol, setSelectedSymbol] = useState(() => CHART_SYMBOLS.find((ticker) => !charts.includes(ticker)) ?? CHART_SYMBOLS[0]);
  const availableSymbols = useMemo(() => CHART_SYMBOLS.filter((ticker) => !charts.includes(ticker)), [charts]);
  const selectedChartSymbol = availableSymbols.includes(selectedSymbol) ? selectedSymbol : availableSymbols[0] ?? "";
  const atLimit = charts.length >= MAX_TAB_CHARTS;

  const addChart = (ticker: string) => {
    setCharts((current) => {
      if (current.includes(ticker) || current.length >= MAX_TAB_CHARTS) return current;
      return [...current, ticker];
    });
  };

  const removeChart = (ticker: string) => {
    setCharts((current) => current.length <= 1 ? current : current.filter((item) => item !== ticker));
  };

  const handleAddSelected = () => {
    if (!selectedChartSymbol) return;
    addChart(selectedChartSymbol);
    const next = CHART_SYMBOLS.find((ticker) => ticker !== selectedChartSymbol && !charts.includes(ticker));
    if (next) setSelectedSymbol(next);
  };

  const applyPreset = (preset: SavedChartLayout) => {
    setCharts(preset.charts);
    setSyncTimeframe(preset.syncTimeframe);
    setTimeframe(preset.timeframe);
  };

  return (
    <div className="space-y-3">
      <div className="terminal-fill rounded-sm border border-[color:var(--terminal-border)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--terminal-border)] bg-[var(--terminal-surface-raised)] px-3 py-2">
          <div className="min-w-0">
            <div className="terminal-title">Chart Matrix</div>
            <div className="terminal-subtle mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em]">
              Matrix · 2x2 cap
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="terminal-badge rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em]">
              {charts.length}/{MAX_TAB_CHARTS} charts
            </span>
            <button
              type="button"
              onClick={() => setSyncTimeframe((current) => !current)}
              className={cn(
                "rounded-sm border px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em]",
                syncTimeframe
                  ? "border-[color:var(--terminal-accent)] bg-[var(--terminal-accent-soft)] text-[var(--terminal-accent)]"
                  : "terminal-subtle border-[color:var(--terminal-grid)] hover:bg-[var(--terminal-hover)]"
              )}
            >
              Sync TF
            </button>
            <select
              value={selectedChartSymbol}
              onChange={(event) => setSelectedSymbol(event.target.value)}
              className="terminal-input h-8 rounded-sm px-2 font-mono text-[11px] outline-none"
              disabled={atLimit || availableSymbols.length === 0}
            >
              {availableSymbols.map((ticker) => (
                <option key={ticker} value={ticker}>
                  {ticker}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="terminal-action flex h-8 items-center gap-1.5 px-2.5 text-[10px]"
              onClick={handleAddSelected}
              disabled={atLimit || availableSymbols.length === 0}
            >
              <Plus size={13} />
              Add Chart
            </button>
          </div>
        </div>

        <div className="flex gap-1.5 overflow-x-auto px-3 py-2">
          {CHART_LAYOUT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.description}
              className="flex items-center gap-1.5 rounded-sm border border-[color:var(--terminal-accent)] bg-[var(--terminal-accent-soft)] px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--terminal-accent)] transition-colors hover:bg-[var(--terminal-accent)] hover:text-black"
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </button>
          ))}
          {CHART_SYMBOLS.slice(0, 12).map((ticker) => {
            const active = charts.includes(ticker);
            return (
              <button
                key={ticker}
                type="button"
                title={active ? `${ticker} is already open` : `Add ${ticker} chart`}
                className={cn(
                  "flex items-center gap-1.5 rounded-sm border px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em] transition-colors",
                  active
                    ? "border-[color:var(--terminal-accent)] bg-[var(--terminal-accent-soft)] text-[var(--terminal-accent)]"
                    : "terminal-subtle border-[color:var(--terminal-grid)] hover:border-[color:var(--terminal-border)] hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-accent)]",
                  atLimit && !active && "cursor-not-allowed opacity-45"
                )}
                onClick={() => addChart(ticker)}
                disabled={active || atLimit}
              >
                <StockLogo ticker={ticker} className="h-5 w-5 rounded-sm" textClassName="text-[7px]" />
                {ticker}
              </button>
            );
          })}
        </div>
      </div>

      <div data-testid="tabs-chart-grid" className={cn("grid gap-3", chartGridClass(charts.length))}>
        {charts.map((ticker, index) => {
          const meta = stockMeta(ticker);
          return (
            <section key={ticker} className="min-w-0">
              <div className="mb-1.5 flex items-center justify-between gap-2 rounded-sm border border-[color:var(--terminal-grid)] bg-[var(--terminal-fill)] px-2 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                  <StockLogo ticker={ticker} className="h-6 w-6 flex-shrink-0 rounded-sm" textClassName="text-[8px]" />
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] font-bold text-[var(--terminal-accent)]">{ticker}</div>
                    <div className="terminal-subtle truncate text-[10px]">{meta?.name ?? "Chart workspace"} · Panel {index + 1}</div>
                  </div>
                </div>
                <button
                  type="button"
                  title={`Close ${ticker} chart`}
                  className="terminal-action flex h-7 w-7 items-center justify-center px-0"
                  onClick={() => removeChart(ticker)}
                  disabled={charts.length <= 1}
                >
                  <X size={13} />
                </button>
              </div>
              <StockChart
                ticker={ticker}
                height={chartHeight(charts.length)}
                timeframeValue={syncTimeframe ? timeframe : undefined}
                onTimeframeChange={syncTimeframe ? setTimeframe : undefined}
              />
            </section>
          );
        })}
      </div>
      <AlertsPanel defaultTicker={charts[0] ?? "RELIANCE"} />
    </div>
  );
}

function PowerUserTabs({ onTrade }: { onTrade: (draft: OrderDraft) => void }) {
  const [activeTab, setActiveTab] = useState<(typeof TAB_ITEMS)[number]>("Charts");
  const [charts, setCharts] = useState<string[]>(() => loadChartLayout().charts);
  const [syncTimeframe, setSyncTimeframe] = useState(() => loadChartLayout().syncTimeframe);
  const [timeframe, setTimeframe] = useState<Timeframe>(() => loadChartLayout().timeframe);

  useEffect(() => {
    saveChartLayout({ charts, syncTimeframe, timeframe });
  }, [charts, syncTimeframe, timeframe]);

  useEffect(() => {
    const handleAddChart = (event: Event) => {
      const detail = (event as CustomEvent<{ ticker?: string }>).detail;
      const ticker = detail?.ticker?.trim().toUpperCase();
      if (!ticker) return;
      setActiveTab("Charts");
      setCharts((current) => {
        if (current.includes(ticker) || current.length >= MAX_TAB_CHARTS) return current;
        return [...current, ticker];
      });
    };
    window.addEventListener("equityflow-add-chart", handleAddChart);
    return () => window.removeEventListener("equityflow-add-chart", handleAddChart);
  }, []);

  useEffect(() => {
    const handleApplyLayout = (event: Event) => {
      const detail = (event as CustomEvent<{ layout?: SavedChartLayout }>).detail;
      if (!detail?.layout) return;
      setActiveTab("Charts");
      setCharts(detail.layout.charts);
      setSyncTimeframe(detail.layout.syncTimeframe);
      setTimeframe(detail.layout.timeframe);
    };
    window.addEventListener("equityflow-apply-chart-layout", handleApplyLayout);
    return () => window.removeEventListener("equityflow-apply-chart-layout", handleApplyLayout);
  }, []);

  const tabContent = useMemo(() => {
    if (activeTab === "Charts") {
      return (
        <MultiChartBoard
          charts={charts}
          setCharts={setCharts}
          syncTimeframe={syncTimeframe}
          setSyncTimeframe={setSyncTimeframe}
          timeframe={timeframe}
          setTimeframe={setTimeframe}
        />
      );
    }
    if (activeTab === "Replay") return <ReplayLab />;
    if (activeTab === "Portfolio") return <PortfolioRail />;
    if (activeTab === "Orders") return <ClassicBrokerage onTrade={onTrade} />;
    if (activeTab === "NIFTY") return <FnoMiniChain onTrade={onTrade} />;
  }, [activeTab, charts, onTrade, syncTimeframe, timeframe]);

  return (
    <div className="space-y-3">
      <div className="terminal-panel overflow-hidden">
        <div className="flex items-center gap-1 overflow-x-auto border-b border-[color:var(--terminal-border)] bg-[var(--terminal-surface-raised)] p-1">
          {TAB_ITEMS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn(
                "rounded-sm px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.08em]",
                activeTab === tab ? "bg-amber-400 text-black" : "terminal-muted hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-accent)]"
              )}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="p-3">{tabContent}</div>
      </div>
    </div>
  );
}

export function TerminalWorkspace() {
  const { mode } = useLayoutMode();
  const [orderDraft, setOrderDraft] = useState<OrderDraft>(null);
  const { prices } = useAllStreamPrices();
  const { alerts, triggerAlert } = useAlerts();
  const { toast } = useToast();

  useEffect(() => {
    const handleOpenOrder = (event: Event) => {
      const detail = (event as CustomEvent<{
        ticker?: string;
        type?: OrderType;
        quantity?: number;
        variety?: OrderVariety;
        price?: number;
        triggerPrice?: number;
      }>).detail;
      const ticker = detail?.ticker?.trim().toUpperCase();
      if (!ticker) return;
      const fallback = stockMeta(ticker);
      const stream = prices[ticker];
      const ltp = stream?.ltp ?? fallback?.ltp ?? 0;
      setOrderDraft({
        ticker,
        name: fallback?.name ?? stream?.name ?? ticker,
        ltp,
        type: detail?.type === "SELL" ? "SELL" : "BUY",
        defaultQuantity: Math.max(1, Number(detail?.quantity) || 1),
        defaultVariety: detail?.variety,
        defaultLimitPrice: detail?.price,
        defaultTriggerPrice: detail?.triggerPrice,
      });
    };
    window.addEventListener("equityflow-open-order", handleOpenOrder);
    return () => window.removeEventListener("equityflow-open-order", handleOpenOrder);
  }, [prices]);

  useEffect(() => {
    for (const alert of alerts) {
      if (alert.status !== "ACTIVE") continue;
      const fallback = stockMeta(alert.ticker);
      const live = prices[alert.ticker];
      const ltp = live?.ltp ?? fallback?.ltp ?? 0;
      if (ltp <= 0) continue;
      const rule = alert.rule ?? { metric: "price" as const, operator: alert.condition === "above" ? ">=" as const : "<=" as const, value: alert.price };
      const snapshot: AlertMetricSnapshot = {
        price: ltp,
        changePercent: live?.changePercent ?? fallback?.changePercent,
        volume: fallback?.volume,
        pcr: undefined,
        iv: undefined,
        oiChange: undefined,
      };
      const triggered = evaluateAlertRule(rule, snapshot);
      if (!triggered) continue;
      triggerAlert(alert.id, ltp, snapshot[rule.metric], snapshot);
      toast({
        title: `Alert Triggered: ${alert.ticker}`,
        description: `${alert.ticker} ${describeAlertRule(rule)}. Last price ${formatCurrency(ltp)}.`,
        variant: "success",
      });
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        new Notification(`EquityFlow alert: ${alert.ticker}`, {
          body: `${alert.ticker} hit ${formatCurrency(ltp)}`,
        });
      }
    }
  }, [alerts, prices, toast, triggerAlert]);

  return (
    <div className="terminal-shell min-h-full px-3 py-3 md:px-4">
      <DeskHeader />

      {mode === "classic" ? (
        <ClassicBrokerage onTrade={setOrderDraft} />
      ) : mode === "tabs" ? (
        <PowerUserTabs onTrade={setOrderDraft} />
      ) : (
        <DenseCommandCenter onTrade={setOrderDraft} />
      )}

      {orderDraft && (
        <OrderPad
          open={!!orderDraft}
          onOpenChange={(open) => {
            if (!open) setOrderDraft(null);
          }}
          ticker={orderDraft.ticker}
          stockName={orderDraft.name}
          ltp={orderDraft.ltp}
          defaultType={orderDraft.type}
          lotSize={orderDraft.lotSize}
          defaultQuantity={orderDraft.defaultQuantity}
          defaultVariety={orderDraft.defaultVariety}
          defaultLimitPrice={orderDraft.defaultLimitPrice}
          defaultTriggerPrice={orderDraft.defaultTriggerPrice}
        />
      )}
    </div>
  );
}
