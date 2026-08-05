"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRealtime } from "./use-realtime"

export function useGeoTracking() {
  const { sendTrackingPosition, isConnected } = useRealtime()
  const [isTracking, setIsTracking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentPosition, setCurrentPosition] = useState<[number, number] | null>(null)

  const watchIdRef = useRef<number | null>(null)
  const lastEmitTimeRef = useRef<number>(0)
  const trackingDataRef = useRef<{ bookingId: string; clientId: string } | null>(null)

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    setIsTracking(false)
    trackingDataRef.current = null
  }, [])

  const startTracking = useCallback(
    (bookingId: string, clientId: string) => {
      if (typeof window === "undefined" || !navigator.geolocation) {
        setError("Geolocalização não suportada neste dispositivo.")
        return
      }

      stopTracking()
      setError(null)
      setIsTracking(true)
      trackingDataRef.current = { bookingId, clientId }

      const successCallback = (position: GeolocationPosition) => {
        const { latitude, longitude } = position.coords
        setCurrentPosition([longitude, latitude])

        const now = Date.now()
        // Throttle emission to once every 5 seconds
        if (now - lastEmitTimeRef.current >= 5000) {
          if (trackingDataRef.current && isConnected) {
            sendTrackingPosition({
              bookingId: trackingDataRef.current.bookingId,
              clientId: trackingDataRef.current.clientId,
              lat: latitude,
              lng: longitude,
            })
            lastEmitTimeRef.current = now
          }
        }
      }

      const errorCallback = (err: GeolocationPositionError) => {
        let msg = "Erro ao acessar localização."
        if (err.code === err.PERMISSION_DENIED) {
          msg = "Permissão de localização negada pelo usuário."
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          msg = "Posição de localização indisponível."
        } else if (err.code === err.TIMEOUT) {
          msg = "Tempo limite atingido ao obter localização."
        }
        setError(msg)
        stopTracking()
      }

      watchIdRef.current = navigator.geolocation.watchPosition(successCallback, errorCallback, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      })
    },
    [sendTrackingPosition, isConnected, stopTracking],
  )

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [])

  return {
    isTracking,
    error,
    currentPosition,
    startTracking,
    stopTracking,
  }
}
