"use client"

import * as React from "react"
import {
  getOfflineBookings,
  saveOfflineBookings,
  updateOfflineBookingStatus,
  type OfflineBooking,
} from "@/lib/offline-bookings-store"

export interface UseOfflineBookingsReturn {
  bookings: OfflineBooking[]
  isLoading: boolean
  isOffline: boolean
  syncWithServer: () => Promise<void>
  updateStatus: (id: string, status: OfflineBooking["status"]) => Promise<void>
  refresh: () => Promise<void>
}

/**
 * Hook para gerenciar agendamentos no modo offline e sincronizar com o servidor quando reconectado.
 */
export function useOfflineBookings(): UseOfflineBookingsReturn {
  const [bookings, setBookings] = React.useState<OfflineBooking[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isOffline, setIsOffline] = React.useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  )

  const loadFromLocal = React.useCallback(async () => {
    try {
      const items = await getOfflineBookings()
      setBookings(items)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const syncWithServer = React.useCallback(async () => {
    if (typeof window === "undefined" || !navigator.onLine) {
      await loadFromLocal()
      return
    }

    try {
      setIsLoading(true)
      const res = await fetch("/api/bookings/active", {
        headers: { Accept: "application/json" },
      })
      if (res.ok) {
        const data = (await res.json()) as { bookings?: OfflineBooking[] }
        if (Array.isArray(data.bookings)) {
          await saveOfflineBookings(data.bookings)
          setBookings(data.bookings)
          return
        }
      }
    } catch {
      // Falha de rede: recarrega do armazenamento local
    } finally {
      await loadFromLocal()
    }
  }, [loadFromLocal])

  React.useEffect(() => {
    void loadFromLocal()

    const handleOnline = () => {
      setIsOffline(false)
      void syncWithServer()
    }

    const handleOffline = () => {
      setIsOffline(true)
      void loadFromLocal()
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [loadFromLocal, syncWithServer])

  const handleUpdateStatus = React.useCallback(
    async (id: string, status: OfflineBooking["status"]) => {
      await updateOfflineBookingStatus(id, status)
      await loadFromLocal()
    },
    [loadFromLocal],
  )

  return {
    bookings,
    isLoading,
    isOffline,
    syncWithServer,
    updateStatus: handleUpdateStatus,
    refresh: loadFromLocal,
  }
}
