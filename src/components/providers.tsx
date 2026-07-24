"use client"

import { ThemeProvider } from "next-themes"
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from "@tanstack/react-query"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { SoundProvider } from "@/lib/sound-context"
import { useState, useEffect, type ReactNode } from "react"

const queryConfig: QueryClientConfig = {
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
}

/**
 * Combined providers for the Severinno Marketplace SPA.
 * - next-themes: light/dark mode (emerald variant)
 * - @tanstack/react-query: server-state cache
 * - sonner: toast notifications (theme-aware)
 * - SoundProvider: sound-enabled context (available globally)
 * - Service Worker: registers on mount for offline tile cache + push
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: queryConfig.defaultOptions,
      }),
  )

  // Register Service Worker on mount (once)
  useEffect(() => {
    if ("serviceWorker" in navigator && "PushManager" in window) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // SW registration failure is non-fatal
      })
    }
  }, [])

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={client}>
        <SoundProvider>
          {children}
          <SonnerToaster position="top-right" richColors closeButton />
        </SoundProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
