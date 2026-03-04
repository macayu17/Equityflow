"use client";

import { TransactionHistory } from "@/components/portfolio/transaction-history";
import { History } from "lucide-react";

export default function TransactionsPage() {
  return (
    <div className="px-4 md:px-6 py-6 max-w-7xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-lg bg-accent/10 dark:bg-accent/[0.12] flex items-center justify-center">
            <History size={17} className="text-accent" strokeWidth={2.2} />
          </div>
          <h1 className="text-xl font-bold text-primary dark:text-primary-dark">
            Transaction History
          </h1>
        </div>
        <p className="text-sm text-secondary dark:text-secondary-dark ml-[42px]">
          All your paper trading orders with timestamps and details
        </p>
      </div>

      <TransactionHistory />
    </div>
  );
}
