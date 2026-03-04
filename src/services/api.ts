/**
 * API Service â€” interfaces with FastAPI backend (Groww Trade API proxy).
 * All data comes from the live backend API.
 *
 * Official Groww Trade API: https://api.groww.in/v1/
 */

import { API_CONFIG } from "@/lib/constants";
import type { StockQuote, StockSearchResult, CandleData, MarketIndex, MarketDepth, SparklinePoint } from "@/lib/types";

const BASE_URL = API_CONFIG.baseUrl;

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, { cache: "no-store", ...options });
    if (!res.ok) { console.warn(`[EquityFlow API] ${path} failed with HTTP ${res.status}`); return null; }
    return res.json();
  } catch (err) {
    console.warn(`[EquityFlow API] ${path} request error`, err);
    return null;
  }
}

async function apiPost<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) { console.warn(`[EquityFlow API] ${path} failed with HTTP ${res.status}`); return null; }
    return res.json();
  } catch (err) {
    console.warn(`[EquityFlow API] ${path} request error`, err);
    return null;
  }
}

// â”€â”€â”€ API Status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getApiStatus(): Promise<{ connected: boolean; reason?: string }> {
  const data = await apiFetch<{ connected: boolean; reason?: string }>("/api/status");
  return data ?? { connected: false, reason: "Backend offline" };
}

// â”€â”€â”€ Stock Quotes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getStockQuote(ticker: string): Promise<StockQuote> {
  const apiData = await apiFetch<StockQuote>(`/api/stock/${ticker}`);
  if (apiData) return apiData;
  throw new Error(`Failed to fetch quote for ${ticker}`);
}

// â”€â”€â”€ F&O Quotes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getFnoQuote(ticker: string): Promise<StockQuote> {
  const apiData = await apiFetch<StockQuote>(`/api/fno/quote/${ticker}`);
  if (apiData) return apiData;
  throw new Error(`Failed to fetch F&O quote for ${ticker}`);
}

// â”€â”€â”€ Commodity Quotes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getCommodityQuote(ticker: string): Promise<StockQuote> {
  const apiData = await apiFetch<StockQuote>(`/api/commodity/quote/${ticker}`);
  if (apiData) return apiData;
  throw new Error(`Failed to fetch commodity quote for ${ticker}`);
}

// â”€â”€â”€ Search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function searchStocks(query: string): Promise<StockSearchResult[]> {
  if (!query || query.length < 1) return [];
  const apiData = await apiFetch<StockSearchResult[]>(`/api/search?q=${encodeURIComponent(query)}`);
  return apiData ?? [];
}

// â”€â”€â”€ Candle Data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getCandleData(ticker: string, timeframe: string): Promise<CandleData[]> {
  const apiData = await apiFetch<CandleData[]>(`/api/candles/${ticker}?tf=${timeframe}`);
  return apiData ?? [];
}

// â”€â”€â”€ Market Indices â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getMarketIndices(): Promise<MarketIndex[]> {
  const apiData = await apiFetch<MarketIndex[]>("/api/indices");
  return apiData ?? [];
}

// â”€â”€â”€ Sparkline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getSparklineData(ticker: string): Promise<SparklinePoint[]> {
  const apiData = await apiFetch<SparklinePoint[]>(`/api/sparkline/${ticker}`);
  return apiData ?? [];
}

// â”€â”€â”€ Market Depth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getMarketDepth(ticker: string): Promise<MarketDepth> {
  const apiData = await apiFetch<MarketDepth>(`/api/depth/${ticker}`);
  if (apiData) return apiData;
  return { bids: [], asks: [], totalBidQty: 0, totalAskQty: 0 };
}

// â”€â”€â”€ Stock List (all stocks with batch LTP) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface StockListItem {
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  ltp: number;
  change: number;
  changePercent: number;
  logoUrl?: string;
}

export async function getStockList(): Promise<StockListItem[]> {
  const apiData = await apiFetch<StockListItem[]>("/api/stocks");
  return apiData ?? [];
}

// â”€â”€â”€ Trending / Top Stocks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getTrendingStocks(): Promise<StockQuote[]> {
  const apiData = await apiFetch<StockQuote[]>("/api/trending");
  return apiData ?? [];
}

// â”€â”€â”€ Full Quote (Groww live-data/quote) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getFullQuote(
  tradingSymbol: string,
  exchange: string = "NSE",
  segment: string = "CASH"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  return apiFetch(`/api/quote?exchange=${exchange}&segment=${segment}&trading_symbol=${tradingSymbol}`);
}

// â”€â”€â”€ Batch LTP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getBatchLtp(
  exchangeSymbols: string[],
  segment: string = "CASH"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const symbols = exchangeSymbols.join(",");
  return apiFetch(`/api/ltp?segment=${segment}&exchange_symbols=${symbols}`);
}

// â”€â”€â”€ Option Chain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getOptionChain(
  underlying: string,
  expiryDate: string,
  exchange: string = "NSE"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  return apiFetch(
    `/api/option-chain?exchange=${exchange}&underlying=${underlying}&expiry_date=${expiryDate}`
  );
}

// â”€â”€â”€ Greeks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getGreeks(
  underlying: string,
  tradingSymbol: string,
  expiry: string,
  exchange: string = "NSE"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  return apiFetch(
    `/api/greeks?exchange=${exchange}&underlying=${underlying}&trading_symbol=${tradingSymbol}&expiry=${expiry}`
  );
}

// â”€â”€â”€ Orders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface PlaceOrderParams {
  trading_symbol: string;
  quantity: number;
  price?: number;
  trigger_price?: number;
  validity?: string;
  exchange?: string;
  segment?: string;
  product?: string;
  order_type?: string;
  transaction_type: "BUY" | "SELL";
  order_reference_id?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function placeOrder(order: PlaceOrderParams): Promise<any> {
  return apiPost("/api/order/create", order);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function modifyOrder(params: { groww_order_id: string; segment?: string; order_type?: string; quantity?: number; price?: number; trigger_price?: number }): Promise<any> {
  return apiPost("/api/order/modify", params);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function cancelOrder(growwOrderId: string, segment: string = "CASH"): Promise<any> {
  return apiPost("/api/order/cancel", { groww_order_id: growwOrderId, segment });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getOrderList(segment: string = "CASH"): Promise<any> {
  return apiFetch(`/api/order/list?segment=${segment}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getOrderStatus(growwOrderId: string, segment: string = "CASH"): Promise<any> {
  return apiFetch(`/api/order/status/${growwOrderId}?segment=${segment}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getOrderDetail(growwOrderId: string, segment: string = "CASH"): Promise<any> {
  return apiFetch(`/api/order/detail/${growwOrderId}?segment=${segment}`);
}

// â”€â”€â”€ Stock Details (Groww-style) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getStockDetails(ticker: string): Promise<any> {
  return apiFetch(`/api/stock-details/${ticker}`);
}

// â”€â”€â”€ Portfolio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getHoldings(): Promise<any> {
  return apiFetch("/api/holdings");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getPositions(segment?: string): Promise<any> {
  const query = segment ? `?segment=${segment}` : "";
  return apiFetch(`/api/positions${query}`);
}

