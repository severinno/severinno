"use client";

import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider, type QueryClientConfig } from "@tanstack/react-query";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { useState, type ReactNode } from "react";

const queryConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
};

/**
 * Combined providers for the Severinno Marketplace SPA.
 * - next-themes: light/dark mode (emerald variant)
 * - @tanstack/react-query: server-state cache
 * - sonner: toast notifications (theme-aware)
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: queryConfig.defaultOptions,
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        {children}
        <SonnerToaster position="top-right" richColors closeButton />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
