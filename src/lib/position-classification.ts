import type { Position } from "@/lib/types";
import { getFnoContractKind } from "@/lib/fno-pricing";

export function isFnoContractTicker(ticker: string): boolean {
  return getFnoContractKind(ticker) !== null;
}

export function isFnoPosition(position: Pick<Position, "ticker" | "stockName">): boolean {
  return isFnoContractTicker(position.ticker) || isFnoContractTicker(position.stockName || "");
}

export function isActiveTradingPosition(position: Pick<Position, "ticker" | "stockName" | "product">): boolean {
  return position.product === "INTRADAY" || isFnoPosition(position);
}

export function isDeliveryHoldingPosition(position: Pick<Position, "ticker" | "stockName" | "product">): boolean {
  return !isActiveTradingPosition(position);
}

export type TickerPositionSummary = Pick<Position, "avg_price" | "quantity" | "invested" | "current_value" | "pnl" | "pnl_percent"> & {
  count: number;
  strategy_tag: Position["strategy_tag"] | "Mixed";
};

export function getTickerPositionSummary(positions: Position[], ticker: string): TickerPositionSummary | null {
  const matches = positions.filter((position) => position.ticker.toUpperCase() === ticker.toUpperCase());
  if (matches.length === 0) return null;

  const quantity = matches.reduce((sum, position) => sum + position.quantity, 0);
  const invested = matches.reduce((sum, position) => sum + Math.abs(position.invested), 0);
  const currentValue = matches.reduce((sum, position) => sum + Math.abs(position.current_value), 0);
  const pnl = matches.reduce((sum, position) => sum + position.pnl, 0);
  const strategyTag = matches.every((position) => position.strategy_tag === matches[0].strategy_tag)
    ? matches[0].strategy_tag
    : "Mixed";

  return {
    count: matches.length,
    strategy_tag: strategyTag,
    quantity,
    invested: Number(invested.toFixed(2)),
    current_value: Number(currentValue.toFixed(2)),
    pnl: Number(pnl.toFixed(2)),
    avg_price: Math.abs(quantity) > 0 ? Number((invested / Math.abs(quantity)).toFixed(2)) : 0,
    pnl_percent: invested > 0 ? Number(((pnl / invested) * 100).toFixed(2)) : 0,
  };
}
