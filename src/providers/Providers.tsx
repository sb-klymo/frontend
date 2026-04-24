"use client";

/**
 * Client-side providers root — mounted once by `app/layout.tsx`.
 *
 * Owns the QueryClient singleton for TanStack Query. Other client providers
 * (theme, feature flags, …) can be layered here later without touching the
 * root layout.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
