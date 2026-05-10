"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CandlestickChart, Command, Eye, Search, ShoppingCart, TrendingDown, TrendingUp, X } from "lucide-react";
import { StockLogo } from "@/components/market/stock-logo";
import { useToast } from "@/components/toast-provider";
import { useAlerts } from "@/hooks/useAlerts";
import { useLayoutMode } from "@/hooks/useLayoutMode";
import { useStockSearch } from "@/hooks/useStockData";
import { addChartToSavedLayout } from "@/lib/chart-layouts";
import { MOCK_STOCKS } from "@/lib/constants";
import { addTickerToWatchlist } from "@/lib/watchlists";
import { cn, formatCurrency } from "@/lib/utils";
import type { OrderType } from "@/lib/types";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type PaletteAction = {
  id: string;
  label: string;
  meta: string;
  icon: typeof Search;
  run: () => void;
  ticker?: string;
};

function findStock(ticker: string) {
  return MOCK_STOCKS.find((stock) => stock.ticker === ticker.toUpperCase());
}

function parseOrderType(value: string): OrderType {
  return value.toLowerCase() === "sell" ? "SELL" : "BUY";
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const { setMode } = useLayoutMode();
  const { toast } = useToast();
  const { addAlert } = useAlerts();
  const [query, setQuery] = useState("");
  const { data: results } = useStockSearch(query);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery("");
    }
  }, [open]);

  const close = () => {
    onOpenChange(false);
    setQuery("");
  };

  const openStock = (ticker: string) => {
    router.push(`/stocks/${ticker}`);
    close();
  };

  const openChart = (ticker: string) => {
    addChartToSavedLayout(ticker);
    setMode("tabs");
    router.push("/");
    toast({ title: "Chart Added", description: `${ticker} added to the chart matrix.`, variant: "success" });
    close();
  };

  const openOrderTicket = (ticker: string, type: OrderType, quantity = 1) => {
    setMode("tabs");
    router.push("/");
    const detail = { ticker, type, quantity };
    window.dispatchEvent(new CustomEvent("equityflow-open-order", { detail }));
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("equityflow-open-order", { detail })), 150);
    close();
  };

  const addWatch = (ticker: string) => {
    const result = addTickerToWatchlist(ticker);
    toast({
      title: result.added ? "Watchlist Updated" : "Already Watching",
      description: `${result.ticker} ${result.added ? "added to" : "is already in"} ${result.workspace}.`,
      variant: "success",
    });
    close();
  };

  const createAlert = (ticker: string, condition: "above" | "below", price: number) => {
    addAlert(ticker, condition, price);
    toast({
      title: "Alert Armed",
      description: `${ticker} ${condition} ${formatCurrency(price)}.`,
      variant: "success",
    });
    close();
  };

  const actions: PaletteAction[] = (() => {
    const raw = query.trim();
    const parts = raw.split(/\s+/).filter(Boolean);
    const command = parts[0]?.toLowerCase();
    const ticker = parts[1]?.toUpperCase();
    const stock = ticker ? findStock(ticker) : null;
    const quantity = Math.max(1, Number(parts[2]) || 1);
    const price = Number(parts[3] ?? parts[2]);
    const parsedCondition = parts[2]?.toLowerCase() === "below" ? "below" : "above";
    const items: PaletteAction[] = [];

    if (stock && command === "chart") {
      items.push({
        id: `chart-${ticker}`,
        label: `Open ${ticker} in chart matrix`,
        meta: stock.name,
        icon: CandlestickChart,
        ticker,
        run: () => openChart(ticker),
      });
    }

    if (stock && (command === "buy" || command === "sell")) {
      const side = parseOrderType(command);
      items.push({
        id: `${command}-${ticker}`,
        label: `${side} ${quantity} ${ticker}`,
        meta: "Open paper order ticket",
        icon: side === "BUY" ? ShoppingCart : TrendingDown,
        ticker,
        run: () => openOrderTicket(ticker, side, quantity),
      });
    }

    if (stock && command === "watch") {
      items.push({
        id: `watch-${ticker}`,
        label: `Add ${ticker} to watchlist`,
        meta: stock.name,
        icon: Eye,
        ticker,
        run: () => addWatch(ticker),
      });
    }

    if (stock && command === "alert" && Number.isFinite(price) && price > 0) {
      items.push({
        id: `alert-${ticker}`,
        label: `Alert ${ticker} ${parsedCondition} ${formatCurrency(price)}`,
        meta: "Price alert",
        icon: Bell,
        ticker,
        run: () => createAlert(ticker, parsedCondition, price),
      });
    }

    const searchMatches = (results ?? []).slice(0, 7).map((stock) => ({
      id: `open-${stock.ticker}`,
      label: stock.name,
      meta: `${stock.ticker} · ${stock.exchange}${stock.sector ? ` · ${stock.sector}` : ""}`,
      icon: Search,
      ticker: stock.ticker,
      run: () => openStock(stock.ticker),
    }));

    if (items.length > 0) return items.concat(searchMatches);
    if (raw.length > 0) return searchMatches;

    return ["RELIANCE", "TCS", "HDFCBANK", "INFY", "SBIN"].map((symbol) => {
      const stock = findStock(symbol);
      return {
        id: `popular-${symbol}`,
        label: stock?.name ?? symbol,
        meta: `${symbol} · NSE`,
        icon: TrendingUp,
        ticker: symbol,
        run: () => openStock(symbol),
      };
    });
  })();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm dark:bg-black/50" onClick={close}>
      <div
        className="terminal-panel mx-auto mt-[10vh] w-[min(720px,calc(100vw-24px))] overflow-hidden shadow-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[color:var(--terminal-border)] bg-[var(--terminal-surface-raised)] px-4 py-3">
          <Command size={17} className="text-[var(--terminal-accent)]" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search or run a terminal command"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && actions[0]) actions[0].run();
              if (event.key === "Escape") close();
            }}
            className="terminal-fg flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--terminal-subtle)]"
          />
          <kbd className="terminal-badge hidden items-center gap-1 rounded-sm px-2 py-1 font-mono text-[10px] md:inline-flex">
            <Command size={11} />
            K
          </kbd>
          <button type="button" onClick={close} className="terminal-action flex h-7 w-7 items-center justify-center px-0">
            <X size={14} />
          </button>
        </div>

        <div className="max-h-[430px] overflow-y-auto p-2">
          {actions.length === 0 ? (
            <div className="terminal-subtle px-3 py-10 text-center text-sm">No matching command</div>
          ) : (
            actions.map((action, index) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={action.run}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left transition-colors",
                    index === 0 ? "bg-[var(--terminal-hover)]" : "hover:bg-[var(--terminal-hover)]"
                  )}
                >
                  {action.ticker ? (
                    <StockLogo ticker={action.ticker} className="h-9 w-9 flex-shrink-0 rounded-sm" textClassName="text-[9px]" />
                  ) : (
                    <span className="terminal-badge flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-sm">
                      <Icon size={16} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="terminal-fg block truncate text-[13px] font-semibold">{action.label}</span>
                    <span className="terminal-subtle mt-0.5 block truncate text-[11px]">{action.meta}</span>
                  </span>
                  <Icon size={15} className="terminal-subtle" />
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
