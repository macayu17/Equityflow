"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { FNO_UNDERLYINGS } from "@/lib/constants";
import { calculateStrategyPayoff, type StrategyLeg } from "@/lib/risk-engine";
import { cn, formatCurrency } from "@/lib/utils";

const PRESETS: Record<string, (spot: number) => StrategyLeg[]> = {
  "Long Straddle": (spot) => [
    { side: "BUY", type: "CE", strike: Math.round(spot / 100) * 100, premium: 120, lots: 1 },
    { side: "BUY", type: "PE", strike: Math.round(spot / 100) * 100, premium: 110, lots: 1 },
  ],
  "Short Strangle": (spot) => [
    { side: "SELL", type: "CE", strike: Math.round((spot * 1.02) / 100) * 100, premium: 75, lots: 1 },
    { side: "SELL", type: "PE", strike: Math.round((spot * 0.98) / 100) * 100, premium: 70, lots: 1 },
  ],
  "Bull Call Spread": (spot) => [
    { side: "BUY", type: "CE", strike: Math.round(spot / 100) * 100, premium: 120, lots: 1 },
    { side: "SELL", type: "CE", strike: Math.round((spot * 1.02) / 100) * 100, premium: 55, lots: 1 },
  ],
  "Iron Condor": (spot) => [
    { side: "SELL", type: "CE", strike: Math.round((spot * 1.02) / 100) * 100, premium: 70, lots: 1 },
    { side: "BUY", type: "CE", strike: Math.round((spot * 1.04) / 100) * 100, premium: 25, lots: 1 },
    { side: "SELL", type: "PE", strike: Math.round((spot * 0.98) / 100) * 100, premium: 65, lots: 1 },
    { side: "BUY", type: "PE", strike: Math.round((spot * 0.96) / 100) * 100, premium: 22, lots: 1 },
  ],
};

