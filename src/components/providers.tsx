"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { PriceStreamProvider } from "@/hooks/usePriceStream";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            retry: (failureCount, error) => {
              const message = error instanceof Error ? error.message : "";
              if (message.includes("429")) return false;
              return failureCount < 1;
            },
            retryDelay: (attempt) => Math.min(30_000, 1_000 * 2 ** attempt),
            staleTime: 10_000,
            gcTime: 5 * 60_000,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <PriceStreamProvider>{children}</PriceStreamProvider>
    </QueryClientProvider>
  );
}
