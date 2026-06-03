/**
 * EquityFlow Simulation Engine
 * Virtual Portfolio Manager — handles paper buy/sell orders
 * against real-time (or mock) price data.
 */

import { generateId } from "@/lib/utils";
import {
  type Order,
  type OrderRequest,
  type Position,
  type Transaction,
  type User,
  type PortfolioSummary,
  type PortfolioAnalytics,
  type PortfolioRiskSummary,
  type StrategyPerformance,
  type StrategyTag,
  STRATEGY_TAGS,
} from "@/lib/types";
import { API_CONFIG, MOCK_COMMODITIES } from "@/lib/constants";
import { getMarketStatus, type MarketSegment } from "@/lib/market-hours";
import { estimateTradeCharges } from "@/lib/trading-charges";
import { estimateRequiredMargin, getPortfolioRisk } from "@/lib/risk-engine";
import { getSafeFnoLtp } from "@/lib/fno-pricing";

// ─── In-Memory Database ─────────────────────────────────────
interface Database {
  user: User;
  positions: Position[];
  transactions: Transaction[];
  orders: Order[];
}

const STORAGE_KEY = "equityflow_db";

function getDefaultUser(): User {
  return {
    id: generateId(),
    name: "Paper Trader",
    email: "trader@equityflow.dev",
    virtual_balance: API_CONFIG.defaultBalance,
    created_at: new Date(),
  };
}

function loadDb(): Database {
  if (typeof window === "undefined") {
    return { user: getDefaultUser(), positions: [], transactions: [], orders: [] };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.user.created_at = new Date(parsed.user.created_at);
      parsed.transactions = parsed.transactions.map((t: Transaction) => ({
        ...t,
        timestamp: new Date(t.timestamp),
      }));
      parsed.positions = Array.isArray(parsed.positions)
        ? parsed.positions.map((p: Position) => sanitizeLoadedPosition(p))
        : [];
      parsed.orders = parsed.orders.map((o: Order) => ({
        ...o,
        timestamp: new Date(o.timestamp),
        queued_at: o.queued_at ? new Date(o.queued_at) : undefined,
        executed_at: o.executed_at ? new Date(o.executed_at) : undefined,
      }));
      return parsed;
    }
  } catch {
    // corrupted data, reset
  }
  return { user: getDefaultUser(), positions: [], transactions: [], orders: [] };
}

function saveDb(db: Database): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function roundLoadedMoney(value: number): number {
  return parseFloat(value.toFixed(2));
}

function sanitizeLoadedPosition(position: Position): Position {
  const safeLtp = getSafeFnoLtp({
    ticker: position.ticker,
    stockName: position.stockName,
    avgPrice: position.avg_price,
    currentLtp: position.ltp,
    candidateLtp: position.ltp,
  });

  if (safeLtp === position.ltp) {
    return position;
  }

  const quantity = Number(position.quantity) || 0;
  const invested = roundLoadedMoney(position.avg_price * quantity);
  const currentValue = roundLoadedMoney(safeLtp * quantity);
  const pnl = roundLoadedMoney((safeLtp - position.avg_price) * quantity);
  const exposure = Math.abs(invested);

  return {
    ...position,
    ltp: safeLtp,
    invested,
    current_value: currentValue,
    pnl,
    pnl_percent: exposure > 0 ? roundLoadedMoney((pnl / exposure) * 100) : 0,
  };
}

// ─── Singleton Database Instance ─────────────────────────────
let db: Database | null = null;

function getDb(): Database {
  if (!db) db = loadDb();
  return db;
}

// ─── Virtual Portfolio Manager Interface ─────────────────────
export interface VirtualPortfolioManager {
  // Account
  getUser(): User;
  getBalance(): number;
  setBalance(amount: number): void;
  resetAccount(): void;

  // Orders
  placeOrder(req: OrderRequest): { success: boolean; message: string; order?: Order };
  getOrders(): Order[];
  cancelOrder(orderId: string): { success: boolean; message: string; order?: Order };
  modifyOrder(
    orderId: string,
    updates: { price?: number; quantity?: number }
  ): { success: boolean; message: string; order?: Order };
  processPendingOrders(
    resolvePrice: (ticker: string, segment: MarketSegment) => Promise<{ openPrice: number; ltp: number; availableQuantity?: number } | null>
  ): Promise<{ executed: number; rejected: number }>;

  // Positions
  getPositions(): Position[];
  getPosition(ticker: string): Position | undefined;
  removeHolding(positionId: string): { success: boolean; message: string };
  updatePositionLTP(ticker: string, ltp: number): boolean;
  getPortfolioSummary(): PortfolioSummary;
  getPortfolioAnalytics(): PortfolioAnalytics;
  getRiskSummary(): PortfolioRiskSummary;

  // Transactions
  getTransactions(): Transaction[];

  // Strategy Analytics
  getStrategyPerformance(): StrategyPerformance[];
}

