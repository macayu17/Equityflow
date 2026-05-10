"use client";

import { useState, type CSSProperties, type MouseEvent } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/usePortfolio";

interface ThemeToggleButtonProps {
  collapsed?: boolean;
  className?: string;
  variant?: "topbar" | "sidebar";
}

export function ThemeToggleButton({
  collapsed = false,
  className,
  variant = "sidebar",
}: ThemeToggleButtonProps) {
  const { dark, toggle } = useTheme();
  const [wave, setWave] = useState<{ x: number; y: number; id: number } | null>(null);

  const handleToggle = (event: MouseEvent<HTMLButtonElement>) => {
    setWave({ x: event.clientX, y: event.clientY, id: Date.now() });
    toggle();
    window.setTimeout(() => setWave(null), 720);
  };

  const buttonClass =
    variant === "topbar"
      ? "terminal-subtle inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[color:var(--terminal-border)] bg-[var(--terminal-fill)] transition-colors hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-accent)]"
      : cn(
          "terminal-subtle flex w-full items-center rounded-sm border border-transparent text-[12px] font-semibold uppercase tracking-[0.04em] transition-colors hover:border-[color:var(--terminal-border)] hover:bg-[var(--terminal-hover)] hover:text-[var(--terminal-accent)]",
          collapsed ? "justify-center p-2.5" : "gap-2.5 px-2.5 py-2.5"
        );

  return (
    <>
      <button
        type="button"
        onClick={handleToggle}
        title={dark ? "Light mode" : "Dark mode"}
        aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
        className={cn(buttonClass, className)}
      >
        <span className="relative flex h-5 w-5 items-center justify-center overflow-hidden rounded-full">
          <Sun
            size={18}
            strokeWidth={1.8}
            className={cn(
              "absolute transition-all duration-300",
              dark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-50 opacity-0"
            )}
          />
          <Moon
            size={18}
            strokeWidth={1.8}
            className={cn(
              "absolute transition-all duration-300",
              dark ? "rotate-90 scale-50 opacity-0" : "rotate-0 scale-100 opacity-100"
            )}
          />
        </span>
        {variant === "sidebar" && !collapsed && <span>{dark ? "Light" : "Dark"}</span>}
      </button>
      {wave && (
        <span
          key={wave.id}
          className="theme-wave-overlay"
          style={
            {
              "--wave-x": `${wave.x}px`,
              "--wave-y": `${wave.y}px`,
            } as CSSProperties
          }
        />
      )}
    </>
  );
}
