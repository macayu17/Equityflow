"use client";

import { Columns3, LayoutGrid, PanelTop } from "lucide-react";
import { cn } from "@/lib/utils";
import { type LayoutMode, useLayoutMode } from "@/hooks/useLayoutMode";

const ICONS: Record<LayoutMode, typeof LayoutGrid> = {
  dense: LayoutGrid,
  classic: PanelTop,
  tabs: Columns3,
};

export function LayoutModeSwitcher() {
  const { mode, setMode, modes } = useLayoutMode();

  return (
    <div className="terminal-badge hidden lg:flex items-center gap-0.5 rounded p-0.5">
      {modes.map((item) => {
        const Icon = ICONS[item.value];
        const active = item.value === mode;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => setMode(item.value)}
            title={item.label}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors",
              active
                ? "bg-amber-400 text-black"
                : "terminal-muted hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-accent)]"
            )}
          >
            <Icon size={13} />
            {item.shortLabel}
          </button>
        );
      })}
    </div>
  );
}
