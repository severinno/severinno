"use client"

import { ThemeProvider } from "next-themes"
import { QueryClient, QueryClientProvider, type QueryClientConfig } from "@tanstack/react-query"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { SoundProvider } from "@/lib/sound-context"
import "@/lib/fetch-timeout-client" // instala piso global de fetch timeout no browser
import { RealtimeProvider } from "@/components/shared/realtime-provider"
import { PWASetup } from "@/components/shared/pwa-setup"
import { PWAInstallBanner } from "@/components/shared/pwa-install"
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

  // ── Listen for silent-notification messages from the Service Worker ──
  // When the app is in focus, the SW sends a message instead of showing
  // a browser notification banner. We invalidate the notifications query
  // so the favicon badge and bell update instantly.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return

    function handleSWMessage(event: MessageEvent) {
      if (event.data?.type === "silent-notification") {
        // Invalidate notifications query to update badge + bell
        client.invalidateQueries({ queryKey: ["notifications"] })
        client.invalidateQueries({ queryKey: ["topbar-notifications"] })
        client.invalidateQueries({ queryKey: ["admin", "push"] })
      }
    }

    navigator.serviceWorker.addEventListener("message", handleSWMessage)
    return () => navigator.serviceWorker.removeEventListener("message", handleSWMessage)
  }, [client])

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <SoundProvider>
          <RealtimeProvider>{children}</RealtimeProvider>
          <SonnerToaster position="top-right" richColors closeButton />
        </SoundProvider>
      </QueryClientProvider>

      {/* PWA setup — renderless (injects meta, detects standalone) */}
      <PWASetup />

      {/* PWA install banner for Android Chrome */}
      <PWAInstallBanner />
    </ThemeProvider>
  )
}
