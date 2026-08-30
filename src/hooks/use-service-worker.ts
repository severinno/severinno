"use client"

/**
 * useServiceWorker — Registers and manages the service worker lifecycle.
 *
 * Features:
 * - Auto-register on mount (client-side only)
 * - Detects SW updates and notifies the user
 * - Provides `skipWaiting()` to apply pending updates
 * - Handles registration errors gracefully
 * - No-op in test environments
 */

import { useCallback, useEffect, useRef, useState } from "react"

type SWState = {
  /** Whether the SW is registered and active */
  isRegistered: boolean
  /** Whether there's a waiting SW ready to activate */
  updateAvailable: boolean
  /** Whether a registration error occurred */
  error: string | null
  /** Call to skip waiting and apply the pending update */
  applyUpdate: () => void
}

const SW_URL = "/sw.js"

export function useServiceWorker(): SWState {
  const [isRegistered, setIsRegistered] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const swRef = useRef<ServiceWorker | null>(null)
  const appliedRef = useRef(false)

  const applyUpdate = useCallback(() => {
    const reg = swRef.current
    if (!reg) return
    if (appliedRef.current) return
    appliedRef.current = true
    reg.postMessage({ type: "SKIP_WAITING" })
    // Reload after SW takes control
    window.location.reload()
  }, [])

  useEffect(() => {
    // Skip in SSR, tests, or non-HTTPS
    if (typeof window === "undefined") return
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") return

    let cancelled = false

    async function register() {
      try {
        const reg = await navigator.serviceWorker.register(SW_URL, {
          scope: "/",
          updateViaCache: "none",
        })

        if (cancelled) return
        swRef.current = reg.installing ?? reg.waiting ?? reg.active
        setIsRegistered(true)

        // Check for updates every 60 minutes
        const checkInterval = setInterval(() => {
          if (!cancelled) reg.update().catch(() => {})
        }, 60 * 60 * 1000)

        // Listen for new SW taking over
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing
          if (!newWorker) return

          newWorker.addEventListener("statechange", () => {
            if (cancelled) return
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              // New version available
              setUpdateAvailable(true)
              swRef.current = newWorker
            }
            if (newWorker.state === "activated") {
              swRef.current = newWorker
            }
          })
        })

        // Cleanup
        return () => {
          clearInterval(checkInterval)
        }
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        // Don't surface "Already has a registration" as an error
        if (!msg.includes("already")) {
          setError(msg)
        }
      }
    }

    register()

    return () => {
      cancelled = true
    }
  }, [])

  return { isRegistered, updateAvailable, error, applyUpdate }
}
