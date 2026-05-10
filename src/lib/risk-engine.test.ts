import { describe, expect, it } from "vitest";
import { calculateStrategyPayoff, estimateRequiredMargin, getPortfolioRisk } from "./risk-engine";
import type { Position } from "./types";

function position(overrides: Partial<Position> = {}): Position {
  return {
    id: "pos-1",
    ticker: "RELIANCE",
    stockName: "Reliance Industries",
    avg_price: 100,
    quantity: 10,
    invested: 1000,
    current_value: 1100,
    pnl: 100,
    pnl_percent: 10,
    day_pnl: 0,
    day_pnl_percent: 0,
    strategy_tag: "Manual",
    product: "DELIVERY",
    ltp: 110,
    ...overrides,
  };
}

describe("risk engine", () => {
  it("estimates lower upfront margin for F&O futures than full notional", () => {
    const margin = estimateRequiredMargin({
      type: "BUY",
      ticker: "NIFTY26MAYFUT",
      product: "INTRADAY",
      price: 25000,
      quantity: 65,
      lotSize: 65,
    });

    expect(margin.segment).toBe("fno");
    expect(margin.required).toBeLessThan(margin.notional);
    expect(margin.leverage).toBeGreaterThan(1);
  });

  it("computes portfolio exposure, margin and warning bands", () => {
    const risk = getPortfolioRisk({
      balance: 50_000,
      positions: [
        position(),
        position({
          id: "pos-2",
          ticker: "NIFTY25300CE",
          stockName: "NIFTY CE",
          quantity: 65,
          invested: 6500,
          current_value: 7800,
          ltp: 120,
          lot_size: 65,
          product: "INTRADAY",
        }),
      ],
    });

    expect(risk.grossExposure).toBeGreaterThan(0);
    expect(risk.marginUsed).toBeGreaterThan(0);
    expect(risk.marginAvailable).toBeGreaterThan(0);
    expect(risk.riskScore).toBeGreaterThanOrEqual(0);
  });

  it("calculates strategy payoff across price ladder", () => {
    const payoff = calculateStrategyPayoff({
      spot: 25000,
      lotSize: 50,
      legs: [
        { side: "BUY", type: "CE", strike: 25000, premium: 100, lots: 1 },
        { side: "BUY", type: "PE", strike: 25000, premium: 90, lots: 1 },
      ],
    });

    expect(payoff.rows.length).toBeGreaterThan(5);
    expect(payoff.maxLoss).toBeLessThan(0);
    expect(payoff.breakevens.length).toBeGreaterThan(0);
  });
});
