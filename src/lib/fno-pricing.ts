import { FNO_UNDERLYINGS } from "@/lib/constants";

export type FnoContractKind = "OPT" | "FUT" | null;

export interface ParsedFnoOptionContract {
  underlying: string;
  strikePrice: number;
  optionType: "CE" | "PE";
}

function normalize(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, "");
}

function getOptionType(ticker: string, stockName = ""): "CE" | "PE" | null {
  const normalized = normalize(ticker);
  if (normalized.endsWith("CE")) return "CE";
  if (normalized.endsWith("PE")) return "PE";

  const nameMatch = stockName.toUpperCase().match(/\b(CE|PE)\b/);
  return nameMatch?.[1] === "CE" || nameMatch?.[1] === "PE" ? nameMatch[1] : null;
}

function getUnderlying(ticker: string, stockName = ""): string {
  const normalized = normalize(ticker);
  const name = stockName.toUpperCase();
  const underlyings = [...FNO_UNDERLYINGS].sort((a, b) => b.ticker.length - a.ticker.length);
  return underlyings.find((underlying) => (
    normalized.startsWith(underlying.ticker) || name.includes(underlying.ticker)
  ))?.ticker ?? "";
}

function getKnownUnderlyingLtp(underlying: string): number {
  return FNO_UNDERLYINGS.find((item) => item.ticker === underlying)?.ltp ?? 0;
}

function extractNamedStrike(stockName: string, optionType: "CE" | "PE"): number {
  const pattern = new RegExp(`(?:^|\\D)(\\d+(?:\\.\\d+)?)\\s*${optionType}\\b`, "i");
  const match = stockName.match(pattern);
  return match ? Number(match[1]) : 0;
}

function extractTickerStrike(ticker: string, underlying: string): number {
  const normalized = normalize(ticker);
  const body = normalized
    .replace(new RegExp(`^${underlying}`), "")
    .replace(/(CE|PE)$/, "");
  const digits = body.replace(/\D/g, "");
  if (!digits) return 0;

  const reference = getKnownUnderlyingLtp(underlying);
  const candidates: number[] = [];
  for (let width = 2; width <= Math.min(6, digits.length); width++) {
    candidates.push(Number(digits.slice(-width)));
  }

  const positive = candidates.filter((value) => Number.isFinite(value) && value > 0);
  if (positive.length === 0) return 0;
  if (reference <= 0) return positive[positive.length - 1];

  return positive.reduce((best, candidate) => (
    Math.abs(candidate - reference) < Math.abs(best - reference) ? candidate : best
  ), positive[0]);
}

export function getFnoContractKind(ticker: string): FnoContractKind {
  const normalized = normalize(ticker);
  if (normalized.endsWith("FUT")) return "FUT";
  if ((normalized.endsWith("CE") || normalized.endsWith("PE")) && /\d/.test(normalized)) return "OPT";
  return null;
}

export function parseFnoOptionContract(ticker: string, stockName = ""): ParsedFnoOptionContract | null {
  const optionType = getOptionType(ticker, stockName);
  if (!optionType) return null;

  const underlying = getUnderlying(ticker, stockName);
  const strikePrice = extractNamedStrike(stockName, optionType) || extractTickerStrike(ticker, underlying);
  if (!underlying || !Number.isFinite(strikePrice) || strikePrice <= 0) return null;

  return {
    underlying,
    strikePrice,
    optionType,
  };
}

export function shouldAcceptFnoLtp(input: {
  ticker: string;
  stockName?: string;
  avgPrice?: number;
  currentLtp?: number;
  candidateLtp: number;
}): boolean {
  if (!Number.isFinite(input.candidateLtp) || input.candidateLtp <= 0) return false;
  if (getFnoContractKind(input.ticker) !== "OPT" && !getOptionType(input.ticker, input.stockName)) {
    return true;
  }

  const contract = parseFnoOptionContract(input.ticker, input.stockName);
  if (!contract) return true;

  const referencePrices = [input.avgPrice, input.currentLtp]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  const lowReference = referencePrices.length > 0 ? Math.min(...referencePrices) : 0;
  const looksLikeUnderlying = input.candidateLtp >= contract.strikePrice * 0.5;

  if (looksLikeUnderlying && (lowReference === 0 || lowReference <= contract.strikePrice * 0.1)) {
    return false;
  }

  return true;
}

export function getSafeFnoLtp(input: {
  ticker: string;
  stockName?: string;
  avgPrice?: number;
  currentLtp?: number;
  candidateLtp: number;
}): number {
  if (shouldAcceptFnoLtp(input)) {
    return input.candidateLtp;
  }

  if (typeof input.avgPrice === "number" && Number.isFinite(input.avgPrice) && input.avgPrice > 0) {
    return input.avgPrice;
  }

  return typeof input.currentLtp === "number" && Number.isFinite(input.currentLtp) && input.currentLtp > 0
    ? input.currentLtp
    : 0;
}
