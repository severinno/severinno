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
        const checkInterval = setInterval(
          () => {
            if (!cancelled) reg.update().catch(() => {})
          },
          60 * 60 * 1000,
        )

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

/**
 * Converts a base64 string to a Uint8Array for VAPID applicationServerKey
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = typeof window !== "undefined" ? window.atob(base64) : ""
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function usePushSubscription() {
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isSupported] = useState(() => {
    return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window
  })
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported"
    return Notification.permission
  })
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)

  const updatePermissionState = useCallback(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(Notification.permission)
    }
  }, [])

  useEffect(() => {
    if (!isSupported) return
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        setIsSubscribed(!!sub)
      })
      .catch(() => {})
  }, [isSupported])

  const subscribe = useCallback(async () => {
    if (!isSupported) return false
    setLoading(true)
    try {
      if (typeof window !== "undefined" && "Notification" in window) {
        const perm = await Notification.requestPermission()
        setPermission(perm)
        if (perm !== "granted") {
          return false
        }
      }

      const res = await fetch("/api/push/subscribe")
      const { publicKey } = (await res.json()) as { publicKey?: string }
      if (!publicKey) throw new Error("VAPID public key not available")

      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      })

      const rawKey = sub.getKey ? sub.getKey("p256dh") : null
      const rawAuth = sub.getKey ? sub.getKey("auth") : null
      const p256dh = rawKey ? btoa(String.fromCharCode(...new Uint8Array(rawKey))) : ""
      const auth = rawAuth ? btoa(String.fromCharCode(...new Uint8Array(rawAuth))) : ""

      const saveRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          p256dh,
          auth,
          userAgent: navigator.userAgent,
        }),
      })

      if (saveRes.ok) {
        setIsSubscribed(true)
        updatePermissionState()
        return true
      }
      return false
    } catch {
      return false
    } finally {
      setLoading(false)
    }
  }, [isSupported, updatePermissionState])

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return false
    setLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
        setIsSubscribed(false)
        updatePermissionState()
        return true
      }
      return false
    } catch {
      return false
    } finally {
      setLoading(false)
    }
  }, [isSupported, updatePermissionState])

  const sendTestNotification = useCallback(async (): Promise<{ ok: boolean; message?: string }> => {
    setTesting(true)
    try {
      const res = await fetch("/api/push/send-test", { method: "POST" })
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string }
      if (res.ok && data.ok) {
        return { ok: true, message: data.message || "Notificação enviada!" }
      }
      return { ok: false, message: data.error || "Erro ao enviar notificação de teste" }
    } catch {
      return { ok: false, message: "Falha de rede ao conectar com o servidor" }
    } finally {
      setTesting(false)
    }
  }, [])

  return {
    isSubscribed,
    isSupported,
    permission,
    loading,
    testing,
    subscribe,
    unsubscribe,
    sendTestNotification,
  }
}
