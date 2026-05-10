"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, TrendingUp, Briefcase, CandlestickChart, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

const MOBILE_NAV = [
  { href: "/", label: "Explore", icon: LayoutDashboard },
  { href: "/stocks", label: "Stocks", icon: TrendingUp },
  { href: "/fno", label: "F&O", icon: CandlestickChart },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
  { href: "/diagnostics", label: "API", icon: Activity },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="terminal-topbar fixed bottom-0 left-0 right-0 z-40 flex md:hidden border-t backdrop-blur pb-safe">
      {MOBILE_NAV.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex-1 flex flex-col items-center gap-1 py-2.5 text-2xs font-semibold uppercase tracking-[0.04em] transition-colors",
              isActive
                ? "text-[var(--terminal-accent)]"
                : "terminal-subtle"
            )}
          >
            <item.icon size={19} strokeWidth={isActive ? 2.2 : 1.7} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
