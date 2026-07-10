/**
 * API Service â€” interfaces with FastAPI backend (Groww-primary market data proxy).
 * All data comes from the live backend API.
 */

import { apiDeleteJson, apiGetJson, apiPostJson, clearApiRequestCache } from "@/services/request-cache";
import type { StockQuote, StockSearchResult, CandleData, MarketIndex, MarketDepth, SparklinePoint } from "@/lib/types";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T | null> {
  return apiGetJson<T>(path, { signal: options?.signal ?? undefined });
}

async function apiPost<T>(path: string, body: unknown): Promise<T | null> {
  return apiPostJson<T>(path, body);
}

// â”€â”€â”€ API Status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getApiStatus(forceOrContext?: unknown): Promise<ApiStatus> {
  const force = typeof forceOrContext === "boolean" ? forceOrContext : false;
  const data = await apiGetJson<ApiStatus>("/api/status", { force });
  return data ?? { connected: false, reason: "Backend offline" };
}

export async function getApiDiagnostics(): Promise<ApiDiagnostics | null> {
  return apiGetJson<ApiDiagnostics>("/api/diagnostics", { ttlMs: 10_000 });
}

export async function getUpstoxAuthUrl(): Promise<UpstoxAuthUrlResponse | null> {
  return apiGetJson<UpstoxAuthUrlResponse>("/api/upstox/auth/url", { force: true, ttlMs: 0 });
}

export async function exchangeUpstoxCode(code: string, redirectUri?: string): Promise<UpstoxTokenResponse | null> {
  const result = await apiPostJson<UpstoxTokenResponse>("/api/upstox/auth/token", {
    code,
    redirect_uri: redirectUri,
  });
  clearApiRequestCache();
  return result;
}

export async function disconnectUpstox(): Promise<UpstoxDisconnectResponse | null> {
  const result = await apiDeleteJson<UpstoxDisconnectResponse>("/api/upstox/auth/token");
  clearApiRequestCache();
  return result;
}

export async function setProviderPreference(provider: MarketDataProvider): Promise<ProviderPreferenceResponse | null> {
  const result = await apiPostJson<ProviderPreferenceResponse>("/api/provider/preference", { provider });
  clearApiRequestCache();
  return result;
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

export interface ApiStatus {
  connected: boolean;
  provider?: MarketDataProvider | string;
  provider_order?: string[];
  reason?: string;
  auth_mode?: string;
  degraded_reason?: string;
  rate_limited_for_sec?: number;
  last_error?: Record<string, unknown>;
  last_success_at?: string | null;
  providers?: Record<string, {
    configured?: boolean;
    connected?: boolean;
    reason?: string;
    auth_mode?: string;
    auth_configured?: boolean;
    auth_url_available?: boolean;
    missing_auth_fields?: string[];
    token_source?: string;
    token_expires_at?: string | null;
    rate_limited_for_sec?: number;
    last_error?: Record<string, unknown>;
    last_success_at?: string | null;
  }>;
}

export type MarketDataProvider = "groww" | "upstox";

export interface ProviderPreferenceResponse {
  provider: MarketDataProvider;
  provider_order: MarketDataProvider[];
}

export interface ProviderCacheDiagnostics {
  entries: number;
  fresh: number;
  stale: number;
  inflight: number;
  max_entries: number;
}

export interface ApiDiagnostics {
  provider_order: string[];
  generated_at: string;
  providers: Record<string, {
    configured?: boolean;
    rate_limited_for_sec?: number;
    last_error?: Record<string, unknown>;
    last_success_at?: string | null;
    cache?: ProviderCacheDiagnostics;
    token_source?: string;
    instrument_index?: {
      loaded_exchanges?: string[];
      symbols?: number;
      derivatives?: number;
    };
  }>;
  sse: {
    stocks: number;
    commodities: number;
    indices: number;
    ohlc: number;
    last_refresh_age_sec?: number | null;
  };
}

export interface UpstoxAuthUrlResponse {
  configured: boolean;
  missing?: string[];
  url?: string;
  redirect_uri?: string;
}

export interface UpstoxTokenResponse {
  connected: boolean;
  token_source?: string;
  token_expires_at?: string;
  profile?: Record<string, unknown>;
}

export interface UpstoxDisconnectResponse {
  connected: boolean;
  token_source?: string;
}

export interface WorkstationSnapshot {
  prices: Record<string, { ltp: number; change: number; changePercent: number; name?: string }>;
  commodities: Record<string, { ltp: number; change: number; changePercent: number; name?: string }>;
  indices: MarketIndex[];
  depth: MarketDepth | null;
  status: ApiStatus;
  ts: string;
}

type TechnicalVerdict = "Bullish" | "Bearish" | "Neutral" | "Oversold" | "Overbought" | "Highly volatile" | string;

export interface StockDetailsResponse {
  name?: string;
  totalTradedValue?: number;
  upperCircuit?: number;
  lowerCircuit?: number;
  week52High: number;
  week52Low: number;
  fundamentals?: {
    marketCap: number;
    pe: number;
    industryPe: number;
    pb: number;
    eps: number;
    roe: number;
    dividendYield: number;
    bookValue: number;
    faceValue: number;
    debtToEquity: number;
  };
  technicals?: {
    supportResistance?: Record<"s1" | "s2" | "s3" | "pivot" | "r1" | "r2" | "r3", number>;
    indicators?: Record<"rsi" | "macd" | "beta", { value: number | string; verdict: TechnicalVerdict }>;
    summary?: {
      verdict: TechnicalVerdict;
      bearish: number;
      neutral: number;
      bullish: number;
    };
  };
}

export async function getStockList(): Promise<StockListItem[]> {
  const apiData = await apiFetch<StockListItem[]>("/api/stocks");
  return apiData ?? [];
}

export async function getWorkstationSnapshot(
  symbols: string[] = [],
  depthSymbol?: string
): Promise<WorkstationSnapshot | null> {
  const params = new URLSearchParams({
    commodities: "true",
    indices: "true",
  });
  if (symbols.length > 0) params.set("symbols", symbols.join(","));
  if (depthSymbol) params.set("depth_symbol", depthSymbol);
  return apiFetch<WorkstationSnapshot>(`/api/workstation/snapshot?${params.toString()}`);
}

// â”€â”€â”€ Trending / Top Stocks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getTrendingStocks(): Promise<StockQuote[]> {
  const apiData = await apiFetch<StockQuote[]>("/api/trending");
  return apiData ?? [];
}

