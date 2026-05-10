import { estimateTradeCharges } from "@/lib/trading-charges";
import type { OrderType, Position, ProductType, PortfolioRiskSummary } from "@/lib/types";

export type StrategyLegSide = "BUY" | "SELL";
export type StrategyLegType = "CE" | "PE" | "FUT";

export interface MarginInput {
  type: OrderType;
  ticker: string;
  product: ProductType;
  price: number;
  quantity: number;
  lotSize?: number;
}

export interface MarginEstimate {
  segment: "equity" | "fno" | "commodity";
  notional: number;
  required: number;
  charges: number;
  leverage: number;
}

export interface StrategyLeg {
  side: StrategyLegSide;
  type: StrategyLegType;
  strike: number;
  premium: number;
  lots: number;
}

export interface StrategyPayoffInput {
  spot: number;
  lotSize: number;
  legs: StrategyLeg[];
}

export interface StrategyPayoffRow {
  price: number;
  pnl: number;
}

export interface StrategyPayoff {
  rows: StrategyPayoffRow[];
  maxProfit: number | null;
  maxLoss: number | null;
  breakevens: number[];
  netPremium: number;
}

function round(value: number) {
  return Number(value.toFixed(2));
}

export function inferTradingSegment(ticker: string): "equity" | "fno" | "commodity" {
  const symbol = ticker.toUpperCase();
  if (symbol.endsWith("FUT") || ((symbol.endsWith("CE") || symbol.endsWith("PE")) && /\d/.test(symbol))) {
    return "fno";
  }
  if (/CRUDE|GOLD|SILVER|COPPER|ZINC|ALUM|NATGAS|NATURALGAS|ELECTRICITY/.test(symbol)) {
    return "commodity";
  }
  return "equity";
}

export function isOptionTicker(ticker: string) {
  const symbol = ticker.toUpperCase();
  return (symbol.endsWith("CE") || symbol.endsWith("PE")) && /\d/.test(symbol);
}

export function isFutureTicker(ticker: string) {
  return ticker.toUpperCase().endsWith("FUT");
}

export function estimateRequiredMargin(input: MarginInput): MarginEstimate {
  const segment = input.lotSize && input.lotSize > 1 ? "fno" : inferTradingSegment(input.ticker);
  const notional = Math.max(0, input.price) * Math.max(0, input.quantity);
  const charges = estimateTradeCharges({
    type: input.type,
    product: input.product,
    price: input.price,
    quantity: input.quantity,
    segment,
  }).total;

  let required = notional + charges;
  if (segment === "fno") {
    if (input.type === "BUY" && isOptionTicker(input.ticker)) {
      required = notional + charges;
    } else {
      required = notional * 0.16 + charges;
    }
  } else if (segment === "commodity") {
    required = notional * 0.12 + charges;
  } else if (input.product === "INTRADAY") {
    required = notional * 0.2 + charges;
  }

  return {
    segment,
    notional: round(notional),
    required: round(required),
    charges,
    leverage: required > 0 ? round(notional / required) : 0,
  };
}

export function estimatePositionMargin(position: Position): number {
  const margin = estimateRequiredMargin({
    type: position.quantity < 0 ? "SELL" : "BUY",
    ticker: position.ticker,
    product: position.product,
    price: position.ltp || position.avg_price,
    quantity: Math.abs(position.quantity),
    lotSize: position.lot_size,
  });
  return margin.required;
}

