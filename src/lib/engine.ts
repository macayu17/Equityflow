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
  type StrategyPerformance,
  type StrategyTag,
  STRATEGY_TAGS,
} from "@/lib/types";
import { API_CONFIG, MOCK_COMMODITIES } from "@/lib/constants";
import { getMarketStatus, type MarketSegment } from "@/lib/market-hours";
import { estimateTradeCharges } from "@/lib/trading-charges";

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
  updatePositionLTP(ticker: string, ltp: number): boolean;
  getPortfolioSummary(): PortfolioSummary;
  getPortfolioAnalytics(): PortfolioAnalytics;

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

  function getOrderSegment(ticker: string): MarketSegment {
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
      .filter((o) => o.status === "PENDING" && o.type === "SELL" && o.ticker === ticker && o.product === product)
      .reduce((sum, o) => sum + o.quantity, 0);
  }

  function getHeldQty(ticker: string, product: string): number {
    return database.positions
      .filter((p) => p.ticker === ticker && p.product === product)
      .reduce((sum, p) => sum + p.quantity, 0);
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
    if (!Number.isFinite(req.price) || req.price <= 0) {
      return { ok: false, message: "Invalid order price." };
    }
    if (!Number.isInteger(req.quantity) || req.quantity <= 0) {
      return { ok: false, message: "Quantity must be a whole number greater than 0." };
    }

    const segment = getOrderSegment(req.ticker);
    const charges = estimateTradeCharges({
      type: req.type,
      product: req.product,
      price: req.price,
      quantity: req.quantity,
      segment,
    });
    const buffer = includeBuffer && req.type === "BUY" ? charges.netAmount * API_CONFIG.orderBuffer : 0;

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
      if (database.user.virtual_balance < charges.netAmount + buffer) {
        return {
          ok: false,
          message: `Insufficient virtual funds. Required: ₹${(charges.netAmount + buffer).toFixed(2)}, Available: ₹${database.user.virtual_balance.toFixed(2)}`,
        };
      }
    }

    if (req.type === "SELL") {
      const lockedQty = getPendingSellLockedQty(req.ticker, req.product);
      const availableQty = getHeldQty(req.ticker, req.product) - lockedQty;
      if (availableQty < req.quantity) {
        return {
          ok: false,
          message: `Insufficient holdings. Available: ${Math.max(availableQty, 0)} shares of ${req.ticker}`,
        };
      }
    }

    return { ok: true };
  }

  function reduceSellPositions(order: Order, executedPrice: number, sellCharges = 0): { ok: boolean; realizedPnl: number } {
    let remaining = order.quantity;
    let realizedPnl = 0;
    const candidates = database.positions
      .map((position, index) => ({ position, index }))
      .filter(({ position }) => position.ticker === order.ticker && position.product === order.product)
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

  function applyExecution(order: Order, executedPrice: number, executedAt: Date) {
    const charges = estimateTradeCharges({
      type: order.type,
      product: order.product,
      price: executedPrice,
      quantity: order.quantity,
      segment: order.segment ?? getOrderSegment(order.ticker),
    });
    const turnover = charges.turnover;

    if (order.type === "BUY") {
      const reserved = order.reserved_amount ?? 0;
      if (reserved > 0) {
        if (charges.netAmount > reserved) {
          const extra = charges.netAmount - reserved;
          if (database.user.virtual_balance < extra) {
            database.user.virtual_balance += reserved;
            order.status = "REJECTED";
            order.status_note = "Rejected at open: insufficient funds at opening price";
            return false;
          }
          database.user.virtual_balance = roundMoney(database.user.virtual_balance - extra);
        } else if (reserved > charges.netAmount) {
          database.user.virtual_balance = roundMoney(database.user.virtual_balance + (reserved - charges.netAmount));
        }
      } else {
        if (database.user.virtual_balance < charges.netAmount) {
          order.status = "REJECTED";
          order.status_note = "Rejected: insufficient funds";
          return false;
        }
        database.user.virtual_balance = roundMoney(database.user.virtual_balance - charges.netAmount);
      }
    } else {
      const reduced = reduceSellPositions(order, executedPrice, charges.total);
      if (!reduced.ok) {
        order.status = "REJECTED";
        order.status_note = "Rejected: insufficient holdings";
        return false;
      }
      order.realized_pnl = reduced.realizedPnl;
      database.user.virtual_balance = roundMoney(database.user.virtual_balance + charges.netAmount);
    }

    const existingIdx = database.positions.findIndex(
      (p) => p.ticker === order.ticker && p.strategy_tag === order.strategy_tag && p.product === order.product
    );

    if (order.type === "BUY") {
      if (existingIdx >= 0) {
        const existing = database.positions[existingIdx];
        const newQty = existing.quantity + order.quantity;
        const invested = roundMoney(existing.invested + charges.netAmount);
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
          avg_price: roundMoney(charges.netAmount / order.quantity),
          quantity: order.quantity,
          invested: charges.netAmount,
          current_value: turnover,
          pnl: roundMoney(turnover - charges.netAmount),
          pnl_percent: charges.netAmount > 0 ? roundMoney(((turnover - charges.netAmount) / charges.netAmount) * 100) : 0,
          day_pnl: 0,
          day_pnl_percent: 0,
          strategy_tag: order.strategy_tag,
          product: order.product,
          ltp: roundMoney(executedPrice),
          lot_size: order.lot_size,
        });
      }
    }

    order.status = "COMPLETED";
    order.executed_price = roundMoney(executedPrice);
    order.executed_at = executedAt;
    order.status_note = "Executed";
    order.charges = charges.total;
    order.gross_total = turnover;
    order.net_total = charges.netAmount;

    const transaction: Transaction = {
      id: order.id,
      type: order.type,
      ticker: order.ticker,
      stockName: order.stockName,
      price: roundMoney(executedPrice),
      quantity: order.quantity,
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
      const segment = getOrderSegment(req.ticker);
      const estimatedCharges = estimateTradeCharges({
        type: req.type,
        product: req.product,
        price: req.price,
        quantity: req.quantity,
        segment,
      });
      const marketOpen = getMarketStatus(segment).isOpen;
      const livePrice = Number(req.market_ltp);
      const hasLivePrice = Number.isFinite(livePrice) && livePrice > 0;
      const marketPrice = hasLivePrice ? livePrice : 0;

      let executeNow = false;
      if (marketOpen) {
        if (req.variety === "MARKET") {
          if (!hasLivePrice) {
            return {
              success: false,
              message: "Live market price is required for market orders.",
            };
          }
          executeNow = true;
        } else if (hasLivePrice) {
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
          : marketOpen && req.variety === "LIMIT"
            ? `Limit pending: waiting for ${req.type === "BUY" ? "price <=" : "price >="} ₹${req.price.toFixed(2)}`
            : "Queued: waiting for market open",
        lot_size: req.lot_size,
        charges: estimatedCharges.total,
        gross_total: estimatedCharges.turnover,
        net_total: estimatedCharges.netAmount,
      };

      if (!executeNow && req.type === "BUY") {
        const reserve = estimatedCharges.netAmount;
        order.reserved_amount = reserve;
        database.user.virtual_balance = roundMoney(database.user.virtual_balance - reserve);
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
        const nextCharges = estimateTradeCharges({
          type: order.type,
          product: order.product,
          price: nextPrice,
          quantity: nextQty,
          segment: order.segment ?? getOrderSegment(order.ticker),
        });
        const nextDebit = nextCharges.netAmount;
        const effectiveBalance = database.user.virtual_balance + currentReserved;

        if (effectiveBalance < nextDebit) {
          return {
            success: false,
            message: `Insufficient virtual funds. Required: ₹${nextDebit.toFixed(2)}, Available: ₹${effectiveBalance.toFixed(2)}`,
          };
        }

        database.user.virtual_balance = parseFloat((effectiveBalance - nextDebit).toFixed(2));
        order.reserved_amount = nextDebit;
        order.charges = nextCharges.total;
        order.gross_total = nextCharges.turnover;
        order.net_total = nextCharges.netAmount;
      }

      if (order.type === "SELL") {
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
        const availableQty = getHeldQty(order.ticker, order.product) - lockedByOthers;

        if (availableQty < nextQty) {
          return {
            success: false,
            message: `Insufficient holdings. Available: ${Math.max(availableQty, 0)} shares of ${order.ticker}`,
          };
        }
      }

      order.price = nextPrice;
      order.quantity = nextQty;
      if (order.type === "SELL") {
        const nextCharges = estimateTradeCharges({
          type: order.type,
          product: order.product,
          price: nextPrice,
          quantity: nextQty,
          segment: order.segment ?? getOrderSegment(order.ticker),
        });
        order.charges = nextCharges.total;
        order.gross_total = nextCharges.turnover;
        order.net_total = nextCharges.netAmount;
      }
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
            if ((getHeldQty(order.ticker, order.product) - lockedByOthers) < order.quantity) {
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
      const charges = estimateTradeCharges({
        type: "SELL",
        product: position.product,
        price: exitPrice,
        quantity: position.quantity,
        segment: getOrderSegment(position.ticker),
      });
      const now = new Date();

      database.user.virtual_balance = parseFloat((database.user.virtual_balance + charges.netAmount).toFixed(2));

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
        charges: charges.total,
        gross_total: charges.turnover,
        net_total: charges.netAmount,
      };

      const transaction: Transaction = {
        id: generateId(),
        type: "SELL",
        ticker: position.ticker,
        stockName: position.stockName,
        price: exitPrice,
        quantity: position.quantity,
        total: charges.netAmount,
        charges: charges.total,
        gross_total: charges.turnover,
        net_total: charges.netAmount,
        realized_pnl: roundMoney((exitPrice - position.avg_price) * position.quantity - charges.total),
        strategy_tag: position.strategy_tag,
        product: position.product,
        status: "COMPLETED",
        timestamp: now,
      };
      order.realized_pnl = transaction.realized_pnl;

      database.orders.push(order);
      database.transactions.push(transaction);
      database.positions.splice(positionIdx, 1);
      persist();
      return { success: true, message: `${position.stockName} removed from holdings.` };
    },

    updatePositionLTP(ticker: string, ltp: number) {
      let changed = false;
      database.positions.forEach((p) => {
        if (p.ticker === ticker && p.ltp !== ltp) {
          p.ltp = ltp;
          p.current_value = parseFloat((ltp * p.quantity).toFixed(2));
          p.pnl = parseFloat(((ltp - p.avg_price) * p.quantity).toFixed(2));
          p.pnl_percent = parseFloat(
            (((ltp - p.avg_price) / p.avg_price) * 100).toFixed(2)
          );
          changed = true;
        }
      });
      if (changed) persist();
      return changed;
    },

    getPortfolioSummary(): PortfolioSummary {
      const positions = database.positions;
      const totalInvested = positions.reduce((s, p) => s + p.invested, 0);
      const currentValue = positions.reduce((s, p) => s + p.current_value, 0);
      const totalPnl = currentValue - totalInvested;
      const realizedPnl = database.transactions
        .filter((transaction) => transaction.type === "SELL")
        .reduce((sum, transaction) => sum + (transaction.realized_pnl ?? 0), 0);
      const netPnl = totalPnl + realizedPnl;
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
        realizedPnl: parseFloat(realizedPnl.toFixed(2)),
        netPnl: parseFloat(netPnl.toFixed(2)),
        positions,
      };
    },

    getPortfolioAnalytics(): PortfolioAnalytics {
      const summary = this.getPortfolioSummary();
      const closedTrades = database.transactions
        .filter((transaction) => transaction.type === "SELL" && typeof transaction.realized_pnl === "number")
        .map((transaction) => ({
          ticker: transaction.ticker,
          realizedPnl: roundMoney(transaction.realized_pnl ?? 0),
          timestamp: transaction.timestamp,
        }));
      const winningTrades = closedTrades.filter((trade) => trade.realizedPnl > 0);
      const totalCurrentValue = database.positions.reduce((sum, position) => sum + position.current_value, 0);

      const allocationByAssetClass = Array.from(
        database.positions.reduce((map, position) => {
          const label = getAssetClassLabel(position.ticker);
          map.set(label, (map.get(label) ?? 0) + position.current_value);
          return map;
        }, new Map<string, number>())
      ).map(([label, value]) => ({
        label,
        value: roundMoney(value),
        percent: totalCurrentValue > 0 ? roundMoney((value / totalCurrentValue) * 100) : 0,
      }));

      const allocationByProduct = Array.from(
        database.positions.reduce((map, position) => {
          map.set(position.product, (map.get(position.product) ?? 0) + position.current_value);
          return map;
        }, new Map<string, number>())
      ).map(([label, value]) => ({
        label,
        value: roundMoney(value),
        percent: totalCurrentValue > 0 ? roundMoney((value / totalCurrentValue) * 100) : 0,
      }));

      const dailyPnl = Array.from(
        database.transactions
          .filter((transaction) => transaction.type === "SELL" && typeof transaction.realized_pnl === "number")
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
