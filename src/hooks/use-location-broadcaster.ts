"use client"

import * as React from "react"
import { toast } from "sonner"

export type BroadcasterOptions = {
  bookingId?: string | null
  intervalMs?: number
  onPositionUpdate?: (pos: {
    lat: number
    lng: number
    speed: number | null
    heading: number | null
  }) => void
}

export function useLocationBroadcaster(options?: BroadcasterOptions) {
  const bookingId = options?.bookingId
  const intervalMs = options?.intervalMs ?? 10000
  const onPositionUpdate = options?.onPositionUpdate

  const [isBroadcasting, setIsBroadcasting] = React.useState(false)
  const [lastPosition, setLastPosition] = React.useState<{ lat: number; lng: number } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const watchIdRef = React.useRef<number | null>(null)
  const lastSentRef = React.useRef<number>(0)

  const stop = React.useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    setIsBroadcasting(false)
  }, [])

  const sendPosition = React.useCallback(
    async (lat: number, lng: number, speed: number | null, heading: number | null) => {
      if (!bookingId) return
      try {
        const res = await fetch(`/api/tracking/${bookingId}/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lng, speed, heading }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          console.warn("[Broadcaster] Erro ao enviar posição:", data.error)
        }
      } catch (err) {
        console.warn("[Broadcaster] Falha de rede ao enviar posição:", err)
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

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, speed, heading } = pos.coords
        setLastPosition({ lat, lng })
        onPositionUpdate?.({ lat, lng, speed, heading })

        const now = Date.now()
        if (now - lastSentRef.current >= intervalMs) {
          lastSentRef.current = now
          sendPosition(lat, lng, speed, heading)
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
        maximumAge: 5000,
      },
    )
  }, [intervalMs, onPositionUpdate, sendPosition])

  const toggle = React.useCallback(() => {
    if (isBroadcasting) {
      stop()
    } else {
      start()
    }
  }, [isBroadcasting, start, stop])

  React.useEffect(() => {
    return () => {
      if (
        watchIdRef.current !== null &&
        typeof navigator !== "undefined" &&
        navigator.geolocation
      ) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [])

  return {
    isBroadcasting,
    lastPosition,
    error,
    start,
    stop,
    toggle,
  }
}
