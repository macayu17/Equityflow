"use client";

import { useState, useEffect } from "react";
import { Command, Search } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { LayoutModeSwitcher } from "@/components/layout/layout-mode-switcher";
import { CommandPalette } from "@/components/layout/command-palette";

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
        {/* Mobile Logo */}
        <div className="flex items-center gap-2.5 md:hidden">
          <Image src="/logo.png" alt="EquityFlow" width={32} height={32} className="rounded-lg" />
          <span className="text-[15px] font-bold text-[var(--terminal-accent)]">
            EquityFlow
          </span>
        </div>

        {/* Search */}
        <button
          onClick={() => setSearchOpen(true)}
          className={cn(
            "flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all duration-200",
            "terminal-input terminal-subtle",
            "hover:border-[color:var(--terminal-accent)] hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-fg)]",
            "text-[12px] w-full max-w-md mx-auto md:mx-0"
          )}
        >
          <Search size={15} strokeWidth={1.8} />
          <span className="flex-1 text-left">Search stocks, F&O, commodities...</span>
          <kbd className="terminal-badge hidden md:inline-flex items-center gap-0.5 text-[10px] font-mono rounded px-1.5 py-0.5">
            <Command size={11} />
            K
          </kbd>
        </button>

        <LayoutModeSwitcher />
      </header>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
