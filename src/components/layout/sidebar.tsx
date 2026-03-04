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
  Moon,
  Sun,
  Wallet,
  ChevronLeft,
  ChevronRight,
  CandlestickChart,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useTheme } from "@/hooks/usePortfolio";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useState, useRef, useEffect } from "react";

const NAV_ITEMS = [
  { href: "/", label: "Explore", icon: LayoutDashboard },
  { href: "/stocks", label: "Stocks", icon: TrendingUp },
  { href: "/fno", label: "F&O", icon: CandlestickChart },
  { href: "/commodities", label: "Commodities", icon: BarChart3 },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/watchlist", label: "Watchlist", icon: Eye },
  { href: "/strategies", label: "Strategies", icon: BarChart3 },
  { href: "/transactions", label: "History", icon: History },
];

export function Sidebar() {
  const pathname = usePathname();
  const { dark, toggle } = useTheme();
  const { balance, setBalance } = usePortfolio();
  const [collapsed, setCollapsed] = useState(false);
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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
        "glass-sidebar border-border dark:border-border-dark",
        collapsed ? "w-[68px]" : "w-[232px]"
      )}
    >
      {/* Logo */}
      <div className={cn("flex items-center gap-3 h-14 border-b border-border dark:border-border-dark", collapsed ? "justify-center px-2" : "px-5")}>
        <Image src="/logo.png" alt="EquityFlow" width={32} height={32} className="flex-shrink-0 rounded-lg" />
        {!collapsed && (
          <span className="text-[15px] font-bold tracking-tight text-primary dark:text-primary-dark">
            EquityFlow
          </span>
        )}
      </div>

      {/* Balance Card */}
      {!collapsed && (
        <div className="mx-3 mt-4 p-3 rounded-xl border border-border dark:border-border-dark bg-card dark:bg-card-dark">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5 text-[11px] text-secondary dark:text-secondary-dark font-medium uppercase tracking-wider">
              <Wallet size={12} className="text-accent/70" />
              Balance
            </div>
            {!editingBalance && (
              <button
                onClick={() => {
                  setBalanceInput(String(Math.round(balance)));
                  setEditingBalance(true);
                }}
                className="p-1 rounded-md hover:bg-accent/10 transition-colors"
                title="Edit balance"
              >
                <Pencil size={11} className="text-muted dark:text-muted-dark" />
              </button>
            )}
          </div>
          {editingBalance ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted dark:text-muted-dark font-medium">₹</span>
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
                className="flex-1 h-7 text-sm font-semibold tabular-nums text-primary dark:text-primary-dark bg-transparent border-b border-accent/40 focus:border-accent outline-none w-0 transition-colors"
              />
              <button
                onClick={() => {
                  const val = parseFloat(balanceInput);
                  if (!isNaN(val) && val >= 0) {
                    setBalance(val);
                    setEditingBalance(false);
                  }
                }}
                className="p-1 rounded-md hover:bg-profit-bg dark:hover:bg-profit-bg-dark text-profit transition-colors"
              >
                <Check size={13} />
              </button>
              <button
                onClick={() => setEditingBalance(false)}
                className="p-1 rounded-md hover:bg-loss-bg dark:hover:bg-loss-bg-dark text-loss transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <div className="text-[15px] font-bold tabular-nums text-primary dark:text-primary-dark">
              {formatCurrency(balance)}
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <nav className={cn("flex-1 mt-4 space-y-0.5 overflow-y-auto", collapsed ? "px-2" : "px-3")}>
        {NAV_ITEMS.map((item) => {
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
                "flex items-center rounded-xl text-[13px] font-medium transition-all duration-200 relative",
                collapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2.5",
                isActive
                  ? "bg-accent/[0.08] dark:bg-accent/[0.12] text-accent shadow-sm"
                  : "text-secondary dark:text-secondary-dark hover:bg-surface/80 dark:hover:bg-white/[0.03] hover:text-primary dark:hover:text-primary-dark"
              )}
            >
              {isActive && !collapsed && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-accent" />
              )}
              <item.icon
                size={19}
                strokeWidth={isActive ? 2.2 : 1.7}
                className="flex-shrink-0"
              />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className={cn("pb-3 space-y-0.5 border-t border-border dark:border-border-dark pt-3", collapsed ? "px-2" : "px-3")}>
        <button
          onClick={toggle}
          className={cn(
            "flex items-center w-full rounded-lg text-[13px] font-medium text-secondary dark:text-secondary-dark hover:bg-surface dark:hover:bg-elevated-dark hover:text-primary dark:hover:text-primary-dark transition-colors",
            collapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2.5"
          )}
        >
          {dark ? <Sun size={19} strokeWidth={1.7} /> : <Moon size={19} strokeWidth={1.7} />}
          {!collapsed && <span>{dark ? "Light" : "Dark"}</span>}
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "flex items-center w-full rounded-lg text-[13px] font-medium text-secondary dark:text-secondary-dark hover:bg-surface dark:hover:bg-elevated-dark hover:text-primary dark:hover:text-primary-dark transition-colors",
            collapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2.5"
          )}
        >
          {collapsed ? <ChevronRight size={19} strokeWidth={1.7} /> : <ChevronLeft size={19} strokeWidth={1.7} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
