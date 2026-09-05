"use client"

import { ThemeProvider } from "next-themes"
import { QueryClient, QueryClientProvider, type QueryClientConfig } from "@tanstack/react-query"
import dynamic from "next/dynamic"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { SoundProvider } from "@/lib/sound-context"
import { PWASetup } from "@/components/shared/pwa-setup"
import { PWAInstallBanner } from "@/components/shared/pwa-install"
import PwaUpdateBanner from "@/components/pwa-update-banner"
import { useState, useEffect, useCallback, useRef, type ReactNode } from "react"

// RealtimeProvider is renderless (it only runs effects) — mounting it as a
// sibling lets us keep socket.io-client (~41KB) OUT of the initial bundle.
// It loads right after hydration and connects once the user authenticates.
const RealtimeProviderLazy = dynamic(
  () => import("@/components/shared/realtime-provider").then((m) => m.RealtimeProvider),
  { ssr: false, loading: () => null },
)

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

  // Register Service Worker on mount (once) + detect updates
  const [swUpdateAvailable, setSwUpdateAvailable] = useState(false)
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null)

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return

    let cancelled = false

    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        if (cancelled) return
        swRegistrationRef.current = reg

        // Check for updates every 60 minutes
        const interval = setInterval(() => {
          if (!cancelled) reg.update().catch(() => {}
        )
        }, 60 * 60 * 1000)

        // Detect new SW waiting
        function detectUpdate() {
          const waiting = reg.waiting ?? reg.installing
          if (waiting) {
            waiting.addEventListener("statechange", () => {
              if (!cancelled && waiting.state === "installed" && navigator.serviceWorker.controller) {
                setSwUpdateAvailable(true)
              }
            })
          }
          // Also listen for updatefound
          reg.addEventListener("updatefound", () => {
            const newWorker = reg.installing
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (!cancelled && newWorker.state === "installed" && navigator.serviceWorker.controller) {
                  setSwUpdateAvailable(true)
                }
              })
            }
          })
        }

        detectUpdate()

        return () => clearInterval(interval)
      })
      .catch(() => {
        // SW registration failure is non-fatal
      })

    return () => { cancelled = true }
  }, [])

  const handleApplyUpdate = useCallback(() => {
    const waiting = swRegistrationRef.current?.waiting
    if (waiting) {
      waiting.postMessage({ type: "SKIP_WAITING" })
    }
    window.location.reload()
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

  // ── Global error handlers → GlitchTip ──────────────────────────────
  useEffect(() => {
    // Capture unhandled promise rejections
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault()
      import("@sentry/nextjs").then((Sentry) => {
        Sentry.captureException(event.reason, {
          tags: { source: "unhandled-rejection" },
        })
      }).catch(() => {})
    }

    // Capture uncaught errors
    const handleError = (event: ErrorEvent) => {
      import("@sentry/nextjs").then((Sentry) => {
        Sentry.captureException(event.error, {
          tags: { source: "window.onerror" },
          extra: { filename: event.filename, lineno: event.lineno, colno: event.colno },
        })
      }).catch(() => {})
    }

    window.addEventListener("unhandledrejection", handleUnhandledRejection)
    window.addEventListener("error", handleError)
    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection)
      window.removeEventListener("error", handleError)
    }
  }, [])

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <SoundProvider>
          {children}
          <SonnerToaster position="top-right" richColors closeButton />
          <RealtimeProviderLazy />
        </SoundProvider>
      </QueryClientProvider>

      {/* PWA update banner — shown when new SW version is waiting */}
      <PwaUpdateBanner visible={swUpdateAvailable} onUpdate={handleApplyUpdate} />

      {/* PWA setup — renderless (injects meta, detects standalone) */}
      <PWASetup />

      {/* PWA install banner for Android Chrome */}
      <PWAInstallBanner />
    </ThemeProvider>
  )
}
