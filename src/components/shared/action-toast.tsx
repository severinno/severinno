"use client"

/**
 * ActionToast — listens for realtime notification events and shows
 * Sonner toasts with inline action buttons.
 *
 * This component should be rendered once in the global providers.
 * It subscribes to SSE/realtime events and auto-shows contextual toasts.
 */

import * as React from "react"
import { toast } from "sonner"
import { useRouter } from "next/navigation"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type NotificationAction = {
  label: string
  url: string
}

type RealtimeNotification = {
  id: string
  type: string
  title: string
  body?: string
  action?: NotificationAction
}

// ---------------------------------------------------------------------------
// Notification type → toast config mapping
// ---------------------------------------------------------------------------
const TOAST_CONFIG: Record<string, { emoji: string; defaultAction?: string }> = {
  NEW_QUOTE: { emoji: "📋", defaultAction: "/dashboard?tab=quotes" },
  QUOTE_RESPONSE: { emoji: "💬", defaultAction: "/dashboard?tab=quotes" },
  NEW_BOOKING: { emoji: "📅", defaultAction: "/dashboard?tab=bookings" },
  BOOKING_STATUS: { emoji: "🔄", defaultAction: "/dashboard?tab=bookings" },
  NEW_MESSAGE: { emoji: "💬", defaultAction: "/dashboard?tab=messages" },
  PAYMENT_RECEIVED: { emoji: "💰", defaultAction: "/dashboard?tab=finances" },
  NEW_REVIEW: { emoji: "⭐", defaultAction: "/dashboard?tab=reviews" },
  SERVICE_COMPLETED: { emoji: "✅", defaultAction: "/dashboard?tab=bookings" },
  IDENTITY_APPROVED: { emoji: "🛡️" },
  IDENTITY_REJECTED: { emoji: "⚠️" },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function ActionToastListener() {
  const router = useRouter()
  const shownRef = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    function handleNotification(event: CustomEvent<RealtimeNotification>) {
      const notification = event.detail
      if (!notification?.id) return

      // Prevent duplicate toasts for same notification
      if (shownRef.current.has(notification.id)) return
      shownRef.current.add(notification.id)

      // Keep set bounded
      if (shownRef.current.size > 100) {
        const first = shownRef.current.values().next().value
        if (first) shownRef.current.delete(first)
      }

      const config = TOAST_CONFIG[notification.type] ?? { emoji: "🔔" }
      const actionUrl = notification.action?.url ?? config.defaultAction
      const actionLabel = notification.action?.label ?? "Ver agora"

      if (actionUrl) {
        toast(`${config.emoji} ${notification.title}`, {
          description: notification.body,
          action: {
            label: actionLabel,
            onClick: () => router.push(actionUrl),
          },
          duration: 8000,
        })
      } else {
        toast(`${config.emoji} ${notification.title}`, {
          description: notification.body,
          duration: 5000,
        })
      }
    }

    // Listen for our custom realtime notification event
    window.addEventListener("severinno:notification", handleNotification as EventListener)

    return () => {
      window.removeEventListener("severinno:notification", handleNotification as EventListener)
    }
  }, [router])

  // This component renders nothing — it's a side-effect listener
  return null
}

/**
 * Utility to dispatch a notification event from anywhere.
 *
 * @example
 *   dispatchNotificationToast({
 *     id: "notif-123",
 *     type: "NEW_QUOTE",
 *     title: "Novo orçamento recebido",
 *     body: "João solicitou um orçamento para Limpeza",
 *     action: { label: "Ver orçamento", url: "/dashboard?tab=quotes" }
 *   })
 */
export function dispatchNotificationToast(notification: RealtimeNotification) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("severinno:notification", { detail: notification }))
  }
}

export default ActionToastListener
