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
