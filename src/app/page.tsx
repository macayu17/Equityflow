"use client";

import { MarketIndexRibbon } from "@/components/market/index-ribbon";
import { StockCard } from "@/components/market/stock-card";
import { MOCK_STOCKS } from "@/lib/constants";
import Link from "next/link";
import { ArrowRight, Sparkles, BarChart3, Shield } from "lucide-react";

export default function ExplorePage() {
  const topGainers = MOCK_STOCKS.filter((s) => s.changePercent > 0)
    .sort((a, b) => b.changePercent - a.changePercent)
    .slice(0, 4);

  const topLosers = MOCK_STOCKS.filter((s) => s.changePercent < 0)
    .sort((a, b) => a.changePercent - b.changePercent)
    .slice(0, 4);

  const mostActive = [...MOCK_STOCKS]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 4);

  return (
    <div>
      <MarketIndexRibbon />

      <div className="px-4 md:px-6 py-6 space-y-8 max-w-7xl mx-auto">
        {/* Hero */}
        <div className="glass-card overflow-hidden relative">
          <div className="px-6 py-10 md:py-12">
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-accent/20 bg-accent/[0.06] text-accent text-xs font-semibold">
                  <Sparkles size={12} />
                  Paper Trading
                </span>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold text-primary dark:text-primary-dark mb-3 tracking-tight">
                Welcome to EquityFlow
              </h1>
              <p className="text-sm text-secondary dark:text-secondary-dark mb-8 max-w-lg leading-relaxed">
                Practice trading with ₹1,00,000 virtual funds. Explore stocks, test strategies, and track your performance — all risk-free.
              </p>

              {/* Feature pills */}
              <div className="flex flex-wrap gap-3 mb-8">
                {[
                  { icon: BarChart3, label: "Real-time Prices" },
                  { icon: Shield, label: "Zero Risk" },
                  { icon: Sparkles, label: "F&O + Stocks" },
                ].map((f) => (
                  <div key={f.label} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface dark:bg-surface-dark border border-border dark:border-border-dark text-xs text-secondary dark:text-secondary-dark">
                    <f.icon size={13} className="text-accent/70" />
                    {f.label}
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <Link
                  href="/stocks"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent text-white text-sm font-bold hover:bg-accent/90 transition-all duration-200"
                >
                  Start Trading
                  <ArrowRight size={14} />
                </Link>
                <Link
                  href="/portfolio"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-border dark:border-border-dark text-sm font-bold text-primary dark:text-primary-dark hover:bg-surface dark:hover:bg-surface-dark transition-all duration-200"
                >
                  View Portfolio
                </Link>
              </div>
            </div>
        </div>

        {/* ── Top Gainers ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-bold text-primary dark:text-primary-dark flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-profit" />
              Top Gainers
            </h2>
            <Link
              href="/stocks"
              className="text-xs font-bold text-accent hover:text-accent/80 transition-colors flex items-center gap-1"
            >
              View All
              <ArrowRight size={12} />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {topGainers.map((stock) => (
              <StockCard key={stock.ticker} ticker={stock.ticker} name={stock.name} />
            ))}
          </div>
        </section>

        {/* ── Top Losers ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-bold text-primary dark:text-primary-dark flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-loss" />
              Top Losers
            </h2>
            <Link
              href="/stocks"
              className="text-xs font-bold text-accent hover:text-accent/80 transition-colors flex items-center gap-1"
            >
              View All
              <ArrowRight size={12} />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {topLosers.map((stock) => (
              <StockCard key={stock.ticker} ticker={stock.ticker} name={stock.name} />
            ))}
          </div>
        </section>

        {/* ── Most Active ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-bold text-primary dark:text-primary-dark flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-info" />
              Most Active
            </h2>
            <Link
              href="/stocks"
              className="text-xs font-bold text-accent hover:text-accent/80 transition-colors flex items-center gap-1"
            >
              View All
              <ArrowRight size={12} />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {mostActive.map((stock) => (
              <StockCard key={stock.ticker} ticker={stock.ticker} name={stock.name} />
            ))}
          </div>
        </section>

        {/* All Stocks (compact list) */}
        <section>
          <h2 className="text-[15px] font-bold text-primary dark:text-primary-dark mb-4 flex items-center gap-2">
            <span className="w-1 h-4 rounded-full bg-accent" />
            All Stocks
          </h2>
          <div className="rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark divide-y divide-border dark:divide-border-dark overflow-hidden">
            {MOCK_STOCKS.map((stock) => (
              <StockCard
                key={stock.ticker}
                ticker={stock.ticker}
                name={stock.name}
                compact
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
