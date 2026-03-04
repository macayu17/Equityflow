"use client";

import { StrategyDashboard } from "@/components/portfolio/strategy-dashboard";
import { BarChart3 } from "lucide-react";

export default function StrategiesPage() {
  return (
    <div className="px-4 md:px-6 py-6 max-w-7xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-lg bg-accent/10 dark:bg-accent/[0.12] flex items-center justify-center">
            <BarChart3 size={17} className="text-accent" strokeWidth={2.2} />
          </div>
          <h1 className="text-xl font-bold text-primary dark:text-primary-dark">
            Strategy Performance
          </h1>
        </div>
        <p className="text-sm text-secondary dark:text-secondary-dark ml-[42px]">
          Analyze which trading strategies are working best for you
        </p>
      </div>

      <StrategyDashboard />
    </div>
  );
}