// â”€â”€â”€ Full Quote â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getFullQuote(
  tradingSymbol: string,
  exchange: string = "NSE",
  segment: string = "CASH"
): Promise<StockQuote | null> {
  return apiFetch<StockQuote>(`/api/quote?exchange=${exchange}&segment=${segment}&trading_symbol=${tradingSymbol}`);
}

// â”€â”€â”€ Batch LTP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getBatchLtp(
  exchangeSymbols: string[],
  segment: string = "CASH"
): Promise<{ prices?: Record<string, number> } | null> {
  const symbols = exchangeSymbols.join(",");
  return apiFetch<{ prices?: Record<string, number> }>(`/api/ltp?segment=${segment}&exchange_symbols=${symbols}`);
}

export interface OptionChainResponse {
  source?: string;
  underlyingLtp?: number;
  strikes?: unknown[];
}

// â”€â”€â”€ Option Chain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getOptionChain(
  underlying: string,
  expiryDate: string,
  exchange: string = "NSE"
): Promise<OptionChainResponse | null> {
  return apiFetch<OptionChainResponse>(
    `/api/option-chain?exchange=${exchange}&underlying=${underlying}&expiry_date=${expiryDate}`
  );
}

// â”€â”€â”€ Greeks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getGreeks(
  underlying: string,
  tradingSymbol: string,
  expiry: string,
  exchange: string = "NSE"
): Promise<Record<string, unknown> | null> {
  return apiFetch<Record<string, unknown>>(
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

export async function placeOrder(order: PlaceOrderParams): Promise<Record<string, unknown> | null> {
  return apiPost<Record<string, unknown>>("/api/order/create", order);
}

export async function modifyOrder(params: { groww_order_id: string; segment?: string; order_type?: string; quantity?: number; price?: number; trigger_price?: number }): Promise<Record<string, unknown> | null> {
  return apiPost<Record<string, unknown>>("/api/order/modify", params);
}

export async function cancelOrder(growwOrderId: string, segment: string = "CASH"): Promise<Record<string, unknown> | null> {
  return apiPost<Record<string, unknown>>("/api/order/cancel", { groww_order_id: growwOrderId, segment });
}

export async function getOrderList(segment: string = "CASH"): Promise<Record<string, unknown> | null> {
  return apiFetch<Record<string, unknown>>(`/api/order/list?segment=${segment}`);
}

export async function getOrderStatus(growwOrderId: string, segment: string = "CASH"): Promise<Record<string, unknown> | null> {
  return apiFetch<Record<string, unknown>>(`/api/order/status/${growwOrderId}?segment=${segment}`);
}

export async function getOrderDetail(growwOrderId: string, segment: string = "CASH"): Promise<Record<string, unknown> | null> {
  return apiFetch<Record<string, unknown>>(`/api/order/detail/${growwOrderId}?segment=${segment}`);
}

// â”€â”€â”€ Stock Details (Groww-style) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getStockDetails(ticker: string): Promise<StockDetailsResponse | null> {
  return apiFetch<StockDetailsResponse>(`/api/stock-details/${ticker}`);
}

// â”€â”€â”€ Portfolio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export async function getHoldings(): Promise<Record<string, unknown> | null> {
  return apiFetch<Record<string, unknown>>("/api/holdings");
}

export async function getPositions(segment?: string): Promise<Record<string, unknown> | null> {
  const query = segment ? `?segment=${segment}` : "";
  return apiFetch<Record<string, unknown>>(`/api/positions${query}`);
}

