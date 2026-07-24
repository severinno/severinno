"use client"

import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useRealtime } from "@/hooks/use-realtime"
import { useAuthStore } from "@/store/auth"
import { BOOKING_STATUS_LABELS } from "@/lib/constants"
import type { BookingStatus } from "@/lib/constants"

/**
 * RealtimeProvider — wraps the app and auto-connects/disconnects
 * the WebSocket based on the user's authentication state.
 *
 * Listens for real-time events from the Socket.io server and:
 *   - Shows toast notifications to the user
 *   - Invalidates React Query caches for instant UI updates
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const qc = useQueryClient()
  const { isConnected, join, on, off } = useRealtime()

  // Join user's room when connected + authenticated
  React.useEffect(() => {
    if (isConnected && user?.id && user?.role) {
      join({ userId: user.id, role: user.role })
    }
  }, [isConnected, user?.id, user?.role, join])

  // Listen for real-time events
  React.useEffect(() => {
    if (!isConnected) return

    const unsubNotif = on<{
      id: string
      type: string
      title?: string
      body?: string
      timestamp: string
    }>("notification:new", (data) => {
      toast(data.title ?? "Nova notificação", {
        description: data.body,
        duration: 5000,
      })
      qc.invalidateQueries({ queryKey: ["notifications"] })
    })

    const unsubBooking = on<{
      bookingId: string
      status: string
      timestamp: string
    }>("booking:updated", (data) => {
      // Show toast with booking status
      const statusLabel = BOOKING_STATUS_LABELS[data.status as BookingStatus] ?? data.status
      toast(`Agendamento ${statusLabel.toLowerCase()}`, {
        description: `O status do agendamento foi atualizado para ${statusLabel}.`,
        duration: 5000,
      })
      // Invalidate all related queries
      qc.invalidateQueries({ queryKey: ["bookings"] })
      qc.invalidateQueries({ queryKey: ["provider", "agenda"] })
      qc.invalidateQueries({ queryKey: ["provider", "dashboard"] })
      qc.invalidateQueries({ queryKey: ["notifications"] })
      qc.invalidateQueries({ queryKey: ["admin", "stats"] })
    })

    const unsubQuote = on<{
      quoteId: string
      status: string
      timestamp: string
    }>("quote:updated", () => {
      toast("Orçamento atualizado", {
        description: "Seu orçamento recebeu uma resposta.",
        duration: 5000,
      })
      qc.invalidateQueries({ queryKey: ["quotes"] })
      qc.invalidateQueries({ queryKey: ["provider", "panel", "quotes-badges"] })
      qc.invalidateQueries({ queryKey: ["notifications"] })
    })

    const unsubMessage = on<{
      fromId: string
      toId: string
      content: string
    }>("message:new", (data) => {
      const preview = data.content.length > 60
        ? data.content.slice(0, 60) + "…"
        : data.content
      toast("Nova mensagem", {
        description: preview,
        duration: 5000,
      })
      qc.invalidateQueries({ queryKey: ["messages"] })
      qc.invalidateQueries({ queryKey: ["notifications"] })
    })

    return () => {
      unsubNotif()
      unsubBooking()
      unsubQuote()
      unsubMessage()
    }
  }, [isConnected, on, off, qc])

  return <>{children}</>
}
