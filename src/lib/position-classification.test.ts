import { describe, expect, it } from "vitest";
import {
  getTickerPositionSummary,
  isActiveTradingPosition,
  isDeliveryHoldingPosition,
  isFnoPosition,
} from "./position-classification";
import type { Position } from "./types";

function position(overrides = {}) {
  return {
    ticker: "HDFCBANK",
    stockName: "HDFC Bank Ltd",
    product: "DELIVERY" as const,
    ...overrides,
  };
}

function fullPosition(overrides: Partial<Position> = {}): Position {
  return {
    id: "pos",
    ticker: "TCS",
    stockName: "Tata Consultancy Services Ltd",
    avg_price: 100,
    quantity: 1,
    invested: 100,
    current_value: 110,
    pnl: 10,
    pnl_percent: 10,
    day_pnl: 0,
    day_pnl_percent: 0,
    strategy_tag: "Manual",
    product: "DELIVERY",
    ltp: 110,
    ...overrides,
  };
}

describe("position classification", () => {
  it("treats delivery equity as a holding", () => {
    const hdfc = position();

    expect(isFnoPosition(hdfc)).toBe(false);
    expect(isActiveTradingPosition(hdfc)).toBe(false);
    expect(isDeliveryHoldingPosition(hdfc)).toBe(true);
  });

  it("keeps option contracts out of holdings even when product says intraday", () => {
    const option = position({
      ticker: "NIFTY25450CE",
      stockName: "NIFTY 25450 CE",
      product: "INTRADAY" as const,
    });

    expect(isFnoPosition(option)).toBe(true);
    expect(isActiveTradingPosition(option)).toBe(true);
    expect(isDeliveryHoldingPosition(option)).toBe(false);
  });

  it("keeps non-F&O intraday equity out of holdings", () => {
    const intraday = position({
      ticker: "TCS",
      stockName: "Tata Consultancy Services Ltd",
      product: "INTRADAY" as const,
    });

    expect(isFnoPosition(intraday)).toBe(false);
    expect(isActiveTradingPosition(intraday)).toBe(true);
    expect(isDeliveryHoldingPosition(intraday)).toBe(false);
  });

  it("summarizes multiple same-ticker positions for detail pages", () => {
    const summary = getTickerPositionSummary([
      fullPosition({ id: "delivery", quantity: 2, invested: 200, current_value: 220, pnl: 20 }),
      fullPosition({ id: "intraday", product: "INTRADAY", quantity: 3, invested: 300, current_value: 270, pnl: -30 }),
      fullPosition({ id: "other", ticker: "INFY", quantity: 9 }),
    ], "tcs");

    expect(summary).toMatchObject({
      count: 2,
      quantity: 5,
      invested: 500,
      current_value: 490,
      pnl: -10,
      avg_price: 100,
      pnl_percent: -2,
      strategy_tag: "Manual",
    });
  });
});
