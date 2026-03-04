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
  type StrategyPerformance,
  type StrategyTag,
  STRATEGY_TAGS,
} from "@/lib/types";
import { API_CONFIG, MOCK_COMMODITIES } from "@/lib/constants";
import { getMarketStatus, type MarketSegment } from "@/lib/market-hours";

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
    resolvePrice: (ticker: string, segment: MarketSegment) => Promise<{ openPrice: number; ltp: number } | null>
  ): Promise<{ executed: number; rejected: number }>;

  // Positions
  getPositions(): Position[];
  getPosition(ticker: string): Position | undefined;
  removeHolding(positionId: string): { success: boolean; message: string };
  updatePositionLTP(ticker: string, ltp: number): void;
  getPortfolioSummary(): PortfolioSummary;

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

  function getOrderSegment(ticker: string): MarketSegment {
    if (commodityTickers.has(ticker)) return "commodity";

    const symbol = ticker.toUpperCase();
    const isFutureContract = symbol.endsWith("FUT");
    const isOptionContract = (symbol.endsWith("CE") || symbol.endsWith("PE")) && /\d/.test(symbol);

    if (isFutureContract || isOptionContract) return "fno";
    return "equity";
  }

  function getPendingSellLockedQty(ticker: string, product: string): number {
    return database.orders
      .filter((o) => o.status === "PENDING" && o.type === "SELL" && o.ticker === ticker && o.product === product)
      .reduce((sum, o) => sum + o.quantity, 0);
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

  function validateOrder(req: OrderRequest, includeBuffer = true): { ok: true } | { ok: false; message: string } {
    const totalCost = req.price * req.quantity;
    const buffer = includeBuffer ? totalCost * API_CONFIG.orderBuffer : 0;
    const segment = getOrderSegment(req.ticker);

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
      if (database.user.virtual_balance < totalCost + buffer) {
        return {
          ok: false,
          message: `Insufficient virtual funds. Required: ₹${(totalCost + buffer).toFixed(2)}, Available: ₹${database.user.virtual_balance.toFixed(2)}`,
        };
      }
    }

    if (req.type === "SELL") {
      const position = database.positions.find(
        (p) => p.ticker === req.ticker && p.product === req.product
      );
      const lockedQty = getPendingSellLockedQty(req.ticker, req.product);
      const availableQty = (position?.quantity ?? 0) - lockedQty;
      if (!position || availableQty < req.quantity) {
        return {
          ok: false,
          message: `Insufficient holdings. Available: ${Math.max(availableQty, 0)} shares of ${req.ticker}`,
        };
      }
    }

    return { ok: true };
  }

  function applyExecution(order: Order, executedPrice: number, executedAt: Date) {
    const totalCost = executedPrice * order.quantity;

    if (order.type === "BUY") {
      const reserved = order.reserved_amount ?? 0;
      if (reserved > 0) {
        if (totalCost > reserved) {
          const extra = totalCost - reserved;
          if (database.user.virtual_balance < extra) {
            database.user.virtual_balance += reserved;
            order.status = "REJECTED";
            order.status_note = "Rejected at open: insufficient funds at opening price";
            return false;
          }
          database.user.virtual_balance -= extra;
        } else if (reserved > totalCost) {
          database.user.virtual_balance += (reserved - totalCost);
        }
      } else {
        if (database.user.virtual_balance < totalCost) {
          order.status = "REJECTED";
          order.status_note = "Rejected: insufficient funds";
          return false;
        }
        database.user.virtual_balance -= totalCost;
      }
    } else {
      database.user.virtual_balance += totalCost;
    }

    const existingIdx = database.positions.findIndex(
      (p) => p.ticker === order.ticker && p.strategy_tag === order.strategy_tag && p.product === order.product
    );

    if (order.type === "BUY") {
      if (existingIdx >= 0) {
        const existing = database.positions[existingIdx];
        const newQty = existing.quantity + order.quantity;
        const newAvg =
          (existing.avg_price * existing.quantity + executedPrice * order.quantity) / newQty;
        database.positions[existingIdx] = {
          ...existing,
          avg_price: parseFloat(newAvg.toFixed(2)),
          quantity: newQty,
          invested: parseFloat((newAvg * newQty).toFixed(2)),
          current_value: parseFloat((existing.ltp * newQty).toFixed(2)),
          pnl: parseFloat(((existing.ltp - newAvg) * newQty).toFixed(2)),
          pnl_percent: parseFloat((((existing.ltp - newAvg) / newAvg) * 100).toFixed(2)),
        };
      } else {
        database.positions.push({
          id: generateId(),
          ticker: order.ticker,
          stockName: order.stockName,
          avg_price: executedPrice,
          quantity: order.quantity,
          invested: totalCost,
          current_value: totalCost,
          pnl: 0,
          pnl_percent: 0,
          day_pnl: 0,
          day_pnl_percent: 0,
          strategy_tag: order.strategy_tag,
          product: order.product,
          ltp: executedPrice,
          lot_size: order.lot_size,
        });
      }
    } else if (existingIdx >= 0) {
      const existing = database.positions[existingIdx];
      const newQty = existing.quantity - order.quantity;
      if (newQty <= 0) {
        database.positions.splice(existingIdx, 1);
      } else {
        database.positions[existingIdx] = {
          ...existing,
          quantity: newQty,
          invested: parseFloat((existing.avg_price * newQty).toFixed(2)),
          current_value: parseFloat((existing.ltp * newQty).toFixed(2)),
          pnl: parseFloat(((existing.ltp - existing.avg_price) * newQty).toFixed(2)),
          pnl_percent: parseFloat(
            (((existing.ltp - existing.avg_price) / existing.avg_price) * 100).toFixed(2)
          ),
        };
      }
    }

    order.status = "COMPLETED";
    order.executed_price = parseFloat(executedPrice.toFixed(2));
    order.executed_at = executedAt;
    order.status_note = "Executed";

    const transaction: Transaction = {
      id: order.id,
      type: order.type,
      ticker: order.ticker,
      stockName: order.stockName,
      price: parseFloat(executedPrice.toFixed(2)),
      quantity: order.quantity,
      total: parseFloat(totalCost.toFixed(2)),
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
      const segment = getOrderSegment(req.ticker);
      const marketOpen = getMarketStatus(segment).isOpen;
      const marketPrice = req.market_ltp && req.market_ltp > 0 ? req.market_ltp : req.price;

      let executeNow = false;
      if (marketOpen) {
        if (req.variety === "MARKET") {
          executeNow = true;
        } else {
          executeNow = isLimitTriggered(req.type, req.price, marketPrice);
        }
      }

      const order: Order = {
        id: generateId(),
        ...req,
        status: executeNow ? "COMPLETED" : "PENDING",
        timestamp: now,
        segment,
        queued_at: executeNow ? undefined : now,
        status_note: executeNow
          ? "Executed"
          : marketOpen
            ? `Limit pending: waiting for ${req.type === "BUY" ? "price <=" : "price >="} ₹${req.price.toFixed(2)}`
            : "Queued: waiting for market open",
        lot_size: req.lot_size,
      };

      if (!executeNow && req.type === "BUY") {
        const reserve = parseFloat((req.price * req.quantity).toFixed(2));
        order.reserved_amount = reserve;
        database.user.virtual_balance -= reserve;
      }

      database.orders.push(order);

      if (executeNow) {
        const executionPrice = req.variety === "LIMIT"
          ? marketPrice
          : marketPrice;
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
          message: `${req.type} order executed: ${req.quantity} × ${req.ticker} @ ₹${executionPrice.toFixed(2)}`,
          order,
        };
      }

      persist();
      return {
        success: true,
        message: marketOpen
          ? `${req.type} LIMIT order placed. Waiting for trigger price ₹${req.price.toFixed(2)}.`
          : `${req.type} order queued. It will execute when market opens${req.variety === "LIMIT" ? " and trigger price is met" : ""}.`,
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
      if (order.status !== "PENDING") {
        return { success: false, message: "Only pending orders can be cancelled." };
      }

      if (order.type === "BUY" && (order.reserved_amount ?? 0) > 0) {
        database.user.virtual_balance += order.reserved_amount ?? 0;
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
      if (order.status !== "PENDING") {
        return { success: false, message: "Only pending orders can be modified." };
      }

      const nextPrice = updates.price ?? order.price;
      const nextQty = updates.quantity ?? order.quantity;

      if (!Number.isFinite(nextPrice) || nextPrice <= 0 || !Number.isFinite(nextQty) || nextQty <= 0) {
        return { success: false, message: "Invalid price or quantity." };
      }

      if (order.segment === "fno" && order.lot_size && order.lot_size > 1 && nextQty % order.lot_size !== 0) {
        return { success: false, message: `F&O orders must be in multiples of lot size ${order.lot_size}.` };
      }

      if (order.type === "BUY") {
        const currentReserved = order.reserved_amount ?? 0;
        const nextReserved = parseFloat((nextPrice * nextQty).toFixed(2));
        const effectiveBalance = database.user.virtual_balance + currentReserved;

        if (effectiveBalance < nextReserved) {
          return {
            success: false,
            message: `Insufficient virtual funds. Required: ₹${nextReserved.toFixed(2)}, Available: ₹${effectiveBalance.toFixed(2)}`,
          };
        }

        database.user.virtual_balance = parseFloat((effectiveBalance - nextReserved).toFixed(2));
        order.reserved_amount = nextReserved;
      }

      if (order.type === "SELL") {
        const position = database.positions.find((p) => p.ticker === order.ticker && p.product === order.product);
        const lockedByOthers = database.orders
          .filter(
            (o) =>
              o.id !== order.id &&
              o.status === "PENDING" &&
              o.type === "SELL" &&
              o.ticker === order.ticker &&
              o.product === order.product
          )
          .reduce((sum, o) => sum + o.quantity, 0);
        const availableQty = (position?.quantity ?? 0) - lockedByOthers;

        if (!position || availableQty < nextQty) {
          return {
            success: false,
            message: `Insufficient holdings. Available: ${Math.max(availableQty, 0)} shares of ${order.ticker}`,
          };
        }
      }

      order.price = nextPrice;
      order.quantity = nextQty;
      order.status_note = getPendingStatusNote(order, getMarketStatus(order.segment ?? getOrderSegment(order.ticker)).isOpen);
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
          if (order.status !== "PENDING") continue;
          const segment = order.segment ?? getOrderSegment(order.ticker);
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

          if (order.variety === "LIMIT" && !isLimitTriggered(order.type, order.price, marketPrice)) {
            continue;
          }

          if (order.type === "SELL") {
            const lockedByOthers = database.orders
              .filter((o) => o.id !== order.id && o.status === "PENDING" && o.type === "SELL" && o.ticker === order.ticker && o.product === order.product)
              .reduce((sum, o) => sum + o.quantity, 0);
            const position = database.positions.find((p) => p.ticker === order.ticker && p.product === order.product);
            if (!position || (position.quantity - lockedByOthers) < order.quantity) {
              order.status = "REJECTED";
              order.status_note = "Rejected at open: insufficient holdings";
              rejected += 1;
              continue;
            }
          }

          const executionPrice = order.variety === "MARKET"
            ? (priceData.openPrice > 0 ? priceData.openPrice : marketPrice)
            : marketPrice;

          const ok = applyExecution(order, executionPrice, new Date());
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
      const total = parseFloat((exitPrice * position.quantity).toFixed(2));
      const now = new Date();

      database.user.virtual_balance = parseFloat((database.user.virtual_balance + total).toFixed(2));

      const order: Order = {
        id: generateId(),
        type: "SELL",
        ticker: position.ticker,
        stockName: position.stockName,
        price: exitPrice,
        executed_price: exitPrice,
        quantity: position.quantity,
        variety: "MARKET",
        product: position.product,
        strategy_tag: position.strategy_tag,
        status: "COMPLETED",
        timestamp: now,
        executed_at: now,
        segment: getOrderSegment(position.ticker),
        status_note: "Removed from holdings",
        lot_size: position.lot_size,
      };

      const transaction: Transaction = {
        id: generateId(),
        type: "SELL",
        ticker: position.ticker,
        stockName: position.stockName,
        price: exitPrice,
        quantity: position.quantity,
        total,
        strategy_tag: position.strategy_tag,
        product: position.product,
        status: "COMPLETED",
        timestamp: now,
      };

      database.orders.push(order);
      database.transactions.push(transaction);
      database.positions.splice(positionIdx, 1);
      persist();
      return { success: true, message: `${position.stockName} removed from holdings.` };
    },

    updatePositionLTP(ticker: string, ltp: number) {
      database.positions.forEach((p) => {
        if (p.ticker === ticker) {
          p.ltp = ltp;
          p.current_value = parseFloat((ltp * p.quantity).toFixed(2));
          p.pnl = parseFloat(((ltp - p.avg_price) * p.quantity).toFixed(2));
          p.pnl_percent = parseFloat(
            (((ltp - p.avg_price) / p.avg_price) * 100).toFixed(2)
          );
        }
      });
      persist();
    },

    getPortfolioSummary(): PortfolioSummary {
      const positions = database.positions;
      const totalInvested = positions.reduce((s, p) => s + p.invested, 0);
      const currentValue = positions.reduce((s, p) => s + p.current_value, 0);
      const totalPnl = currentValue - totalInvested;
      const totalPnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
      const dayPnl = positions.reduce((s, p) => s + p.day_pnl, 0);
      const dayPnlPercent = totalInvested > 0 ? (dayPnl / totalInvested) * 100 : 0;

      return {
        totalInvested: parseFloat(totalInvested.toFixed(2)),
        currentValue: parseFloat(currentValue.toFixed(2)),
        totalPnl: parseFloat(totalPnl.toFixed(2)),
        totalPnlPercent: parseFloat(totalPnlPercent.toFixed(2)),
        dayPnl: parseFloat(dayPnl.toFixed(2)),
        dayPnlPercent: parseFloat(dayPnlPercent.toFixed(2)),
        positions,
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