export function StrategyBuilder() {
  const [underlying, setUnderlying] = useState("NIFTY");
  const meta = FNO_UNDERLYINGS.find((item) => item.ticker === underlying) ?? FNO_UNDERLYINGS[0];
  const [legs, setLegs] = useState<StrategyLeg[]>(() => PRESETS["Long Straddle"](meta.ltp));
  const payoff = useMemo(() => calculateStrategyPayoff({ spot: meta.ltp, lotSize: meta.lotSize, legs }), [legs, meta.lotSize, meta.ltp]);
  const maxAbs = Math.max(1, ...payoff.rows.map((row) => Math.abs(row.pnl)));

  const updateLeg = (index: number, patch: Partial<StrategyLeg>) => {
    setLegs((current) => current.map((leg, i) => i === index ? { ...leg, ...patch } : leg));
  };

  const loadPreset = (name: string) => {
    setLegs(PRESETS[name](meta.ltp));
  };

  return (
    <section className="terminal-panel overflow-hidden">
      <div className="terminal-panel-header">
        <div>
          <h2 className="terminal-title">Strategy Builder</h2>
          <div className="terminal-subtle mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em]">Options payoff and breakeven desk</div>
        </div>
        <select
          value={underlying}
          onChange={(event) => {
            const next = event.target.value;
            setUnderlying(next);
            const nextMeta = FNO_UNDERLYINGS.find((item) => item.ticker === next) ?? FNO_UNDERLYINGS[0];
            setLegs(PRESETS["Long Straddle"](nextMeta.ltp));
          }}
          className="terminal-input h-8 rounded-sm px-2 font-mono text-[11px]"
        >
          {FNO_UNDERLYINGS.map((item) => (
            <option key={item.ticker} value={item.ticker}>{item.ticker}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 p-3 xl:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {Object.keys(PRESETS).map((preset) => (
              <button key={preset} type="button" onClick={() => loadPreset(preset)} className="terminal-action h-8 px-2 text-[10px]">
                {preset}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setLegs((current) => [...current, { side: "BUY", type: "CE", strike: Math.round(meta.ltp / 100) * 100, premium: 50, lots: 1 }])}
              className="terminal-action flex h-8 items-center gap-1.5 px-2 text-[10px]"
            >
              <Plus size={12} />
              Leg
            </button>
          </div>

          <div className="overflow-x-auto border border-[color:var(--terminal-grid)]">
            <div className="terminal-table-head grid min-w-[640px] grid-cols-[90px_80px_1fr_1fr_80px_42px] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-[0.1em]">
              <span>Side</span><span>Type</span><span>Strike</span><span>Premium</span><span>Lots</span><span />
            </div>
            {legs.map((leg, index) => (
              <div key={index} className="terminal-row min-w-[640px] grid-cols-[90px_80px_1fr_1fr_80px_42px] gap-2">
                <select value={leg.side} onChange={(event) => updateLeg(index, { side: event.target.value as StrategyLeg["side"] })} className="terminal-input h-7 rounded-sm px-2 text-[11px]">
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
                <select value={leg.type} onChange={(event) => updateLeg(index, { type: event.target.value as StrategyLeg["type"] })} className="terminal-input h-7 rounded-sm px-2 text-[11px]">
                  <option value="CE">CE</option>
                  <option value="PE">PE</option>
                  <option value="FUT">FUT</option>
                </select>
                <input value={leg.strike} type="number" step={50} onChange={(event) => updateLeg(index, { strike: Number(event.target.value) || 0 })} className="terminal-input h-7 rounded-sm px-2 text-right text-[11px]" />
                <input value={leg.premium} type="number" step={1} onChange={(event) => updateLeg(index, { premium: Number(event.target.value) || 0 })} className="terminal-input h-7 rounded-sm px-2 text-right text-[11px]" />
                <input value={leg.lots} type="number" min={1} step={1} onChange={(event) => updateLeg(index, { lots: Math.max(1, Number(event.target.value) || 1) })} className="terminal-input h-7 rounded-sm px-2 text-right text-[11px]" />
                <button type="button" onClick={() => setLegs((current) => current.length <= 1 ? current : current.filter((_, i) => i !== index))} className="terminal-action flex h-7 w-7 items-center justify-center px-0">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 border border-[color:var(--terminal-grid)]">
            <div className="border-b border-r border-[color:var(--terminal-grid)] p-3">
              <div className="terminal-subtle text-[10px] uppercase tracking-[0.12em]">Spot</div>
              <div className="terminal-number mt-1 font-bold text-[var(--terminal-fg)]">{formatCurrency(meta.ltp)}</div>
            </div>
            <div className="border-b border-[color:var(--terminal-grid)] p-3">
              <div className="terminal-subtle text-[10px] uppercase tracking-[0.12em]">Lot</div>
              <div className="terminal-number mt-1 font-bold text-[var(--terminal-accent)]">{meta.lotSize}</div>
            </div>
            <div className="border-r border-[color:var(--terminal-grid)] p-3">
              <div className="terminal-subtle text-[10px] uppercase tracking-[0.12em]">Max Profit</div>
              <div className="terminal-number mt-1 font-bold text-profit">{formatCurrency(payoff.maxProfit ?? 0)}</div>
            </div>
            <div className="p-3">
              <div className="terminal-subtle text-[10px] uppercase tracking-[0.12em]">Max Loss</div>
              <div className="terminal-number mt-1 font-bold text-loss">{formatCurrency(payoff.maxLoss ?? 0)}</div>
            </div>
          </div>

          <div className="border border-[color:var(--terminal-grid)] p-3">
            <div className="terminal-subtle mb-2 text-[10px] uppercase tracking-[0.12em]">Payoff Ladder</div>
            <div className="space-y-1">
              {payoff.rows.filter((_, index) => index % 3 === 0).slice(0, 9).map((row) => (
                <div key={row.price} className="grid grid-cols-[76px_1fr_88px] items-center gap-2">
                  <span className="terminal-number text-[10px] text-[var(--terminal-subtle)]">{row.price.toFixed(0)}</span>
                  <span className="relative h-2 rounded-sm bg-[var(--terminal-fill)]">
                    <span
                      className={cn("absolute top-0 h-2 rounded-sm", row.pnl >= 0 ? "left-1/2 bg-profit" : "right-1/2 bg-loss")}
                      style={{ width: `${Math.min(50, (Math.abs(row.pnl) / maxAbs) * 50)}%` }}
                    />
                  </span>
                  <span className={cn("terminal-number text-right text-[10px]", row.pnl >= 0 ? "text-profit" : "text-loss")}>{formatCurrency(row.pnl)}</span>
                </div>
              ))}
            </div>
            <div className="terminal-subtle mt-3 text-[10px]">Breakevens: {payoff.breakevens.length ? payoff.breakevens.map((value) => value.toFixed(0)).join(", ") : "none in range"}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
