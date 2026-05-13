"use client";

import { useState, useEffect } from "react";
import { Command, Search } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { LayoutModeSwitcher } from "@/components/layout/layout-mode-switcher";
import { CommandPalette } from "@/components/layout/command-palette";
import { ProviderStatusPanel } from "@/components/layout/provider-status-panel";
import { ThemeToggleButton } from "@/components/layout/theme-toggle-button";

export function TopBar() {
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <header className="terminal-topbar sticky top-0 z-40 h-12 flex items-center justify-between gap-3 px-3 md:px-4 border-b backdrop-blur">
        <div className="flex items-center gap-2.5 md:hidden">
          <Image src="/logo.png" alt="EquityFlow" width={30} height={30} className="rounded-sm" />
          <span className="font-mono text-[13px] font-bold uppercase tracking-[0.08em] text-[var(--terminal-accent)]">
            EquityFlow
          </span>
        </div>

        <button
          onClick={() => setSearchOpen(true)}
          className={cn(
            "flex h-8 items-center gap-2.5 rounded-sm border px-3 py-1.5 transition-all duration-150",
            "terminal-input terminal-subtle",
            "hover:border-[color:var(--terminal-accent)] hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-fg)]",
            "w-full max-w-[430px] font-mono text-[10px] uppercase tracking-[0.08em] md:mx-0"
          )}
        >
          <Search size={14} strokeWidth={1.8} />
          <span className="flex-1 text-left">Search symbols, routes, commands</span>
          <kbd className="terminal-hotkey hidden h-5 items-center gap-0.5 rounded-sm px-1.5 md:inline-flex">
            <Command size={10} />
            K
          </kbd>
        </button>

        <div className="hidden items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--terminal-subtle)] xl:flex">
          <span className="terminal-data-cell rounded-sm px-2 py-1">NSE</span>
          <span className="terminal-data-cell rounded-sm px-2 py-1">F&O</span>
          <span className="terminal-data-cell rounded-sm px-2 py-1">MCX</span>
          <span className="terminal-data-cell rounded-sm px-2 py-1 text-[var(--terminal-accent)]">Paper</span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ProviderStatusPanel />
          <ThemeToggleButton variant="topbar" />
          <LayoutModeSwitcher />
        </div>
      </header>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
