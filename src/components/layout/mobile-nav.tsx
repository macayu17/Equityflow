"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, TrendingUp, Briefcase, CandlestickChart, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

const MOBILE_NAV = [
  { href: "/", label: "Explore", icon: LayoutDashboard },
  { href: "/stocks", label: "Stocks", icon: TrendingUp },
  { href: "/fno", label: "F&O", icon: CandlestickChart },
  { href: "/commodities", label: "Commodities", icon: BarChart3 },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden border-t border-border dark:border-border-dark glass pb-safe">
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
              "flex-1 flex flex-col items-center gap-1 py-2.5 text-2xs font-medium transition-colors",
              isActive
                ? "text-accent"
                : "text-muted dark:text-muted-dark"
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
