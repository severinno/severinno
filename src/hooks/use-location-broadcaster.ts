"use client"

import * as React from "react"
import { toast } from "sonner"
import { KalmanFilter2D } from "@/lib/geo-kalman"

export type BroadcasterOptions = {
  bookingId?: string | null
  intervalMs?: number
  /** Maximum acceptable accuracy in meters (e.g. 35m). Fixes worse than this are filtered out. */
  maxAccuracyMeters?: number
  /** Enable 2D Kalman smoothing for jitter reduction. Default: true. */
  enableKalmanFilter?: boolean
  onPositionUpdate?: (pos: {
    lat: number
    lng: number
    speed: number | null
    heading: number | null
    accuracy: number | null
  }) => void
  onDegradedFix?: (accuracyMeters: number) => void
}

import { enqueueOfflinePing, flushOfflineGeoQueue } from "@/lib/offline-geo-queue"

export function useLocationBroadcaster(options?: BroadcasterOptions) {
  const bookingId = options?.bookingId
  const intervalMs = options?.intervalMs ?? 10000
  const maxAccuracyMeters = options?.maxAccuracyMeters ?? 40
  const enableKalmanFilter = options?.enableKalmanFilter ?? true
  const onPositionUpdate = options?.onPositionUpdate
  const onDegradedFix = options?.onDegradedFix

  const [isBroadcasting, setIsBroadcasting] = React.useState(false)
  const [lastPosition, setLastPosition] = React.useState<{
    lat: number
    lng: number
    accuracy: number | null
  } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const watchIdRef = React.useRef<number | null>(null)
  const lastSentRef = React.useRef<number>(0)
  const kalmanRef = React.useRef<KalmanFilter2D>(new KalmanFilter2D())

  const stop = React.useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    kalmanRef.current.reset()
    setIsBroadcasting(false)
  }, [])

  const sendPosition = React.useCallback(
    async (
      lat: number,
      lng: number,
      speed: number | null,
      heading: number | null,
      accuracy: number | null,
    ) => {
      if (!bookingId) return

      // Offline detection: se dispositivo estiver sem rede, enfileira localmente
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await enqueueOfflinePing({
          bookingId,
          lat,
          lng,
          speed,
          heading,
          accuracy,
          timestamp: new Date().toISOString(),
        })
        return
      }

      try {
        const res = await fetch(`/api/tracking/${bookingId}/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lng, speed, heading, accuracy }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          console.warn("[Broadcaster] Erro ao enviar posição:", data.error)
          // Em caso de erro transitório de rota, salva no buffer offline
          await enqueueOfflinePing({
            bookingId,
            lat,
            lng,
            speed,
            heading,
            accuracy,
            timestamp: new Date().toISOString(),
          })
        }
      } catch (err) {
        console.warn("[Broadcaster] Falha de rede ao enviar posição — enfileirado offline:", err)
        await enqueueOfflinePing({
          bookingId,
          lat,
          lng,
          speed,
          heading,
          accuracy,
          timestamp: new Date().toISOString(),
        })
      }
    },
    [bookingId],
  )

  const start = React.useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Geolocalização não suportada neste dispositivo.")
      toast.error("Geolocalização não suportada.")
      return
    }

    setError(null)
    setIsBroadcasting(true)
    kalmanRef.current.reset()

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: rawLat, longitude: rawLng, speed, heading, accuracy } = pos.coords

        // Accuracy Gate: ignore degraded cell/wifi fixes with excessive error margins
        if (typeof accuracy === "number" && maxAccuracyMeters && accuracy > maxAccuracyMeters) {
          onDegradedFix?.(accuracy)
          return
        }

        let lat = rawLat
        let lng = rawLng
        let effectiveAccuracy = typeof accuracy === "number" ? accuracy : null

        if (enableKalmanFilter) {
          const filtered = kalmanRef.current.update(
            rawLat,
            rawLng,
            accuracy ?? 15,
            pos.timestamp || Date.now(),
          )
          lat = filtered.lat
          lng = filtered.lng
          effectiveAccuracy = filtered.accuracyMeters
        }

        setLastPosition({ lat, lng, accuracy: effectiveAccuracy })
        onPositionUpdate?.({ lat, lng, speed, heading, accuracy: effectiveAccuracy })

        const now = Date.now()
        if (now - lastSentRef.current >= intervalMs) {
          lastSentRef.current = now
          sendPosition(lat, lng, speed, heading, effectiveAccuracy)
        }
      },
      (err) => {
        setError(err.message)
        setIsBroadcasting(false)
        toast.error(`Erro no GPS: ${err.message}`)
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 3000,
      },
    )
  }, [
    intervalMs,
    maxAccuracyMeters,
    enableKalmanFilter,
    onPositionUpdate,
    onDegradedFix,
    sendPosition,
  ])

  const toggle = React.useCallback(() => {
    if (isBroadcasting) {
      stop()
    } else {
      start()
    }
  }, [isBroadcasting, start, stop])

  React.useEffect(() => {
    const handleOnline = () => {
      if (bookingId) {
        flushOfflineGeoQueue(async (pings) => {
          for (const p of pings) {
            await fetch(`/api/tracking/${p.bookingId}/stream`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                lat: p.lat,
                lng: p.lng,
                speed: p.speed,
                heading: p.heading,
                accuracy: p.accuracy,
              }),
            }).catch(() => {})
          }
          return true
        }, bookingId)
      }
    }

    if (typeof window !== "undefined") {
      window.addEventListener("online", handleOnline)
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("online", handleOnline)
      }
      if (
        watchIdRef.current !== null &&
        typeof navigator !== "undefined" &&
        navigator.geolocation
      ) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [bookingId])

  return {
    isBroadcasting,
    lastPosition,
    error,
    start,
    stop,
    toggle,
  }
}
