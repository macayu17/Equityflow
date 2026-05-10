import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPortfolioManager } from "./engine";

const OPEN_MARKET_UTC = new Date("2026-05-11T05:00:00.000Z");

function baseOrder(overrides = {}) {
  return {
    type: "BUY" as const,
    ticker: "RELIANCE",
    stockName: "Reliance Industries Ltd",
    price: 100,
    market_ltp: 100,
    quantity: 1,
    variety: "MARKET" as const,
    product: "DELIVERY" as const,
    strategy_tag: "Manual" as const,
    ...overrides,
  };
}

describe("portfolio trading engine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(OPEN_MARKET_UTC);
    getPortfolioManager().resetAccount();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects invalid prices and quantities before mutating the account", () => {
    const manager = getPortfolioManager();
    const startingBalance = manager.getBalance();

    const badPrice = manager.placeOrder(baseOrder({ price: -50, market_ltp: -50, quantity: 2 }));
    const badQty = manager.placeOrder(baseOrder({ price: 100, market_ltp: 100, quantity: 0 }));

    expect(badPrice.success).toBe(false);
    expect(badQty.success).toBe(false);
    expect(manager.getBalance()).toBe(startingBalance);
    expect(manager.getPositions()).toHaveLength(0);
    expect(manager.getOrders()).toHaveLength(0);
  });

  it("refreshes ltp and valuation when buying into an existing position", () => {
    const manager = getPortfolioManager();

    expect(manager.placeOrder(baseOrder({ price: 100, market_ltp: 100, quantity: 10 })).success).toBe(true);
    expect(manager.placeOrder(baseOrder({ price: 120, market_ltp: 120, quantity: 5 })).success).toBe(true);

    const position = manager.getPosition("RELIANCE");
    expect(position).toMatchObject({
      quantity: 15,
      avg_price: 106.79,
      ltp: 120,
      invested: 1601.9,
      current_value: 1800,
      pnl: 198.1,
      pnl_percent: 12.37,
    });
  });

  it("selling a held stock with a different strategy tag reduces holdings and only credits once", () => {
    const manager = getPortfolioManager();

    expect(manager.placeOrder(baseOrder({ price: 100, market_ltp: 100, quantity: 10, strategy_tag: "Swing" })).success).toBe(true);
    const beforeSellBalance = manager.getBalance();

    const sell = manager.placeOrder(baseOrder({
      type: "SELL",
      price: 110,
      market_ltp: 110,
      quantity: 4,
      strategy_tag: "Manual",
    }));

    expect(sell.success).toBe(true);
    expect(manager.getPosition("RELIANCE")).toMatchObject({
      quantity: 6,
      avg_price: 100.12,
      invested: 600.72,
      current_value: 600,
    });
    expect(manager.getBalance()).toBeCloseTo(beforeSellBalance + 439.54, 2);
    expect(sell.order?.charges).toBe(0.46);
  });

  it("debits brokerage and statutory charges on executed buys", () => {
    const manager = getPortfolioManager();

    const buy = manager.placeOrder(baseOrder({ price: 100, market_ltp: 100, quantity: 10 }));

    expect(buy.success).toBe(true);
    expect(buy.order).toMatchObject({
      gross_total: 1000,
      charges: 1.19,
      net_total: 1001.19,
    });
    expect(manager.getBalance()).toBeCloseTo(100000 - 1001.19, 2);
  });

  it("records realized pnl on partial exits and keeps remaining cost basis stable", () => {
    const manager = getPortfolioManager();

    expect(manager.placeOrder(baseOrder({ price: 100, market_ltp: 100, quantity: 10 })).success).toBe(true);
    const sell = manager.placeOrder(baseOrder({
      type: "SELL",
      price: 125,
      market_ltp: 125,
      quantity: 4,
    }));

    expect(sell.success).toBe(true);
    expect(sell.order?.realized_pnl).toBe(99);
    expect(manager.getTransactions()[0]).toMatchObject({
      type: "SELL",
      ticker: "RELIANCE",
      realized_pnl: 99,
    });
    expect(manager.getPosition("RELIANCE")).toMatchObject({
      quantity: 6,
      avg_price: 100.12,
      invested: 600.72,
      current_value: 600,
    });
    expect(manager.getPortfolioSummary()).toMatchObject({
      realizedPnl: 99,
      totalPnl: -0.72,
    });
  });

  it("rejects F&O orders that are not in whole lots", () => {
    const manager = getPortfolioManager();

    const result = manager.placeOrder(baseOrder({
      ticker: "NIFTY261225300CE",
      stockName: "NIFTY 25300 CE",
      product: "INTRADAY",
      price: 100,
      market_ltp: 100,
      quantity: 66,
      lot_size: 65,
    }));

    expect(result.success).toBe(false);
    expect(result.message).toContain("multiples of lot size 65");
    expect(manager.getOrders()).toHaveLength(0);
  });

  it("returns portfolio analytics with realized wins and allocation", () => {
    const manager = getPortfolioManager();

    manager.placeOrder(baseOrder({ price: 100, market_ltp: 100, quantity: 10, ticker: "RELIANCE" }));
    manager.placeOrder(baseOrder({ price: 125, market_ltp: 125, quantity: 4, ticker: "RELIANCE", type: "SELL" }));
    manager.placeOrder(baseOrder({ price: 200, market_ltp: 200, quantity: 2, ticker: "TCS", stockName: "TCS Ltd" }));

    const analytics = manager.getPortfolioAnalytics();

    expect(analytics.realizedPnl).toBe(99);
    expect(analytics.winRate).toBe(100);
    expect(analytics.bestTrade?.ticker).toBe("RELIANCE");
    expect(analytics.allocationByAssetClass.find((item) => item.label === "Equity")?.value).toBeGreaterThan(0);
    expect(analytics.dailyPnl.length).toBeGreaterThan(0);
  });
});