// ─── Implementation ──────────────────────────────────────────
export function createPortfolioManager(): VirtualPortfolioManager {
  const database = getDb();
  const commodityTickers = new Set(MOCK_COMMODITIES.map((c) => c.ticker));
  let processingPending = false;

  function persist() {
    saveDb(database);
  }

  function roundMoney(value: number): number {
    return parseFloat(value.toFixed(2));
  }

  function getOrderSegment(ticker: string, lotSize?: number): MarketSegment {
    if (lotSize && lotSize > 1) return "fno";
    if (commodityTickers.has(ticker)) return "commodity";

    const symbol = ticker.toUpperCase();
    const isFutureContract = symbol.endsWith("FUT");
    const isOptionContract = (symbol.endsWith("CE") || symbol.endsWith("PE")) && /\d/.test(symbol);

    if (isFutureContract || isOptionContract) return "fno";
    return "equity";
  }

  function getAssetClassLabel(ticker: string): string {
    const segment = getOrderSegment(ticker);
    if (segment === "fno") return "F&O";
    if (segment === "commodity") return "Commodity";
    return "Equity";
  }

  function getPendingSellLockedQty(ticker: string, product: string): number {
    return database.orders
      .filter((o) => (o.status === "PENDING" || o.status === "PARTIAL") && o.type === "SELL" && o.ticker === ticker && o.product === product)
      .reduce((sum, o) => sum + (o.remaining_quantity ?? o.quantity), 0);
  }

  function getPendingStatusNote(order: Pick<Order, "type" | "variety" | "price">, marketOpen: boolean): string {
    if (!marketOpen) {
      return order.variety === "LIMIT"
        ? `Queued: waiting for market open and ${order.type === "BUY" ? "price <=" : "price >="} ₹${order.price.toFixed(2)}`
        : "Queued: waiting for market open";
    }

    if (order.variety === "LIMIT") {
      return `Limit pending: waiting for ${order.type === "BUY" ? "price <=" : "price >="} ₹${order.price.toFixed(2)}`;
    }

    return "Queued: waiting for next processing cycle";
  }

  function isLimitTriggered(type: "BUY" | "SELL", limitPrice: number, marketPrice: number): boolean {
    if (type === "BUY") return marketPrice <= limitPrice;
    return marketPrice >= limitPrice;
  }

  function isStopTriggered(type: "BUY" | "SELL", triggerPrice: number | undefined, marketPrice: number): boolean {
    if (!triggerPrice || triggerPrice <= 0) return false;
    if (type === "BUY") return marketPrice >= triggerPrice;
    return marketPrice <= triggerPrice;
  }

  function isOrderTriggered(order: Pick<Order, "type" | "variety" | "price" | "trigger_price">, marketPrice: number): boolean {
    if (order.variety === "MARKET") return true;
    if (order.variety === "LIMIT") return isLimitTriggered(order.type, order.price, marketPrice);
    if (order.variety === "SL-M") return isStopTriggered(order.type, order.trigger_price, marketPrice);
    if (order.variety === "SL") {
      return isStopTriggered(order.type, order.trigger_price, marketPrice)
        && isLimitTriggered(order.type, order.price, marketPrice);
    }
    return false;
  }

  function getTriggerStatusNote(order: Pick<Order, "type" | "variety" | "price" | "trigger_price">, marketOpen: boolean): string {
    if (!marketOpen) {
      return getPendingStatusNote(order, false);
    }
    if (order.variety === "SL" || order.variety === "SL-M") {
      return `Stop pending: waiting for ${order.type === "BUY" ? "price >=" : "price <="} ₹${(order.trigger_price ?? 0).toFixed(2)} trigger`;
    }
    return getPendingStatusNote(order, true);
  }

  function getExecutionDebit(order: Order, executedPrice: number, quantity: number): number {
    const margin = estimateRequiredMargin({
      type: order.type,
      ticker: order.ticker,
      product: order.product,
      price: executedPrice,
      quantity,
      lotSize: order.lot_size,
    });
    return margin.required;
  }

  function isMarginProduct(product: string, segment: MarketSegment): boolean {
    return product === "INTRADAY" || segment === "fno" || segment === "commodity";
  }

  function getNetPositionQty(ticker: string, product: string): number {
    return database.positions
      .filter((position) => position.ticker === ticker && position.product === product)
      .reduce((sum, position) => sum + position.quantity, 0);
  }

  function getLongHeldQty(ticker: string, product: string): number {
    return database.positions
      .filter((position) => position.ticker === ticker && position.product === product && position.quantity > 0)
      .reduce((sum, position) => sum + position.quantity, 0);
  }

  function getOpeningQuantity(currentQty: number, type: "BUY" | "SELL", orderQty: number): number {
    const signedDelta = type === "BUY" ? orderQty : -orderQty;
    if (currentQty === 0 || Math.sign(currentQty) === Math.sign(signedDelta)) {
      return Math.abs(signedDelta);
    }
    return Math.max(0, Math.abs(signedDelta) - Math.abs(currentQty));
  }

  function getOpeningQuantityForOrder(order: Pick<Order, "type" | "ticker" | "product"> & { quantity: number }): number {
    return getOpeningQuantity(getNetPositionQty(order.ticker, order.product), order.type, order.quantity);
  }

  function getOpeningMargin(order: Pick<Order, "type" | "ticker" | "product" | "lot_size">, price: number, quantity: number): number {
    if (quantity <= 0) return 0;
    return estimateRequiredMargin({
      type: order.type,
      ticker: order.ticker,
      product: order.product,
      price,
      quantity,
      lotSize: order.lot_size,
    }).required;
  }

  function getEntryAveragePrice(type: "BUY" | "SELL", price: number, quantity: number, charges: number): number {
    if (quantity <= 0) return price;
    const gross = price * quantity;
    const netBasis = type === "BUY" ? gross + charges : gross - charges;
    return roundMoney(netBasis / quantity);
  }

  function getPositionMargin(position: Position): number {
    if (typeof position.margin_required === "number" && Number.isFinite(position.margin_required)) {
      return position.margin_required;
    }
    const segment = getOrderSegment(position.ticker, position.lot_size);
    if (!isMarginProduct(position.product, segment) || position.quantity === 0) return 0;
    return estimateRequiredMargin({
      type: position.quantity < 0 ? "SELL" : "BUY",
      ticker: position.ticker,
      product: position.product,
      price: position.ltp || position.avg_price,
      quantity: Math.abs(position.quantity),
      lotSize: position.lot_size,
    }).required;
  }

  function refreshSignedPosition(position: Position, ltp = position.ltp) {
    position.ltp = roundMoney(ltp);
    position.invested = roundMoney(position.avg_price * position.quantity);
    position.current_value = roundMoney(position.ltp * position.quantity);
    position.pnl = roundMoney((position.ltp - position.avg_price) * position.quantity);
    const exposure = Math.abs(position.invested);
    position.pnl_percent = exposure > 0 ? roundMoney((position.pnl / exposure) * 100) : 0;
  }

  function validateOrder(req: OrderRequest, includeBuffer = true): { ok: true } | { ok: false; message: string } {
    if (!Number.isFinite(req.price) || req.price <= 0) {
      return { ok: false, message: "Invalid order price." };
    }
    if (!Number.isInteger(req.quantity) || req.quantity <= 0) {
      return { ok: false, message: "Quantity must be a whole number greater than 0." };
    }

    const segment = getOrderSegment(req.ticker, req.lot_size);
    const charges = estimateTradeCharges({
      type: req.type,
      product: req.product,
      price: req.price,
      quantity: req.quantity,
      segment,
    });
    const marginProduct = isMarginProduct(req.product, segment);
    const openingQty = marginProduct ? getOpeningQuantityForOrder(req) : req.type === "BUY" ? req.quantity : 0;
    const openingMargin = marginProduct ? getOpeningMargin(req, req.price, openingQty) : 0;
    const requiredDebit = marginProduct ? openingMargin : charges.netAmount;
    const buffer = includeBuffer && req.type === "BUY" && requiredDebit > 0 ? requiredDebit * API_CONFIG.orderBuffer : 0;

    if ((req.variety === "SL" || req.variety === "SL-M") && (!req.trigger_price || req.trigger_price <= 0)) {
      return { ok: false, message: "Stop-loss orders require a valid trigger price." };
    }

    if (req.market_ltp && req.market_ltp > 0 && Math.abs(req.price - req.market_ltp) / req.market_ltp > 0.2) {
      return { ok: false, message: "Order price is outside the 20% paper circuit band." };
    }

    if (segment === "fno") {
      const lotSize = req.lot_size ?? 0;
      if (lotSize <= 1) {
        return {
          ok: false,
          message: "Invalid lot size for F&O contract.",
        };
      }
      if (req.quantity % lotSize !== 0) {
        return {
          ok: false,
          message: `F&O orders must be in multiples of lot size ${lotSize}.`,
        };
      }
    }

    if (req.type === "BUY") {
      if (!marginProduct && database.user.virtual_balance < requiredDebit + buffer) {
        return {
          ok: false,
          message: `Insufficient virtual funds. Required: ₹${(requiredDebit + buffer).toFixed(2)}, Available: ₹${database.user.virtual_balance.toFixed(2)}`,
        };
      }
      if (marginProduct && openingQty > 0 && database.user.virtual_balance < openingMargin + buffer) {
        return {
          ok: false,
          message: `Insufficient margin. Required: ₹${(openingMargin + buffer).toFixed(2)}, Available: ₹${database.user.virtual_balance.toFixed(2)}`,
        };
      }
    }

    if (req.type === "SELL") {
      if (marginProduct) {
        if (openingQty > 0 && database.user.virtual_balance < openingMargin) {
          return {
            ok: false,
            message: `Insufficient margin. Required: ₹${openingMargin.toFixed(2)}, Available: ₹${database.user.virtual_balance.toFixed(2)}`,
          };
        }
      } else {
        const lockedQty = getPendingSellLockedQty(req.ticker, req.product);
        const availableQty = getLongHeldQty(req.ticker, req.product) - lockedQty;
        if (availableQty < req.quantity) {
          return {
            ok: false,
            message: `Insufficient holdings. Available: ${Math.max(availableQty, 0)} shares of ${req.ticker}`,
          };
        }
      }
    }

    return { ok: true };
  }

  function reduceSellPositions(order: Order, executedPrice: number, sellCharges = 0): { ok: boolean; realizedPnl: number } {
    let remaining = order.quantity;
    let realizedPnl = 0;
    const candidates = database.positions
      .map((position, index) => ({ position, index }))
      .filter(({ position }) => position.ticker === order.ticker && position.product === order.product && position.quantity > 0)
      .sort((a, b) => {
        const aSameStrategy = a.position.strategy_tag === order.strategy_tag ? 0 : 1;
        const bSameStrategy = b.position.strategy_tag === order.strategy_tag ? 0 : 1;
        return aSameStrategy - bSameStrategy || a.index - b.index;
      });

    const totalAvailable = candidates.reduce((sum, { position }) => sum + position.quantity, 0);
    if (totalAvailable < order.quantity) return { ok: false, realizedPnl: 0 };

    for (const { position } of candidates) {
      if (remaining <= 0) break;

      const exitQty = Math.min(position.quantity, remaining);
      const nextQty = position.quantity - exitQty;
      const chargeShare = order.quantity > 0 ? sellCharges * (exitQty / order.quantity) : 0;
      realizedPnl += ((executedPrice - position.avg_price) * exitQty) - chargeShare;
      remaining -= exitQty;

      if (nextQty <= 0) {
        position.quantity = 0;
        continue;
      }

      position.quantity = nextQty;
      position.invested = roundMoney(position.avg_price * nextQty);
      position.current_value = roundMoney(position.ltp * nextQty);
      position.pnl = roundMoney(position.current_value - position.invested);
      position.pnl_percent = position.invested > 0
        ? roundMoney((position.pnl / position.invested) * 100)
        : 0;
    }

    database.positions = database.positions.filter((position) => position.quantity > 0);
    return { ok: remaining === 0, realizedPnl: roundMoney(realizedPnl) };
  }

  function addMarginPosition(order: Order, executedPrice: number, quantity: number, entryCharges: number, marginRequired: number) {
    if (quantity <= 0) return;
    const signedQty = order.type === "BUY" ? quantity : -quantity;
    const direction = Math.sign(signedQty);
    const avgPrice = getEntryAveragePrice(order.type, executedPrice, quantity, entryCharges);
    const existingIdx = database.positions.findIndex(
      (position) =>
        position.ticker === order.ticker &&
        position.strategy_tag === order.strategy_tag &&
        position.product === order.product &&
        Math.sign(position.quantity) === direction
    );

    if (existingIdx >= 0) {
      const existing = database.positions[existingIdx];
      const existingQty = Math.abs(existing.quantity);
      const nextQty = existingQty + quantity;
      existing.avg_price = roundMoney(((existing.avg_price * existingQty) + (avgPrice * quantity)) / nextQty);
      existing.quantity = roundMoney(existing.quantity + signedQty);
      existing.margin_required = roundMoney(getPositionMargin(existing) + marginRequired);
      existing.lot_size = order.lot_size;
      refreshSignedPosition(existing, executedPrice);
      return;
    }

    const position: Position = {
      id: generateId(),
      ticker: order.ticker,
      stockName: order.stockName,
      avg_price: avgPrice,
      quantity: signedQty,
      invested: 0,
      current_value: 0,
      pnl: 0,
      pnl_percent: 0,
      day_pnl: 0,
      day_pnl_percent: 0,
      strategy_tag: order.strategy_tag,
      product: order.product,
      ltp: roundMoney(executedPrice),
      lot_size: order.lot_size,
      margin_required: roundMoney(marginRequired),
    };
    refreshSignedPosition(position, executedPrice);
    database.positions.push(position);
  }

  function applyMarginExecution(
    order: Order,
    executedPrice: number,
    executedQuantity: number,
    remainingBefore: number,
    charges: ReturnType<typeof estimateTradeCharges>
  ): { ok: boolean; realizedPnl: number } {
    const closingSign = order.type === "BUY" ? -1 : 1;
    const candidates = database.positions
      .map((position, index) => ({ position, index }))
      .filter(
        ({ position }) =>
          position.ticker === order.ticker &&
          position.product === order.product &&
          Math.sign(position.quantity) === closingSign
      )
      .sort((a, b) => {
        const aSameStrategy = a.position.strategy_tag === order.strategy_tag ? 0 : 1;
        const bSameStrategy = b.position.strategy_tag === order.strategy_tag ? 0 : 1;
        return aSameStrategy - bSameStrategy || a.index - b.index;
      });

    let remaining = executedQuantity;
    const closePlans: Array<{
      position: Position;
      closeQty: number;
      chargeShare: number;
      marginBefore: number;
      marginRelease: number;
      realizedPnl: number;
    }> = [];

    for (const { position } of candidates) {
      if (remaining <= 0) break;
      const positionQty = Math.abs(position.quantity);
      const closeQty = Math.min(positionQty, remaining);
      const chargeShare = executedQuantity > 0 ? roundMoney(charges.total * (closeQty / executedQuantity)) : 0;
      const marginBefore = getPositionMargin(position);
      const marginRelease = positionQty > 0 ? roundMoney(marginBefore * (closeQty / positionQty)) : 0;
      const realizedPnl = order.type === "SELL"
        ? roundMoney(((executedPrice - position.avg_price) * closeQty) - chargeShare)
        : roundMoney(((position.avg_price - executedPrice) * closeQty) - chargeShare);

      closePlans.push({ position, closeQty, chargeShare, marginBefore, marginRelease, realizedPnl });
      remaining -= closeQty;
    }

    const openingQty = remaining;
    const openingMargin = getOpeningMargin(order, executedPrice, openingQty);
    const reserved = order.reserved_amount ?? 0;
    const reservedForFill = reserved > 0 && remainingBefore > 0
      ? roundMoney(reserved * (executedQuantity / remainingBefore))
      : 0;
    const extraMarginNeeded = Math.max(0, openingMargin - reservedForFill);
    const balanceAfterClosures = closePlans.reduce(
      (balance, plan) => balance + plan.marginRelease + plan.realizedPnl,
      database.user.virtual_balance
    );

    if (balanceAfterClosures < extraMarginNeeded) {
      order.status = "REJECTED";
      order.status_note = "Rejected: insufficient margin";
      order.rejection_reason = order.status_note;
      return { ok: false, realizedPnl: 0 };
    }

    let realizedPnl = 0;
    let releasedMargin = 0;
    for (const plan of closePlans) {
      const nextQty = Math.abs(plan.position.quantity) - plan.closeQty;
      database.user.virtual_balance = roundMoney(database.user.virtual_balance + plan.marginRelease + plan.realizedPnl);
      realizedPnl += plan.realizedPnl;
      releasedMargin += plan.marginRelease;

      if (nextQty <= 0) {
        plan.position.quantity = 0;
        plan.position.margin_required = 0;
        continue;
      }

      plan.position.quantity = closingSign > 0 ? nextQty : -nextQty;
      plan.position.margin_required = roundMoney(Math.max(0, plan.marginBefore - plan.marginRelease));
      refreshSignedPosition(plan.position, executedPrice);
    }

    database.positions = database.positions.filter((position) => Math.abs(position.quantity) > 0);

    if (reserved > 0) {
      if (openingMargin > reservedForFill) {
        database.user.virtual_balance = roundMoney(database.user.virtual_balance - (openingMargin - reservedForFill));
      } else {
        database.user.virtual_balance = roundMoney(database.user.virtual_balance + (reservedForFill - openingMargin));
      }
      order.reserved_amount = roundMoney(Math.max(0, reserved - reservedForFill));
    } else if (openingMargin > 0) {
      database.user.virtual_balance = roundMoney(database.user.virtual_balance - openingMargin);
    }

    if (openingQty > 0) {
      const entryCharges = executedQuantity > 0 ? roundMoney(charges.total * (openingQty / executedQuantity)) : 0;
      addMarginPosition(order, executedPrice, openingQty, entryCharges, openingMargin);
    }

    if (releasedMargin > 0) {
      order.margin_released = roundMoney((order.margin_released ?? 0) + releasedMargin);
    }

    return { ok: true, realizedPnl: roundMoney(realizedPnl) };
  }

  function applyExecution(order: Order, executedPrice: number, executedAt: Date, fillQuantity = order.remaining_quantity ?? order.quantity) {
    const remainingBefore = order.remaining_quantity ?? order.quantity;
    const executedQuantity = Math.min(Math.max(0, fillQuantity), remainingBefore);
    if (executedQuantity <= 0) return false;
    const segment = order.segment ?? getOrderSegment(order.ticker, order.lot_size);
    const marginProduct = isMarginProduct(order.product, segment);

    const charges = estimateTradeCharges({
      type: order.type,
      product: order.product,
      price: executedPrice,
      quantity: executedQuantity,
      segment,
    });
    const turnover = charges.turnover;
    const executionDebit = order.type === "BUY"
      ? getExecutionDebit(order, executedPrice, executedQuantity)
      : charges.netAmount;

    if (marginProduct) {
      const applied = applyMarginExecution(order, executedPrice, executedQuantity, remainingBefore, charges);
      if (!applied.ok) {
        return false;
      }
      if (applied.realizedPnl !== 0) {
        order.realized_pnl = roundMoney((order.realized_pnl ?? 0) + applied.realizedPnl);
      }
    } else if (order.type === "BUY") {
      const reserved = order.reserved_amount ?? 0;
      if (reserved > 0) {
        const reservedForFill = remainingBefore > 0 ? reserved * (executedQuantity / remainingBefore) : reserved;
        if (executionDebit > reservedForFill) {
          const extra = executionDebit - reservedForFill;
          if (database.user.virtual_balance < extra) {
            database.user.virtual_balance += reserved;
            order.status = "REJECTED";
            order.status_note = "Rejected at open: insufficient funds at opening price";
            order.rejection_reason = order.status_note;
            return false;
          }
          database.user.virtual_balance = roundMoney(database.user.virtual_balance - extra);
        } else if (reservedForFill > executionDebit) {
          database.user.virtual_balance = roundMoney(database.user.virtual_balance + (reservedForFill - executionDebit));
        }
        order.reserved_amount = roundMoney(Math.max(0, reserved - reservedForFill));
      } else {
        if (database.user.virtual_balance < executionDebit) {
          order.status = "REJECTED";
          order.status_note = "Rejected: insufficient funds";
          order.rejection_reason = order.status_note;
          return false;
        }
        database.user.virtual_balance = roundMoney(database.user.virtual_balance - executionDebit);
      }
    } else {
      const reduced = reduceSellPositions({ ...order, quantity: executedQuantity }, executedPrice, charges.total);
      if (!reduced.ok) {
        order.status = "REJECTED";
        order.status_note = "Rejected: insufficient holdings";
        order.rejection_reason = order.status_note;
        return false;
      }
      order.realized_pnl = roundMoney((order.realized_pnl ?? 0) + reduced.realizedPnl);
      database.user.virtual_balance = roundMoney(database.user.virtual_balance + charges.netAmount);
    }

    const existingIdx = database.positions.findIndex(
      (p) => p.ticker === order.ticker && p.strategy_tag === order.strategy_tag && p.product === order.product
    );

    if (!marginProduct && order.type === "BUY") {
      if (existingIdx >= 0) {
        const existing = database.positions[existingIdx];
        const newQty = existing.quantity + executedQuantity;
        const invested = roundMoney(existing.invested + executionDebit);
        const newAvg = invested / newQty;
        const currentValue = roundMoney(executedPrice * newQty);
        const pnl = roundMoney(currentValue - invested);
        database.positions[existingIdx] = {
          ...existing,
          avg_price: roundMoney(newAvg),
          quantity: newQty,
          invested,
          current_value: currentValue,
          pnl,
          pnl_percent: invested > 0 ? roundMoney((pnl / invested) * 100) : 0,
          ltp: roundMoney(executedPrice),
        };
      } else {
        database.positions.push({
          id: generateId(),
          ticker: order.ticker,
          stockName: order.stockName,
          avg_price: roundMoney(executionDebit / executedQuantity),
          quantity: executedQuantity,
          invested: executionDebit,
          current_value: turnover,
          pnl: roundMoney(turnover - executionDebit),
          pnl_percent: executionDebit > 0 ? roundMoney(((turnover - executionDebit) / executionDebit) * 100) : 0,
          day_pnl: 0,
          day_pnl_percent: 0,
          strategy_tag: order.strategy_tag,
          product: order.product,
          ltp: roundMoney(executedPrice),
          lot_size: order.lot_size,
        });
      }
    }

    const priorFilled = order.filled_quantity ?? 0;
    const filledAfter = priorFilled + executedQuantity;
    const remainingAfter = Math.max(0, order.quantity - filledAfter);
    order.filled_quantity = filledAfter;
    order.remaining_quantity = remainingAfter;
    order.status = remainingAfter > 0 ? "PARTIAL" : "COMPLETED";
    order.executed_price = roundMoney(executedPrice);
    order.avg_execution_price = priorFilled > 0 && order.avg_execution_price
      ? roundMoney(((order.avg_execution_price * priorFilled) + executedPrice * executedQuantity) / filledAfter)
      : roundMoney(executedPrice);
    order.executed_at = executedAt;
    order.status_note = remainingAfter > 0 ? `Partial fill: ${filledAfter}/${order.quantity}` : "Executed";
    order.charges = roundMoney((priorFilled > 0 ? (order.charges ?? 0) : 0) + charges.total);
    order.gross_total = roundMoney((priorFilled > 0 ? (order.gross_total ?? 0) : 0) + turnover);
    order.net_total = roundMoney((priorFilled > 0 ? (order.net_total ?? 0) : 0) + charges.netAmount);

    const transaction: Transaction = {
      id: remainingAfter > 0 ? `${order.id}-${filledAfter}` : order.id,
      type: order.type,
      ticker: order.ticker,
      stockName: order.stockName,
      price: roundMoney(executedPrice),
      quantity: executedQuantity,
      total: charges.netAmount,
      charges: charges.total,
      gross_total: turnover,
      net_total: charges.netAmount,
      realized_pnl: order.realized_pnl,
      strategy_tag: order.strategy_tag,
      product: order.product,
      status: "COMPLETED",
      timestamp: executedAt,
    };
    database.transactions.push(transaction);
    return true;
  }

  return {
    // ── Account ────────────────────────────────
    getUser() {
      return database.user;
    },

    getBalance() {
      return database.user.virtual_balance;
    },

    setBalance(amount: number) {
      database.user.virtual_balance = amount;
      persist();
    },

    resetAccount() {
      database.user = getDefaultUser();
      database.positions = [];
      database.transactions = [];
      database.orders = [];
      persist();
    },

    // ── Orders ─────────────────────────────────
    placeOrder(req: OrderRequest) {
      const validation = validateOrder(req, true);
      if (!validation.ok) {
        return { success: false, message: validation.message };
      }

      const now = new Date();
      const segment = getOrderSegment(req.ticker, req.lot_size);
      const estimatedCharges = estimateTradeCharges({
        type: req.type,
        product: req.product,
        price: req.price,
        quantity: req.quantity,
        segment,
      });
      const estimatedMargin = estimateRequiredMargin({
        type: req.type,
        ticker: req.ticker,
        product: req.product,
        price: req.price,
        quantity: req.quantity,
        lotSize: req.lot_size,
      });
      const marketOpen = getMarketStatus(segment).isOpen;
      const livePrice = Number(req.market_ltp);
      const hasLivePrice = Number.isFinite(livePrice) && livePrice > 0;
      const marketPrice = hasLivePrice ? livePrice : 0;
      const marginProduct = isMarginProduct(req.product, segment);
      const openingQty = marginProduct ? getOpeningQuantityForOrder(req) : req.type === "BUY" ? req.quantity : 0;
      const reserveRequired = marginProduct ? getOpeningMargin(req, req.price, openingQty) : req.type === "BUY" ? estimatedMargin.required : 0;

      let executeNow = false;
      if (marketOpen) {
        if ((req.variety === "MARKET" || req.variety === "SL-M") && !hasLivePrice) {
          return {
            success: false,
            message: "Live market price is required for market and stop-market orders.",
          };
        }
        if (hasLivePrice) {
          executeNow = isOrderTriggered(req, marketPrice);
        } else if (req.variety === "MARKET") {
          if (!hasLivePrice) {
            return {
              success: false,
              message: "Live market price is required for market orders.",
            };
          }
          executeNow = true;
        }
      }

      const order: Order = {
        id: generateId(),
        ...req,
        status: "PENDING",
        timestamp: now,
        segment,
        queued_at: executeNow ? undefined : now,
        status_note: executeNow ? "Ready for execution" : getTriggerStatusNote(req, marketOpen),
        lot_size: req.lot_size,
        charges: estimatedCharges.total,
        gross_total: estimatedCharges.turnover,
        net_total: estimatedCharges.netAmount,
        filled_quantity: 0,
        remaining_quantity: req.quantity,
        margin_required: marginProduct ? reserveRequired : estimatedMargin.required,
      };

      if (!executeNow && reserveRequired > 0) {
        order.reserved_amount = reserveRequired;
        database.user.virtual_balance = roundMoney(database.user.virtual_balance - reserveRequired);
      }

      database.orders.push(order);

      if (executeNow) {
        const executionPrice = marketPrice;
        const executed = applyExecution(order, executionPrice, now);
        if (!executed) {
          persist();
          return {
            success: false,
            message: order.status_note || "Order execution failed",
            order,
          };
        }
        persist();
        return {
          success: true,
          message: `${req.type} order executed: ${req.quantity} × ${req.ticker} @ ₹${executionPrice.toFixed(2)} including ₹${order.charges?.toFixed(2) ?? "0.00"} charges`,
          order,
        };
      }

      persist();
      return {
        success: true,
        message: `${req.type} ${req.variety} order queued. ${order.status_note ?? "Waiting for market trigger."}`,
        order,
      };
    },

    getOrders() {
      return [...database.orders].reverse();
    },

    cancelOrder(orderId) {
      const order = database.orders.find((o) => o.id === orderId);
      if (!order) {
        return { success: false, message: "Order not found." };
      }
      if (order.status !== "PENDING" && order.status !== "PARTIAL") {
        return { success: false, message: "Only open orders can be cancelled." };
      }

      if (order.type === "BUY" && (order.reserved_amount ?? 0) > 0) {
        database.user.virtual_balance = roundMoney(database.user.virtual_balance + (order.reserved_amount ?? 0));
        order.reserved_amount = 0;
      }

      order.status = "CANCELLED";
      order.status_note = "Cancelled by user";
      persist();
      return { success: true, message: `Order cancelled: ${order.ticker}`, order };
    },

    modifyOrder(orderId, updates) {
      const order = database.orders.find((o) => o.id === orderId);
      if (!order) {
        return { success: false, message: "Order not found." };
      }
      if (order.status !== "PENDING" && order.status !== "PARTIAL") {
        return { success: false, message: "Only open orders can be modified." };
      }

      const alreadyFilled = order.filled_quantity ?? 0;
      const nextPrice = updates.price ?? order.price;
      const nextQty = updates.quantity ?? order.quantity;
      const nextRemaining = nextQty - alreadyFilled;

      if (!Number.isFinite(nextPrice) || nextPrice <= 0 || !Number.isFinite(nextQty) || nextQty <= 0 || nextRemaining < 0) {
        return { success: false, message: "Invalid price or quantity." };
      }

      if (order.segment === "fno" && order.lot_size && order.lot_size > 1 && nextQty % order.lot_size !== 0) {
        return { success: false, message: `F&O orders must be in multiples of lot size ${order.lot_size}.` };
      }

      const segment = order.segment ?? getOrderSegment(order.ticker, order.lot_size);
      const marginProduct = isMarginProduct(order.product, segment);

      if (order.type === "BUY" || marginProduct) {
        const currentReserved = order.reserved_amount ?? 0;
        const nextCharges = estimateTradeCharges({
          type: order.type,
          product: order.product,
          price: nextPrice,
          quantity: nextRemaining,
          segment,
        });
        const openingQty = marginProduct
          ? getOpeningQuantityForOrder({ type: order.type, ticker: order.ticker, product: order.product, quantity: nextRemaining })
          : nextRemaining;
        const nextDebit = marginProduct
          ? getOpeningMargin(order, nextPrice, openingQty)
          : estimateRequiredMargin({
            type: order.type,
            ticker: order.ticker,
            product: order.product,
            price: nextPrice,
            quantity: nextRemaining,
            lotSize: order.lot_size,
          }).required;
        const effectiveBalance = database.user.virtual_balance + currentReserved;

        if (effectiveBalance < nextDebit) {
          return {
            success: false,
            message: marginProduct
              ? `Insufficient margin. Required: ₹${nextDebit.toFixed(2)}, Available: ₹${effectiveBalance.toFixed(2)}`
              : `Insufficient virtual funds. Required: ₹${nextDebit.toFixed(2)}, Available: ₹${effectiveBalance.toFixed(2)}`,
          };
        }

        database.user.virtual_balance = parseFloat((effectiveBalance - nextDebit).toFixed(2));
        order.reserved_amount = nextDebit;
        order.margin_required = nextDebit;
        order.charges = nextCharges.total;
        order.gross_total = nextCharges.turnover;
        order.net_total = nextCharges.netAmount;
      }

      if (order.type === "SELL") {
        if (!marginProduct) {
          const lockedByOthers = database.orders
            .filter(
              (o) =>
                o.id !== order.id &&
                (o.status === "PENDING" || o.status === "PARTIAL") &&
                o.type === "SELL" &&
                o.ticker === order.ticker &&
                o.product === order.product
            )
            .reduce((sum, o) => sum + (o.remaining_quantity ?? o.quantity), 0);
          const availableQty = getLongHeldQty(order.ticker, order.product) - lockedByOthers;

          if (availableQty < nextRemaining) {
            return {
              success: false,
              message: `Insufficient holdings. Available: ${Math.max(availableQty, 0)} shares of ${order.ticker}`,
            };
          }
        }
      }

      order.price = nextPrice;
      order.quantity = nextQty;
      order.remaining_quantity = nextRemaining;
      if (order.type === "SELL") {
        const nextCharges = estimateTradeCharges({
          type: order.type,
          product: order.product,
          price: nextPrice,
          quantity: nextRemaining,
          segment,
        });
        order.charges = nextCharges.total;
        order.gross_total = nextCharges.turnover;
        order.net_total = nextCharges.netAmount;
      }
      order.status_note = getTriggerStatusNote(order, getMarketStatus(segment).isOpen);
      persist();
      return {
        success: true,
        message: `Order modified: ${order.ticker} (${nextQty} @ ₹${nextPrice.toFixed(2)})`,
        order,
      };
    },

    async processPendingOrders(resolvePrice) {
      if (processingPending) {
        return { executed: 0, rejected: 0 };
      }
      processingPending = true;
      let executed = 0;
      let rejected = 0;

      try {
        for (const order of database.orders) {
          if (order.status !== "PENDING" && order.status !== "PARTIAL") continue;
          const segment = order.segment ?? getOrderSegment(order.ticker, order.lot_size);
          const marketOpen = getMarketStatus(segment).isOpen;
          if (!marketOpen) continue;

          const priceData = await resolvePrice(order.ticker, segment);
          if (!priceData) {
            continue;
          }

          const marketPrice = priceData.ltp > 0 ? priceData.ltp : priceData.openPrice;
          if (!marketPrice || marketPrice <= 0) {
            continue;
          }

          if (!isOrderTriggered(order, marketPrice)) {
            continue;
          }

          const remainingQty = order.remaining_quantity ?? order.quantity;
          if (remainingQty <= 0) continue;
          const availableQty = Number(priceData.availableQuantity);
          const fillQuantity = Number.isFinite(availableQty) && availableQty > 0
            ? Math.min(remainingQty, Math.floor(availableQty))
            : remainingQty;
          if (fillQuantity <= 0) continue;

          if (order.type === "SELL" && !isMarginProduct(order.product, segment)) {
            const lockedByOthers = database.orders
              .filter((o) => o.id !== order.id && (o.status === "PENDING" || o.status === "PARTIAL") && o.type === "SELL" && o.ticker === order.ticker && o.product === order.product)
              .reduce((sum, o) => sum + (o.remaining_quantity ?? o.quantity), 0);
            if ((getLongHeldQty(order.ticker, order.product) - lockedByOthers) < fillQuantity) {
              order.status = "REJECTED";
              order.status_note = "Rejected at open: insufficient holdings";
              order.rejection_reason = order.status_note;
              rejected += 1;
              continue;
            }
          }

          const executionPrice = order.variety === "MARKET" || order.variety === "SL-M"
            ? (priceData.openPrice > 0 ? priceData.openPrice : marketPrice)
            : marketPrice;

          const ok = applyExecution(order, executionPrice, new Date(), fillQuantity);
          if (ok) {
            executed += 1;
          } else if ((order.status as string) === "REJECTED") {
            rejected += 1;
          }
        }
      } finally {
        processingPending = false;
      }

      if (executed > 0 || rejected > 0) {
        persist();
      }

      return { executed, rejected };
    },

    // ── Positions ──────────────────────────────
    getPositions() {
      return database.positions;
    },

    getPosition(ticker: string) {
      return database.positions.find((p) => p.ticker === ticker);
    },

    removeHolding(positionId) {
      const positionIdx = database.positions.findIndex((p) => p.id === positionId);
      if (positionIdx < 0) {
        return { success: false, message: "Holding not found." };
      }

      const position = database.positions[positionIdx];
      const exitPrice = position.ltp > 0 ? position.ltp : position.avg_price;
      const now = new Date();
      const exitType: "BUY" | "SELL" = position.quantity < 0 ? "BUY" : "SELL";
      const exitQuantity = Math.abs(position.quantity);
      const segment = getOrderSegment(position.ticker, position.lot_size);
      const charges = estimateTradeCharges({
        type: exitType,
        product: position.product,
        price: exitPrice,
        quantity: exitQuantity,
        segment,
      });
      const marginRequired = isMarginProduct(position.product, segment)
        ? 0
        : estimateRequiredMargin({
          type: exitType,
          ticker: position.ticker,
          product: position.product,
          price: exitPrice,
          quantity: exitQuantity,
          lotSize: position.lot_size,
        }).required;

      const order: Order = {
        id: generateId(),
        type: exitType,
        ticker: position.ticker,
        stockName: position.stockName,
        price: exitPrice,
        quantity: exitQuantity,
        variety: "MARKET",
        product: position.product,
        strategy_tag: position.strategy_tag,
        status: "PENDING",
        timestamp: now,
        segment,
        status_note: "Exit requested",
        lot_size: position.lot_size,
        charges: charges.total,
        gross_total: charges.turnover,
        net_total: charges.netAmount,
        filled_quantity: 0,
        remaining_quantity: exitQuantity,
        margin_required: marginRequired,
      };

      database.orders.push(order);
      const ok = applyExecution(order, exitPrice, now, exitQuantity);
      persist();
      if (!ok) {
        return { success: false, message: order.status_note ?? "Exit failed." };
      }
      return { success: true, message: `${position.stockName} exited.` };
    },

    updatePositionLTP(ticker: string, ltp: number) {
      let changed = false;
      database.positions.forEach((p) => {
        if (p.ticker === ticker && p.ltp !== ltp) {
          refreshSignedPosition(p, ltp);
          changed = true;
        }
      });
      if (changed) persist();
      return changed;
    },

    getPortfolioSummary(): PortfolioSummary {
      const positions = database.positions;
      const totalInvested = positions.reduce((s, p) => s + Math.abs(p.invested), 0);
      const currentValue = positions.reduce((s, p) => s + Math.abs(p.current_value), 0);
      const totalPnl = positions.reduce((s, p) => s + p.pnl, 0);
      const realizedPnl = database.transactions
        .filter((transaction) => typeof transaction.realized_pnl === "number")
        .reduce((sum, transaction) => sum + (transaction.realized_pnl ?? 0), 0);
      const netPnl = totalPnl + realizedPnl;
      const totalPnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
      const dayPnl = positions.reduce((s, p) => s + p.day_pnl, 0);
      const dayPnlPercent = totalInvested > 0 ? (dayPnl / totalInvested) * 100 : 0;
      const risk = getPortfolioRisk({ balance: database.user.virtual_balance, positions });

      return {
        totalInvested: parseFloat(totalInvested.toFixed(2)),
        currentValue: parseFloat(currentValue.toFixed(2)),
        totalPnl: parseFloat(totalPnl.toFixed(2)),
        totalPnlPercent: parseFloat(totalPnlPercent.toFixed(2)),
        dayPnl: parseFloat(dayPnl.toFixed(2)),
        dayPnlPercent: parseFloat(dayPnlPercent.toFixed(2)),
        realizedPnl: parseFloat(realizedPnl.toFixed(2)),
        netPnl: parseFloat(netPnl.toFixed(2)),
        positions,
        marginUsed: risk.marginUsed,
        marginAvailable: risk.marginAvailable,
        grossExposure: risk.grossExposure,
        leverage: risk.leverage,
        riskScore: risk.riskScore,
      };
    },

    getRiskSummary(): PortfolioRiskSummary {
      return getPortfolioRisk({
        balance: database.user.virtual_balance,
        positions: database.positions,
      });
    },

    getPortfolioAnalytics(): PortfolioAnalytics {
      const summary = this.getPortfolioSummary();
      const closedTrades = database.transactions
        .filter((transaction) => typeof transaction.realized_pnl === "number")
        .map((transaction) => ({
          ticker: transaction.ticker,
          realizedPnl: roundMoney(transaction.realized_pnl ?? 0),
          timestamp: transaction.timestamp,
        }));
      const winningTrades = closedTrades.filter((trade) => trade.realizedPnl > 0);
      const totalCurrentValue = database.positions.reduce((sum, position) => sum + Math.abs(position.current_value), 0);

      const allocationByAssetClass = Array.from(
        database.positions.reduce((map, position) => {
          const label = getAssetClassLabel(position.ticker);
          map.set(label, (map.get(label) ?? 0) + Math.abs(position.current_value));
          return map;
        }, new Map<string, number>())
      ).map(([label, value]) => ({
        label,
        value: roundMoney(value),
        percent: totalCurrentValue > 0 ? roundMoney((value / totalCurrentValue) * 100) : 0,
      }));

      const allocationByProduct = Array.from(
        database.positions.reduce((map, position) => {
          map.set(position.product, (map.get(position.product) ?? 0) + Math.abs(position.current_value));
          return map;
        }, new Map<string, number>())
      ).map(([label, value]) => ({
        label,
        value: roundMoney(value),
        percent: totalCurrentValue > 0 ? roundMoney((value / totalCurrentValue) * 100) : 0,
      }));

      const dailyPnl = Array.from(
        database.transactions
          .filter((transaction) => typeof transaction.realized_pnl === "number")
          .reduce((map, transaction) => {
            const date = transaction.timestamp.toISOString().slice(0, 10);
            const current = map.get(date) ?? { date, realizedPnl: 0, trades: 0 };
            current.realizedPnl = roundMoney(current.realizedPnl + (transaction.realized_pnl ?? 0));
            current.trades += 1;
            map.set(date, current);
            return map;
          }, new Map<string, { date: string; realizedPnl: number; trades: number }>())
          .values()
      ).sort((a, b) => a.date.localeCompare(b.date));

      return {
        realizedPnl: summary.realizedPnl,
        unrealizedPnl: summary.totalPnl,
        netPnl: summary.netPnl,
        winRate: closedTrades.length > 0 ? roundMoney((winningTrades.length / closedTrades.length) * 100) : 0,
        totalClosedTrades: closedTrades.length,
        bestTrade: closedTrades.length > 0 ? closedTrades.reduce((best, trade) => trade.realizedPnl > best.realizedPnl ? trade : best) : null,
        worstTrade: closedTrades.length > 0 ? closedTrades.reduce((worst, trade) => trade.realizedPnl < worst.realizedPnl ? trade : worst) : null,
        allocationByAssetClass,
        allocationByProduct,
        dailyPnl,
      };
    },

    // ── Transactions ───────────────────────────
    getTransactions() {
      return [...database.transactions].reverse();
    },

    // ── Strategy Analytics ─────────────────────
    getStrategyPerformance(): StrategyPerformance[] {
      return STRATEGY_TAGS.map((tag: StrategyTag) => {
        const tagTxns = database.transactions.filter((t) => t.strategy_tag === tag);
        const tagPositions = database.positions.filter((p) => p.strategy_tag === tag);

        const wins = tagPositions.filter((p) => p.pnl > 0).length;
        const losses = tagPositions.filter((p) => p.pnl < 0).length;
        const totalPnl = tagPositions.reduce((s, p) => s + p.pnl, 0);
        const pnls = tagPositions.map((p) => p.pnl);

        return {
          tag,
          totalTrades: tagTxns.length,
          winCount: wins,
          lossCount: losses,
          winRate: tagPositions.length > 0 ? (wins / tagPositions.length) * 100 : 0,
          totalPnl: parseFloat(totalPnl.toFixed(2)),
          avgPnl: tagPositions.length > 0 ? parseFloat((totalPnl / tagPositions.length).toFixed(2)) : 0,
          bestTrade: pnls.length > 0 ? Math.max(...pnls) : 0,
          worstTrade: pnls.length > 0 ? Math.min(...pnls) : 0,
        };
      }).filter((s) => s.totalTrades > 0);
    },
  };
}

// ─── Singleton ───────────────────────────────────────────────
let managerInstance: VirtualPortfolioManager | null = null;

export function getPortfolioManager(): VirtualPortfolioManager {
  if (!managerInstance) {
    managerInstance = createPortfolioManager();
  }
  return managerInstance;
}
