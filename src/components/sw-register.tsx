"use client"

import { useEffect } from "react"

/**
 * Registers the service worker (/sw.js) on mount.
 *
 * In development, the browser may skip registration if the SW file is not
 * served from the same origin — that's expected.
 *
 * The SW handles:
 *  - Offline caching (app shell, assets, API responses)
 *  - Push notifications (booking alerts, messages)
 *  - Background sync (queue actions while offline)
 */
export function SWRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!("serviceWorker" in navigator)) return

    // Em dev o SW cacheia chunks/API e esconde HMR e deploys (o browser
    // continua servindo o bundle velho mesmo após recompile). Em vez de
    // registrar, REMOVEMOS registros e caches residuais de sessões antigas.
    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) void reg.unregister()
      })
      void caches.keys().then((keys) => {
        for (const key of keys) void caches.delete(key)
      })
      return
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // Check for SW updates every hour
        setInterval(
          () => {
            reg.update().catch(() => {})
          },
          60 * 60 * 1000,
        )

        // Listen for new SW activation
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing
          if (!newWorker) return
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "activated") {
              if (process.env.NODE_ENV !== "production") {
                // eslint-disable-next-line no-console -- dev visibility for SW lifecycle
                console.log("[PWA] Service Worker updated")
              }
            }
          })
        })
      })
      .catch(() => {
        // SW registration failed — expected in dev mode or unsupported browsers
      })

    // Listen for skip-watching message from SW
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "silent-notification") {
        // Invalidate notifications query so UI updates
        window.dispatchEvent(new CustomEvent("sw-notification", { detail: event.data }))
      }
    })
  }, [])

  return null
}
