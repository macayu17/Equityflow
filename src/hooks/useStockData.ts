import { useQuery } from "@tanstack/react-query";
import {
  getStockQuote, getMarketIndices, getSparklineData, getCandleData,
  getMarketDepth, getTrendingStocks, searchStocks, getFnoQuote, getCommodityQuote,
  getFullQuote, getOptionChain, getOrderList, getHoldings, getPositions, getApiStatus,
  getStockDetails,
} from "@/services/api";
import { API_CONFIG } from "@/lib/constants";
import { getMarketStatus } from "@/lib/market-hours";

export function useStockPrice(ticker: string | null) {
  return useQuery({
    queryKey: ["stock-price", ticker],
    queryFn: () => getStockQuote(ticker!),
    enabled: !!ticker,
    refetchInterval: 5000, // OHLC data; fast LTP comes from SSE stream
    staleTime: 3000,
  });
}

export function useFnoQuote(ticker: string | null) {
  const isFnoMarketOpen = getMarketStatus("fno").isOpen;
  return useQuery({
    queryKey: ["fno-price", ticker],
    queryFn: () => getFnoQuote(ticker!),
    enabled: !!ticker,
    refetchInterval: isFnoMarketOpen ? API_CONFIG.pricePollingMs : false,
    staleTime: 1000,
  });
}

export function useCommodityQuote(ticker: string | null) {
  return useQuery({
    queryKey: ["commodity-price", ticker],
    queryFn: () => getCommodityQuote(ticker!),
    enabled: !!ticker,
    refetchInterval: API_CONFIG.pricePollingMs,
    staleTime: 1000,
  });
}

export function useMarketIndices() {
  return useQuery({
    queryKey: ["market-indices"],
    queryFn: getMarketIndices,
    refetchInterval: API_CONFIG.indexPollingMs,
    staleTime: 3000,
  });
}

export function useSparkline(ticker: string) {
  return useQuery({
    queryKey: ["sparkline", ticker],
    queryFn: () => getSparklineData(ticker),
    refetchInterval: 30000,
    staleTime: 30000,
  });
}

export function useCandleData(ticker: string, timeframe: string) {
  return useQuery({
    queryKey: ["candles", ticker, timeframe],
    queryFn: () => getCandleData(ticker, timeframe),
    staleTime: 30000,
  });
}

export function useMarketDepth(ticker: string) {
  const isEquityMarketOpen = getMarketStatus("equity").isOpen;
  return useQuery({
    queryKey: ["market-depth", ticker],
    queryFn: () => getMarketDepth(ticker),
    enabled: !!ticker && isEquityMarketOpen,
    refetchInterval: isEquityMarketOpen ? 800 : false,
    staleTime: 400,
  });
}

export function useTrendingStocks() {
  return useQuery({
    queryKey: ["trending"],
    queryFn: getTrendingStocks,
    refetchInterval: API_CONFIG.pricePollingMs,
    staleTime: 2000,
  });
}

export function useStockSearch(query: string) {
  return useQuery({
    queryKey: ["search", query],
    queryFn: () => searchStocks(query),
    enabled: query.length >= 1,
    staleTime: 10000,
  });
}

// ─── Full Quote (live-data/quote) ───────────────────────────
export function useFullQuote(
  tradingSymbol: string | null,
  exchange: string = "NSE",
  segment: string = "CASH"
) {
  return useQuery({
    queryKey: ["full-quote", exchange, segment, tradingSymbol],
    queryFn: () => getFullQuote(tradingSymbol!, exchange, segment),
    enabled: !!tradingSymbol,
    refetchInterval: API_CONFIG.pricePollingMs,
    staleTime: 1000,
  });
}

// ─── Option Chain ───────────────────────────────────────────
export function useOptionChain(
  underlying: string | null,
  expiryDate: string | null,
  exchange: string = "NSE"
) {
  const isFnoMarketOpen = getMarketStatus("fno").isOpen;
  return useQuery({
    queryKey: ["option-chain", exchange, underlying, expiryDate],
    queryFn: () => getOptionChain(underlying!, expiryDate!, exchange),
    enabled: !!underlying && !!expiryDate,
    refetchInterval: isFnoMarketOpen ? 2000 : false,
    staleTime: 1000,
  });
}

// ─── Orders ─────────────────────────────────────────────────
export function useOrderList(segment: string = "CASH") {
  return useQuery({
    queryKey: ["orders", segment],
    queryFn: () => getOrderList(segment),
    refetchInterval: 500,
    staleTime: 500,
  });
}

// ─── Portfolio ──────────────────────────────────────────────
export function useHoldings() {
  return useQuery({
    queryKey: ["holdings"],
    queryFn: getHoldings,
    refetchInterval: 1000,
    staleTime: 500,
  });
}

export function usePositions(segment?: string) {
  return useQuery({
    queryKey: ["positions", segment],
    queryFn: () => getPositions(segment),
    refetchInterval: 500,
    staleTime: 500,
  });
}

// ─── API Status ─────────────────────────────────────────────
export function useApiStatus() {
  return useQuery({
    queryKey: ["api-status"],
    queryFn: getApiStatus,
    refetchInterval: 5000,
    staleTime: 2000,
  });
}

// ─── Stock Details (Groww-style) ────────────────────────────
export function useStockDetails(ticker: string | null) {
  return useQuery({
    queryKey: ["stock-details", ticker],
    queryFn: () => getStockDetails(ticker!),
    enabled: !!ticker,
    refetchInterval: false,
    staleTime: 0,
  });
}