export function getPortfolioRisk(input: { balance: number; positions: Position[] }): PortfolioRiskSummary {
  const grossExposure = input.positions.reduce((sum, position) => sum + Math.abs(position.current_value), 0);
  const marginUsed = input.positions.reduce((sum, position) => sum + estimatePositionMargin(position), 0);
  const equity = input.balance + input.positions.reduce((sum, position) => sum + position.current_value, 0);
  const marginAvailable = Math.max(0, equity - marginUsed);
  const leverage = equity > 0 ? grossExposure / equity : 0;
  const concentration = [...input.positions]
    .sort((a, b) => Math.abs(b.current_value) - Math.abs(a.current_value))
    .slice(0, 5)
    .map((position) => ({
      label: position.ticker,
      value: round(Math.abs(position.current_value)),
      percent: grossExposure > 0 ? round((Math.abs(position.current_value) / grossExposure) * 100) : 0,
    }));

  const warnings = [];
  if (leverage > 3) warnings.push({ level: "danger" as const, message: "Leverage is above 3x. Reduce F&O or intraday exposure." });
  else if (leverage > 1.5) warnings.push({ level: "warning" as const, message: "Leverage is elevated. Watch margin usage." });
  if (marginAvailable < equity * 0.15 && equity > 0) {
    warnings.push({ level: "warning" as const, message: "Margin buffer is below 15% of account equity." });
  }
  const top = concentration[0];
  if (top && top.percent > 50) {
    warnings.push({ level: "info" as const, message: `${top.label} is ${top.percent.toFixed(1)}% of exposure.` });
  }

  const riskScore = Math.min(100, Math.max(0, Math.round(leverage * 22 + (marginUsed > 0 && equity > 0 ? (marginUsed / equity) * 45 : 0))));

  return {
    grossExposure: round(grossExposure),
    marginUsed: round(marginUsed),
    marginAvailable: round(marginAvailable),
    leverage: round(leverage),
    riskScore,
    concentration,
    warnings,
  };
}

function legPayoff(leg: StrategyLeg, price: number, lotSize: number) {
  const qty = Math.max(1, leg.lots) * lotSize;
  const intrinsic = leg.type === "FUT"
    ? price - leg.strike
    : leg.type === "CE"
      ? Math.max(0, price - leg.strike)
      : Math.max(0, leg.strike - price);
  const value = leg.type === "FUT" ? intrinsic : intrinsic - leg.premium;
  const signed = leg.side === "BUY" ? value : -value;
  return signed * qty;
}

export function calculateStrategyPayoff(input: StrategyPayoffInput): StrategyPayoff {
  const minStrike = Math.min(input.spot, ...input.legs.map((leg) => leg.strike));
  const maxStrike = Math.max(input.spot, ...input.legs.map((leg) => leg.strike));
  const premiumWidth = input.legs.reduce((sum, leg) => sum + Math.abs(leg.premium), 0) * 3;
  const width = Math.max(100, maxStrike - minStrike, premiumWidth);
  const start = Math.max(1, minStrike - width * 0.35);
  const end = maxStrike + width * 0.35;
  const step = Math.max(1, Math.round((end - start) / 24));
  const rows: StrategyPayoffRow[] = [];

  for (let price = start; price <= end; price += step) {
    rows.push({
      price: round(price),
      pnl: round(input.legs.reduce((sum, leg) => sum + legPayoff(leg, price, input.lotSize), 0)),
    });
  }

  const breakevens: number[] = [];
  for (let index = 1; index < rows.length; index++) {
    const prev = rows[index - 1];
    const curr = rows[index];
    if ((prev.pnl <= 0 && curr.pnl >= 0) || (prev.pnl >= 0 && curr.pnl <= 0)) {
      const span = curr.price - prev.price;
      const slope = curr.pnl - prev.pnl;
      const ratio = slope === 0 ? 0 : Math.abs(prev.pnl / slope);
      breakevens.push(round(prev.price + span * ratio));
    }
  }

  const pnls = rows.map((row) => row.pnl);
  const netPremium = input.legs.reduce((sum, leg) => {
    const signed = leg.side === "BUY" ? -1 : 1;
    return sum + signed * leg.premium * Math.max(1, leg.lots) * input.lotSize;
  }, 0);

  return {
    rows,
    maxProfit: round(Math.max(...pnls)),
    maxLoss: round(Math.min(...pnls)),
    breakevens: Array.from(new Set(breakevens)),
    netPremium: round(netPremium),
  };
}
