"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  Briefcase,
  History,
  BarChart3,
  Eye,
  Activity,
  Wallet,
  ChevronLeft,
  ChevronRight,
  CandlestickChart,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { cn, formatCurrency, formatPercentage, getPriceChangeColor } from "@/lib/utils";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useState, useRef, useEffect } from "react";
import { ThemeToggleButton } from "@/components/layout/theme-toggle-button";

const NAV_SECTIONS = [
  {
    label: "Market",
    items: [
      { href: "/", label: "Explore", code: "HOME", icon: LayoutDashboard },
      { href: "/stocks", label: "Stocks", code: "EQ", icon: TrendingUp },
      { href: "/fno", label: "F&O", code: "OPT", icon: CandlestickChart },
      { href: "/commodities", label: "Commodities", code: "CMD", icon: BarChart3 },
    ],
  },
  {
    label: "Book",
    items: [
      { href: "/portfolio", label: "Portfolio", code: "PF", icon: Briefcase },
      { href: "/watchlist", label: "Watchlist", code: "WL", icon: Eye },
      { href: "/strategies", label: "Strategies", code: "SIG", icon: BarChart3 },
      { href: "/diagnostics", label: "Diagnostics", code: "API", icon: Activity },
      { href: "/transactions", label: "History", code: "HIST", icon: History },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { balance, setBalance, summary, positions, orders } = usePortfolio();
  const [collapsed, setCollapsed] = useState(false);
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const equity = balance + summary.currentValue;
  const exposurePercent = equity > 0 ? (summary.currentValue / equity) * 100 : 0;
  const pendingOrders = orders.filter((order) => order.status === "PENDING" || order.status === "PARTIAL").length;
  const activePositions = positions.length;

  useEffect(() => {
    if (editingBalance && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingBalance]);

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col h-screen sticky top-0 border-r transition-all duration-200 ease-out",
        "terminal-sidebar",
        collapsed ? "w-[76px]" : "w-[260px]"
      )}
    >
      {/* Logo */}
      <div className={cn("relative flex h-14 items-center gap-3 border-b border-[color:var(--terminal-border)]", collapsed ? "justify-center px-2" : "px-3")}>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,var(--terminal-accent),transparent)] opacity-50" />
        <div className="relative flex h-9 w-9 items-center justify-center rounded-sm border border-[color:var(--terminal-border)] bg-[var(--terminal-accent-soft)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
          <Image src="/logo.png" alt="EquityFlow" width={24} height={24} className="rounded" />
          <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-[var(--terminal-surface)] bg-profit" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="font-mono text-[14px] font-bold uppercase tracking-[0.12em] text-[var(--terminal-accent)]">
              EquityFlow
            </div>
            <div className="terminal-subtle mt-0.5 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em]">
              <span className="h-1.5 w-1.5 rounded-full bg-profit" />
              NSE Paper Desk
            </div>
          </div>
        )}
      </div>

      {/* Balance Card */}
      {!collapsed && (
        <div className="mx-2 mt-3 overflow-hidden rounded-sm border border-[color:var(--terminal-border)] bg-[var(--terminal-surface)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="flex items-center justify-between border-b border-[color:var(--terminal-border)] bg-[var(--terminal-surface-raised)] px-3 py-2">
            <div className="terminal-subtle flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em]">
              <Wallet size={12} className="text-[var(--terminal-accent)]" />
              Account
            </div>
            {!editingBalance && (
              <button
                onClick={() => {
                  setBalanceInput(String(Math.round(balance)));
                  setEditingBalance(true);
                }}
                className="rounded-sm border border-transparent p-1 text-[var(--terminal-subtle)] transition-colors hover:border-[color:var(--terminal-border)] hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-accent)]"
                title="Edit balance"
              >
                <Pencil size={11} />
              </button>
            )}
          </div>
          {editingBalance ? (
            <div className="flex items-center gap-1.5 px-3 py-3">
              <span className="terminal-muted text-xs font-medium">₹</span>
              <input
                ref={inputRef}
                type="number"
                value={balanceInput}
                onChange={(e) => setBalanceInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = parseFloat(balanceInput);
                    if (!isNaN(val) && val >= 0) {
                      setBalance(val);
                      setEditingBalance(false);
                    }
                  }
                  if (e.key === "Escape") setEditingBalance(false);
                }}
                className="terminal-number h-7 w-0 flex-1 border-b border-[color:var(--terminal-border)] bg-transparent text-sm font-semibold outline-none transition-colors focus:border-[var(--terminal-accent)]"
              />
              <button
                onClick={() => {
                  const val = parseFloat(balanceInput);
                  if (!isNaN(val) && val >= 0) {
                    setBalance(val);
                    setEditingBalance(false);
                  }
                }}
                className="rounded-sm p-1 text-profit transition-colors hover:bg-profit-bg dark:hover:bg-profit-bg-dark"
              >
                <Check size={13} />
              </button>
              <button
                onClick={() => setEditingBalance(false)}
                className="rounded-sm p-1 text-loss transition-colors hover:bg-loss-bg dark:hover:bg-loss-bg-dark"
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <div className="px-3 py-3">
              <div className="terminal-subtle text-[9px] uppercase tracking-[0.14em]">Equity</div>
              <div className="terminal-number mt-1 text-[18px] font-bold text-[var(--terminal-fg)]">
                {formatCurrency(equity)}
              </div>
              <div className="mt-3 grid grid-cols-2 border border-[color:var(--terminal-grid)]">
                <div className="border-r border-b border-[color:var(--terminal-grid)] px-2 py-1.5">
                  <div className="terminal-subtle text-[9px] uppercase tracking-[0.12em]">Cash</div>
                  <div className="terminal-number mt-0.5 text-[11px] font-bold text-[var(--terminal-accent)]">{formatCurrency(balance)}</div>
                </div>
                <div className="border-b border-[color:var(--terminal-grid)] px-2 py-1.5">
                  <div className="terminal-subtle text-[9px] uppercase tracking-[0.12em]">Deployed</div>
                  <div className="terminal-number mt-0.5 text-[11px] font-bold">{formatCurrency(summary.currentValue)}</div>
                </div>
                <div className="border-r border-[color:var(--terminal-grid)] px-2 py-1.5">
                  <div className="terminal-subtle text-[9px] uppercase tracking-[0.12em]">P&L</div>
                  <div className={cn("terminal-number mt-0.5 text-[11px] font-bold", getPriceChangeColor(summary.totalPnl))}>
                    {summary.totalPnl >= 0 ? "+" : ""}{formatCurrency(summary.totalPnl)}
                  </div>
                </div>
                <div className="px-2 py-1.5">
                  <div className="terminal-subtle text-[9px] uppercase tracking-[0.12em]">Exposure</div>
                  <div className="terminal-number mt-0.5 text-[11px] font-bold">{formatPercentage(exposurePercent)}</div>
                </div>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--terminal-fill)]">
                <div
                  className="h-full rounded-full bg-[var(--terminal-accent)] transition-[width] duration-300"
                  style={{ width: `${Math.min(exposurePercent, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav className={cn("flex-1 overflow-y-auto py-3", collapsed ? "px-2" : "px-2")}>
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-3 last:mb-0">
            {!collapsed && (
              <div className="terminal-subtle mb-1.5 flex items-center justify-between px-2 font-mono text-[9px] uppercase tracking-[0.16em]">
                <span>{section.label}</span>
                <span className="h-px flex-1 bg-[var(--terminal-grid)] ml-2" />
              </div>
            )}
            <div className="space-y-1">
              {section.items.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "group relative flex items-center overflow-hidden rounded-sm border text-[12px] font-semibold uppercase tracking-[0.04em] transition-all duration-200",
                      collapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-2.5 py-2",
                      isActive
                        ? "border-amber-400 bg-amber-400 text-black shadow-[0_0_0_1px_rgba(0,0,0,0.05)]"
                        : "border-transparent terminal-subtle hover:border-[color:var(--terminal-border)] hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-accent)]"
                    )}
                  >
                    <span className={cn(
                      "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm border transition-colors",
                      isActive
                        ? "border-black/15 bg-black/10"
                        : "border-[color:var(--terminal-grid)] bg-[var(--terminal-fill)] group-hover:border-[color:var(--terminal-border)]"
                    )}>
                      <item.icon
                        size={16}
                        strokeWidth={isActive ? 2.3 : 1.8}
                      />
                    </span>
                    {!collapsed && (
                      <>
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        <span className={cn(
                          "font-mono text-[9px] tracking-[0.08em]",
                          isActive ? "text-black/65" : "terminal-subtle group-hover:text-[var(--terminal-accent)]"
                        )}>
                          {item.code}
                        </span>
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom */}
      <div className={cn("space-y-2 border-t border-[color:var(--terminal-border)] pb-3 pt-3", collapsed ? "px-2" : "px-2")}>
        {!collapsed && (
          <div className="grid grid-cols-2 gap-1.5">
            <div className="terminal-badge flex items-center gap-1.5 rounded-sm px-2 py-1.5">
              <Activity size={12} />
              <span className="font-mono text-[9px] uppercase tracking-[0.12em]">{activePositions} Pos</span>
            </div>
            <div className="terminal-badge flex items-center gap-1.5 rounded-sm px-2 py-1.5">
              <History size={12} />
              <span className="font-mono text-[9px] uppercase tracking-[0.12em]">{pendingOrders} Open</span>
            </div>
          </div>
        )}
        <ThemeToggleButton collapsed={collapsed} />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "terminal-subtle flex w-full items-center rounded-sm border border-transparent text-[12px] font-semibold uppercase tracking-[0.04em] transition-colors hover:border-[color:var(--terminal-border)] hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-accent)]",
            collapsed ? "justify-center p-2.5" : "gap-2.5 px-2.5 py-2.5"
          )}
        >
          {collapsed ? <ChevronRight size={19} strokeWidth={1.7} /> : <ChevronLeft size={19} strokeWidth={1.7} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
