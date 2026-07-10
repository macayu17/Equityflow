import type { AlertMetric, AlertOperator } from "@/lib/alerts";
import type { OrderType, OrderVariety } from "@/lib/types";

export type ParsedTerminalCommand =
  | {
      kind: "order";
      side: OrderType;
      ticker: string;
      quantity: number;
      variety: OrderVariety;
      price?: number;
      triggerPrice?: number;
    }
  | {
      kind: "alert";
      ticker: string;
      metric: AlertMetric;
      operator: AlertOperator;
      value: number;
    }
  | {
      kind: "layout";
      preset: string;
    }
  | {
      kind: "watch";
      ticker: string;
    }
  | {
      kind: "chart";
      ticker: string;
    }
  | {
      kind: "goto";
      path: string;
    }
  | {
      kind: "unknown";
    };

const METRIC_ALIASES: Record<string, AlertMetric> = {
  price: "price",
  ltp: "price",
  move: "changePercent",
  pct: "changePercent",
  percent: "changePercent",
  volume: "volume",
  vol: "volume",
  pcr: "pcr",
  iv: "iv",
  oi: "oiChange",
  oichange: "oiChange",
};

const ROUTES: Record<string, string> = {
  home: "/",
  stocks: "/stocks",
  fno: "/fno",
  options: "/fno",
  commodities: "/commodities",
  portfolio: "/portfolio",
  watchlist: "/watchlist",
  strategies: "/strategies",
  history: "/transactions",
  diagnostics: "/diagnostics",
};

function cleanTicker(value?: string) {
  return (value ?? "").trim().toUpperCase().replace(/[^A-Z0-9&.-]/g, "");
}

function parseOperator(value?: string): AlertOperator {
  if (value === "<" || value === "<=" || value?.toLowerCase() === "below") return "<=";
  return ">=";
}

function isOperatorToken(value?: string) {
  if (!value) return false;
  return ["<", "<=", ">", ">=", "above", "below"].includes(value.toLowerCase());
}

function parseOrder(parts: string[], side: OrderType): ParsedTerminalCommand {
  const ticker = cleanTicker(parts[1]);
  if (!ticker) return { kind: "unknown" };
  const quantity = Math.max(1, Number(parts[2]) || 1);
  const orderWord = (parts[3] ?? "market").toLowerCase();
  const variety: OrderVariety = orderWord === "limit"
    ? "LIMIT"
    : orderWord === "sl" || orderWord === "stop"
      ? "SL"
      : orderWord === "sl-m" || orderWord === "slm" || orderWord === "stopmarket"
        ? "SL-M"
        : "MARKET";
  const price = Number(parts[4]);
  const triggerPrice = Number(parts[5] ?? parts[4]);

  return {
    kind: "order",
    side,
    ticker,
    quantity,
    variety,
    price: Number.isFinite(price) && price > 0 ? price : undefined,
    triggerPrice: Number.isFinite(triggerPrice) && triggerPrice > 0 ? triggerPrice : undefined,
  };
}

export function parseTerminalCommand(raw: string): ParsedTerminalCommand {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const command = parts[0]?.toLowerCase();
  if (!command) return { kind: "unknown" };

  if (command === "buy" || command === "sell") {
    return parseOrder(parts, command === "buy" ? "BUY" : "SELL");
  }

  if (command === "alert") {
    const ticker = cleanTicker(parts[1]);
    const shorthand = isOperatorToken(parts[2]);
    const metric = shorthand ? "price" : METRIC_ALIASES[(parts[2] ?? "price").toLowerCase()] ?? "price";
    const operator = parseOperator(shorthand ? parts[2] : parts[3]);
    const value = Number(shorthand ? parts[3] : parts[4] ?? parts[3]);
    if (!ticker || !Number.isFinite(value)) return { kind: "unknown" };
    return { kind: "alert", ticker, metric, operator, value };
  }

  if (command === "layout" || (command === "open" && /chart|4chart|workspace/.test((parts[1] ?? "").toLowerCase()))) {
    return { kind: "layout", preset: (command === "layout" ? parts[1] : parts[2])?.toLowerCase() || "market" };
  }

  if (command === "watch") {
    const ticker = cleanTicker(parts[1]);
    return ticker ? { kind: "watch", ticker } : { kind: "unknown" };
  }

  if (command === "chart") {
    const ticker = cleanTicker(parts[1]);
    return ticker ? { kind: "chart", ticker } : { kind: "unknown" };
  }

  if (command === "goto" || command === "go") {
    const path = ROUTES[(parts[1] ?? "").toLowerCase()];
    return path ? { kind: "goto", path } : { kind: "unknown" };
  }

  return { kind: "unknown" };
}
