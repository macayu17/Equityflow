"use client";

import { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { buildReplayTape, runMovingAverageReplay } from "@/lib/replay";
import { MOCK_STOCKS } from "@/lib/constants";
import { cn, formatCurrency } from "@/lib/utils";

const REPLAY_SYMBOLS = ["RELIANCE", "HDFCBANK", "TCS", "INFY", "SBIN", "ICICIBANK"];

export function ReplayLab() {
  const [ticker, setTicker] = useState("RELIANCE");
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(20);
  const base = MOCK_STOCKS.find((stock) => stock.ticker === ticker)?.ltp ?? 1000;
  const tape = useMemo(() => buildReplayTape(ticker, base, 72), [ticker, base]);
  const result = useMemo(() => runMovingAverageReplay(tape, { fast: 5, slow: 14, quantity: 10 }), [tape]);
  const visible = tape.slice(0, Math.max(1, cursor));
  const active = visible[visible.length - 1];
  const maxHigh = Math.max(...visible.map((candle) => candle.high));
  const minLow = Math.min(...visible.map((candle) => candle.low));
  const range = Math.max(1, maxHigh - minLow);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setCursor((current) => {
        if (current >= tape.length) {
          setPlaying(false);
          return tape.length;
        }
        return current + 1;
      });
    }, 450);
    return () => window.clearInterval(id);
  }, [playing, tape.length]);

  const reset = () => {
    setPlaying(false);
    setCursor(20);
  };

  return (
    <section className="terminal-panel overflow-hidden">
      <div className="terminal-panel-header">
        <div>
          <h2 className="terminal-title">Market Replay</h2>
          <div className="terminal-subtle mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em]">
            deterministic tape · MA crossover backtest
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={ticker}
            onChange={(event) => {
              setTicker(event.target.value);
              reset();
            }}
            className="terminal-input h-8 rounded-sm px-2 font-mono text-[11px]"
          >
            {REPLAY_SYMBOLS.map((symbol) => (
              <option key={symbol} value={symbol}>{symbol}</option>
            ))}
          </select>
          <button type="button" onClick={() => setPlaying((value) => !value)} className="terminal-action flex h-8 items-center gap-1.5 px-2">
            {playing ? <Pause size={13} /> : <Play size={13} />}
            {playing ? "Pause" : "Play"}
          </button>
          <button type="button" title="Reset replay" onClick={reset} className="terminal-action flex h-8 w-8 items-center justify-center px-0">
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      <div className="grid gap-3 p-3 xl:grid-cols-[1fr_320px]">
        <div className="terminal-fill rounded-sm border border-[color:var(--terminal-grid)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-mono text-[12px] font-bold text-[var(--terminal-accent)]">{ticker}</div>
            <div className="terminal-number text-[12px] text-[var(--terminal-fg)]">{active ? formatCurrency(active.close) : "-"}</div>
          </div>
          <div className="flex h-64 items-end gap-1 border-b border-l border-[color:var(--terminal-grid)] px-2 pb-2">
            {visible.map((candle) => {
              const bodyTop = ((maxHigh - Math.max(candle.open, candle.close)) / range) * 100;
              const bodyHeight = Math.max(3, (Math.abs(candle.close - candle.open) / range) * 100);
              const wickTop = ((maxHigh - candle.high) / range) * 100;
              const wickHeight = Math.max(4, ((candle.high - candle.low) / range) * 100);
              const up = candle.close >= candle.open;
              return (
                <div key={candle.index} className="relative h-full flex-1 min-w-[3px]">
                  <span
                    className="absolute left-1/2 w-px -translate-x-1/2 bg-[var(--terminal-subtle)]"
                    style={{ top: `${wickTop}%`, height: `${wickHeight}%` }}
                  />
                  <span
                    className={cn("absolute left-1/2 w-full max-w-[8px] -translate-x-1/2", up ? "bg-profit" : "bg-loss")}
                    style={{ top: `${bodyTop}%`, height: `${bodyHeight}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-[var(--terminal-subtle)]">
            <span>{cursor}/{tape.length} candles</span>
            <span>Drawdown {formatCurrency(result.maxDrawdown)}</span>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 border border-[color:var(--terminal-grid)]">
            <div className="border-b border-r border-[color:var(--terminal-grid)] p-3">
              <div className="terminal-subtle text-[10px] uppercase tracking-[0.12em]">Net P&L</div>
              <div className={cn("terminal-number mt-1 text-lg font-bold", result.netPnl >= 0 ? "text-profit" : "text-loss")}>
                {formatCurrency(result.netPnl)}
              </div>
            </div>
            <div className="border-b border-[color:var(--terminal-grid)] p-3">
              <div className="terminal-subtle text-[10px] uppercase tracking-[0.12em]">Win Rate</div>
              <div className="terminal-number mt-1 text-lg font-bold text-[var(--terminal-fg)]">{result.winRate.toFixed(1)}%</div>
            </div>
            <div className="border-r border-[color:var(--terminal-grid)] p-3">
              <div className="terminal-subtle text-[10px] uppercase tracking-[0.12em]">Trades</div>
              <div className="terminal-number mt-1 text-lg font-bold text-[var(--terminal-accent)]">{result.trades.length}</div>
            </div>
            <div className="p-3">
              <div className="terminal-subtle text-[10px] uppercase tracking-[0.12em]">Mode</div>
              <div className="terminal-number mt-1 text-lg font-bold text-[var(--terminal-fg)]">5/14</div>
            </div>
          </div>
          <div className="max-h-44 overflow-y-auto border border-[color:var(--terminal-grid)]">
            {result.trades.slice(-8).reverse().map((trade, index) => (
              <div key={`${trade.index}-${index}`} className="terminal-row grid-cols-[42px_1fr_80px] gap-2">
                <span className={cn("font-mono text-[10px] font-bold", trade.side === "BUY" ? "text-profit" : "text-loss")}>{trade.side}</span>
                <span className="terminal-subtle">Candle {trade.index}</span>
                <span className="terminal-number text-right text-[var(--terminal-fg)]">{formatCurrency(trade.price)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
