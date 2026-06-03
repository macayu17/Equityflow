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
      ltp: 110,
      current_value: 660,
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
      ltp: 125,
      current_value: 750,
      pnl: 149.28,
    });
    expect(manager.getPortfolioSummary()).toMatchObject({
      realizedPnl: 99,
      totalPnl: 149.28,
    });
  });

  it("stores per-fill realized pnl so partial exits are not counted twice", async () => {
    const manager = getPortfolioManager();

    expect(manager.placeOrder(baseOrder({ price: 100, market_ltp: 100, quantity: 10 })).success).toBe(true);
    const sell = manager.placeOrder(baseOrder({
      type: "SELL",
      price: 125,
      market_ltp: 120,
      quantity: 4,
      variety: "LIMIT",
    }));

    expect(sell.success).toBe(true);
    expect(sell.order?.status).toBe("PENDING");

    await manager.processPendingOrders(async () => ({ openPrice: 125, ltp: 125, availableQuantity: 2 }));
    await manager.processPendingOrders(async () => ({ openPrice: 125, ltp: 125, availableQuantity: 2 }));

    const finalOrder = manager.getOrders().find((order) => order.type === "SELL" && order.ticker === "RELIANCE");
    const realizedTransactions = manager.getTransactions()
      .filter((transaction) => transaction.type === "SELL" && transaction.ticker === "RELIANCE");
    const transactionRealized = realizedTransactions.reduce((sum, transaction) => sum + (transaction.realized_pnl ?? 0), 0);

    expect(realizedTransactions).toHaveLength(2);
    expect(finalOrder?.realized_pnl).toBeGreaterThan(0);
    expect(transactionRealized).toBeCloseTo(finalOrder?.realized_pnl ?? 0, 2);
    expect(manager.getPortfolioSummary().realizedPnl).toBeCloseTo(finalOrder?.realized_pnl ?? 0, 2);
  });

  it("opens an intraday short without delivery holdings and covers it with a buy", () => {
    const manager = getPortfolioManager();

    const short = manager.placeOrder(baseOrder({
      type: "SELL",
      ticker: "TCS",
      stockName: "Tata Consultancy Services Ltd",
      product: "INTRADAY",
      price: 100,
      market_ltp: 100,
      quantity: 10,
    }));

    expect(short.success).toBe(true);
    expect(short.order).toMatchObject({
      type: "SELL",
      product: "INTRADAY",
      status: "COMPLETED",
    });
    expect(manager.getPosition("TCS")).toMatchObject({
      ticker: "TCS",
      product: "INTRADAY",
      quantity: -10,
      ltp: 100,
    });

    const cover = manager.placeOrder(baseOrder({
      type: "BUY",
      ticker: "TCS",
      stockName: "Tata Consultancy Services Ltd",
      product: "INTRADAY",
      price: 95,
      market_ltp: 95,
      quantity: 10,
    }));

    expect(cover.success).toBe(true);
    expect(cover.order?.realized_pnl).toBeGreaterThan(45);
    expect(manager.getPosition("TCS")).toBeUndefined();
    expect(manager.getPortfolioSummary().realizedPnl).toBeGreaterThan(45);
  });

  it("still rejects delivery sells when there are no holdings", () => {
    const manager = getPortfolioManager();

    const result = manager.placeOrder(baseOrder({
      type: "SELL",
      ticker: "TCS",
      stockName: "Tata Consultancy Services Ltd",
      product: "DELIVERY",
      price: 100,
      market_ltp: 100,
      quantity: 10,
    }));

    expect(result.success).toBe(false);
    expect(result.message).toContain("Insufficient holdings");
    expect(manager.getPosition("TCS")).toBeUndefined();
  });

  it("uses execution price instead of margin as intraday long cost basis", () => {
    const manager = getPortfolioManager();

    const buy = manager.placeOrder(baseOrder({
      product: "INTRADAY",
      price: 100,
      market_ltp: 100,
      quantity: 10,
    }));

    expect(buy.success).toBe(true);
    expect(buy.order?.margin_required).toBeGreaterThan(0);
    expect(manager.getBalance()).toBeCloseTo(100000 - (buy.order?.margin_required ?? 0), 2);
    expect(manager.getPosition("RELIANCE")).toMatchObject({
      product: "INTRADAY",
      quantity: 10,
      ltp: 100,
      current_value: 1000,
    });
    expect(manager.getPosition("RELIANCE")?.avg_price).toBeGreaterThan(99);
    expect(manager.getPosition("RELIANCE")?.avg_price).toBeLessThan(101);
    expect(manager.getPosition("RELIANCE")?.pnl).toBeLessThanOrEqual(0);
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

  it("keeps stop-loss market orders pending until the trigger is crossed", async () => {
    const manager = getPortfolioManager();
    manager.placeOrder(baseOrder({ price: 100, market_ltp: 100, quantity: 10 }));

    const stop = manager.placeOrder(baseOrder({
      type: "SELL",
      price: 98,
      trigger_price: 96,
      market_ltp: 100,
      quantity: 5,
      variety: "SL-M",
    }));

    expect(stop.success).toBe(true);
    expect(stop.order?.status).toBe("PENDING");
    expect(stop.order?.status_note).toContain("trigger");

    const quiet = await manager.processPendingOrders(async () => ({ openPrice: 100, ltp: 97 }));
    expect(quiet.executed).toBe(0);
    expect(manager.getOrders()[0].status).toBe("PENDING");

    const triggered = await manager.processPendingOrders(async () => ({ openPrice: 95, ltp: 95 }));
    expect(triggered.executed).toBe(1);
    expect(manager.getOrders()[0]).toMatchObject({
      status: "COMPLETED",
      filled_quantity: 5,
      remaining_quantity: 0,
      executed_price: 95,
    });
  });

  it("executes triggered stop-market exits at the trigger LTP, not the session open", async () => {
    const manager = getPortfolioManager();
    manager.placeOrder(baseOrder({ price: 100, market_ltp: 100, quantity: 10 }));

    const stop = manager.placeOrder(baseOrder({
      type: "SELL",
      price: 98,
      trigger_price: 96,
      market_ltp: 100,
      quantity: 5,
      variety: "SL-M",
    }));

    expect(stop.success).toBe(true);

    const triggered = await manager.processPendingOrders(async () => ({ openPrice: 100, ltp: 95 }));

    expect(triggered.executed).toBe(1);
    expect(manager.getOrders()[0]).toMatchObject({
      status: "COMPLETED",
      executed_price: 95,
    });
  });

  it("records partial fills and leaves remaining quantity open", async () => {
    const manager = getPortfolioManager();

    const order = manager.placeOrder(baseOrder({
      price: 99,
      market_ltp: 105,
      quantity: 10,
      variety: "LIMIT",
    }));

    expect(order.success).toBe(true);
    expect(order.order?.status).toBe("PENDING");

    const firstPass = await manager.processPendingOrders(async () => ({
      openPrice: 99,
      ltp: 99,
      availableQuantity: 4,
    }));

    expect(firstPass.executed).toBe(1);
    expect(manager.getOrders()[0]).toMatchObject({
      status: "PARTIAL",
      filled_quantity: 4,
      remaining_quantity: 6,
    });
    expect(manager.getPosition("RELIANCE")?.quantity).toBe(4);
  });

  it("does not fill F&O pending orders below one whole lot", async () => {
    const manager = getPortfolioManager();

    const order = manager.placeOrder(baseOrder({
      ticker: "NIFTY261225300CE",
      stockName: "NIFTY 25300 CE",
      product: "INTRADAY",
      price: 99,
      market_ltp: 105,
      quantity: 65,
      variety: "LIMIT",
      lot_size: 65,
    }));

    expect(order.success).toBe(true);
    expect(order.order?.status).toBe("PENDING");

    const firstPass = await manager.processPendingOrders(async () => ({
      openPrice: 99,
      ltp: 99,
      availableQuantity: 1,
    }));

    expect(firstPass.executed).toBe(0);
    expect(manager.getOrders()[0]).toMatchObject({
      status: "PENDING",
      filled_quantity: 0,
      remaining_quantity: 65,
    });
    expect(manager.getPosition("NIFTY261225300CE")).toBeUndefined();
  });

  it("does not execute pending option exits on underlying-sized quote candidates", async () => {
    const manager = getPortfolioManager();

    expect(manager.placeOrder(baseOrder({
      ticker: "NIFTY25450CE",
      stockName: "NIFTY 25450 CE",
      product: "INTRADAY",
      price: 14.12,
      market_ltp: 14.12,
      quantity: 65,
      lot_size: 65,
    })).success).toBe(true);

    const exit = manager.placeOrder(baseOrder({
      type: "SELL",
      ticker: "NIFTY25450CE",
      stockName: "NIFTY 25450 CE",
      product: "INTRADAY",
      price: 15,
      market_ltp: 14.12,
      quantity: 65,
      variety: "LIMIT",
      lot_size: 65,
    }));

    expect(exit.success).toBe(true);
    expect(exit.order?.status).toBe("PENDING");

    const result = await manager.processPendingOrders(async () => ({
      openPrice: 25471.1,
      ltp: 25471.1,
      availableQuantity: 65,
    }));

    expect(result.executed).toBe(0);
    expect(manager.getPosition("NIFTY25450CE")).toMatchObject({
      quantity: 65,
      ltp: 14.12,
    });
    expect(manager.getPortfolioSummary().realizedPnl).toBe(0);
  });

  it("keeps executed totals intact when modifying a partially filled order", async () => {
    const manager = getPortfolioManager();

    const order = manager.placeOrder(baseOrder({
      price: 99,
      market_ltp: 105,
      quantity: 10,
      variety: "LIMIT",
    }));

    expect(order.success).toBe(true);
    await manager.processPendingOrders(async () => ({ openPrice: 99, ltp: 99, availableQuantity: 4 }));

    const modified = manager.modifyOrder(order.order!.id, { price: 98 });
    expect(modified.success).toBe(true);

    await manager.processPendingOrders(async () => ({ openPrice: 98, ltp: 98, availableQuantity: 6 }));

    const finalOrder = manager.getOrders()[0];
    const transactions = manager.getTransactions().filter((transaction) => transaction.type === "BUY" && transaction.ticker === "RELIANCE");
    const transactionCharges = transactions.reduce((sum, transaction) => sum + (transaction.charges ?? 0), 0);
    const transactionGross = transactions.reduce((sum, transaction) => sum + (transaction.gross_total ?? 0), 0);
    const transactionNet = transactions.reduce((sum, transaction) => sum + (transaction.net_total ?? 0), 0);

    expect(finalOrder.status).toBe("COMPLETED");
    expect(transactions).toHaveLength(2);
    expect(finalOrder.charges).toBeCloseTo(transactionCharges, 2);
    expect(finalOrder.gross_total).toBeCloseTo(transactionGross, 2);
    expect(finalOrder.net_total).toBeCloseTo(transactionNet, 2);
  });

  it("refunds reserved margin when cancelling queued opening sell orders", () => {
    const manager = getPortfolioManager();
    const startingBalance = manager.getBalance();

    const order = manager.placeOrder(baseOrder({
      type: "SELL",
      ticker: "TCS",
      stockName: "Tata Consultancy Services Ltd",
      product: "INTRADAY",
      price: 110,
      market_ltp: 100,
      quantity: 10,
      variety: "LIMIT",
    }));

    expect(order.success).toBe(true);
    expect(order.order?.status).toBe("PENDING");
    expect(manager.getBalance()).toBeLessThan(startingBalance);

    const cancelled = manager.cancelOrder(order.order!.id);

    expect(cancelled.success).toBe(true);
    expect(manager.getBalance()).toBeCloseTo(startingBalance, 2);
    expect(cancelled.order?.reserved_amount).toBe(0);
  });

  it("exposes margin and risk metrics for F&O orders and portfolio", () => {
    const manager = getPortfolioManager();

    const result = manager.placeOrder(baseOrder({
      ticker: "NIFTY261225300CE",
      stockName: "NIFTY 25300 CE",
      product: "INTRADAY",
      price: 100,
      market_ltp: 100,
      quantity: 65,
      lot_size: 65,
    }));

    expect(result.success).toBe(true);
    expect(result.order?.margin_required).toBeGreaterThan(0);

    const risk = manager.getRiskSummary();
    expect(risk.marginUsed).toBeGreaterThan(0);
    expect(risk.marginAvailable).toBeGreaterThan(0);
    expect(risk.warnings.length).toBeGreaterThanOrEqual(0);
  });
});
