// ─── User & Account ─────────────────────────────────────────
export interface User {
  id: string;
  name: string;
  email: string;
  virtual_balance: number; // Default: 1,00,000
  created_at: Date;
}

// ─── Strategy Tags ──────────────────────────────────────────
export type StrategyTag =
  | "Scalping"
  | "Swing"
  | "EMA Cross"
  | "RSI Breakout"
  | "MACD"
  | "Manual";

export const STRATEGY_TAGS: StrategyTag[] = [
  "Scalping",
  "Swing",
  "EMA Cross",
  "RSI Breakout",
  "MACD",
  "Manual",
];

// ─── Stock & Market Data ────────────────────────────────────
export interface StockQuote {
  ticker: string;
  name: string;
  exchange: string;
  ltp: number; // Last Traded Price
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: Date;
}

export interface StockSearchResult {
  ticker: string;
  name: string;
  exchange: string;
  sector?: string;
  logoUrl?: string;
}

export interface CandleData {
  time: number; // Unix timestamp
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface MarketIndex {
  name: string;
  value: number;
  change: number;
  changePercent: number;
}

export interface SparklinePoint {
  time: number;
  value: number;
}

// ─── Market Depth ───────────────────────────────────────────
export interface DepthLevel {
  price: number;
  quantity: number;
  orders: number;
}

export interface MarketDepth {
  bids: DepthLevel[];
  asks: DepthLevel[];
  totalBidQty: number;
  totalAskQty: number;
}

// ─── Orders & Trading ───────────────────────────────────────
export type OrderType = "BUY" | "SELL";
export type OrderVariety = "MARKET" | "LIMIT";
export type ProductType = "DELIVERY" | "INTRADAY";
export type OrderStatus = "COMPLETED" | "PENDING" | "CANCELLED" | "REJECTED";

export interface Order {
  id: string;
  type: OrderType;
  ticker: string;
  stockName: string;
  price: number;
  quantity: number;
  variety: OrderVariety;
  product: ProductType;
  strategy_tag: StrategyTag;
  status: OrderStatus;
  timestamp: Date;
  segment?: "equity" | "fno" | "commodity";
  queued_at?: Date;
  executed_at?: Date;
  reserved_amount?: number;
  status_note?: string;
  executed_price?: number;
  lot_size?: number;
}

export interface OrderRequest {
  type: OrderType;
  ticker: string;
  stockName: string;
  price: number;
  market_ltp?: number;
  lot_size?: number;
  quantity: number;
  variety: OrderVariety;
  product: ProductType;
  strategy_tag: StrategyTag;
}

// ─── Positions & Portfolio ──────────────────────────────────
export interface Position {
  id: string;
  ticker: string;
  stockName: string;
  avg_price: number;
  quantity: number;
  invested: number;
  current_value: number;
  pnl: number;
  pnl_percent: number;
  day_pnl: number;
  day_pnl_percent: number;
  strategy_tag: StrategyTag;
  product: ProductType;
  ltp: number;
  lot_size?: number;
}

export interface PortfolioSummary {
  totalInvested: number;
  currentValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  dayPnl: number;
  dayPnlPercent: number;
  positions: Position[];
}

// ─── Strategy Analytics ─────────────────────────────────────
export interface StrategyPerformance {
  tag: StrategyTag;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
  bestTrade: number;
  worstTrade: number;
}

// ─── Transaction History ────────────────────────────────────
export interface Transaction {
  id: string;
  type: OrderType;
  ticker: string;
  stockName: string;
  price: number;
  quantity: number;
  total: number;
  strategy_tag: StrategyTag;
  product: ProductType;
  status: OrderStatus;
  timestamp: Date;
}

// ─── Watchlist ──────────────────────────────────────────────
export interface WatchlistItem {
  ticker: string;
  name: string;
  exchange: string;
  ltp: number;
  change: number;
  changePercent: number;
}

export interface Watchlist {
  id: string;
  name: string;
  items: WatchlistItem[];
}

// ─── Timeframes ─────────────────────────────────────────────
export type Timeframe = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "ALL";

export const TIMEFRAMES: Timeframe[] = [
  "1D",
  "1W",
  "1M",
  "3M",
  "6M",
  "1Y",
  "ALL",
];

// ─── Futures & Options ──────────────────────────────────────
export type OptionType = "CE" | "PE";
export type FnoSegment = "FUT" | "OPT";

export interface FuturesContract {
  ticker: string;
  underlying: string;
  underlyingName: string;
  expiry: string;
  expiryDate: Date;
  lotSize: number;
  ltp: number;
  change: number;
  changePercent: number;
  openInterest: number;
  volume: number;
  high: number;
  low: number;
}

export interface OptionContract {
  ticker: string;
  underlying: string;
  strikePrice: number;
  optionType: OptionType;
  expiry: string;
  expiryDate: Date;
  lotSize: number;
  ltp: number;
  change: number;
  changePercent: number;
  openInterest: number;
  volume: number;
  iv: number; // Implied Volatility
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface OptionChainRow {
  strikePrice: number;
  ce: OptionContract | null;
  pe: OptionContract | null;
}

export interface OptionChain {
  underlying: string;
  underlyingLtp: number;
  expiry: string;
  expiryDates: string[];
  chain: OptionChainRow[];
}

// ─── Commodities ────────────────────────────────────────────
export type CommodityCategory = "Crude Oil" | "Gold" | "Natural Gas" | "Silver" | "Zinc" | "Copper" | "Aluminium" | "Electricity";

export interface CommodityQuote {
  ticker: string;
  name: string;
  category: CommodityCategory;
  exchange: string;
  unit: string;
  ltp: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  expiry: string;
  lotSize: number;
  timestamp: Date;
}

// ─── Asset Type for unified trading ────────────────────────
export type AssetType = "EQUITY" | "FUTURES" | "OPTIONS" | "COMMODITY";
