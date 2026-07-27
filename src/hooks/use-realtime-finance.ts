/**
 * Severinno Marketplace SaaS — Realtime Finance Hook
 *
 * Connects the Socket.io realtime client to the React Query cache so that
 * when payment or booking events arrive, the three financial dashboards
 * (admin, provider, client) automatically refresh their data without
 * manual page reload or polling.
 *
 * Events subscribed:
 *   - `payment:confirmed` → invalidates all finance queries
 *   - `payment:refunded`  → invalidates all finance queries
 *   - `booking:created`   → invalidates provider & client finance queries
 *
 * Usage in any dashboard component:
 *   const { isConnected, status } = useRealtimeFinance()
 *
 * The returned `status` / `isConnected` can be passed to <RealtimeStatusBadge>
 * to render a live-connection indicator.
 */

'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRealtime, type ConnectionStatus } from './use-realtime'

/**
 * Call this hook inside any finance dashboard component (admin, provider, or
 * client). It subscribes to payment/booking events while the component is
 * mounted and invalidates the matching query keys so the UI refreshes.
 *
 * The hook is safe to call from multiple components simultaneously —
 * duplicate event listeners for the same event are handled by the singleton
 * socket, and `invalidateQueries` is idempotent.
 *
 * Returns the connection state from the underlying Socket.io client so
 * callers can render a live-status badge.
 */
export function useRealtimeFinance(): {
  isConnected: boolean
  status: ConnectionStatus
} {
  const queryClient = useQueryClient()
  const { isConnected, status, on } = useRealtime()

  useEffect(() => {
    if (!isConnected) return

    // ── Payment events ─────────────────────────────────────────────────
    // Both confirmation and refund change the financial summary, MRR,
    // monthly revenue, provider statements, and transaction history.
    const invalidateFinance = () => {
      // Admin dashboard: queryKey starts with ["admin", "finance", ...]
      queryClient.invalidateQueries({ queryKey: ['admin', 'finance'] })
      // Provider dashboard: queryKey starts with ["provider", "finance", ...]
      queryClient.invalidateQueries({ queryKey: ['provider', 'finance'] })
      // Client dashboard: queryKey starts with ["bookings", "CLIENT", "finance", ...]
      queryClient.invalidateQueries({ queryKey: ['bookings', 'CLIENT', 'finance'] })
    }

    const unsubPaymentConfirmed = on('payment:confirmed', invalidateFinance)
    const unsubPaymentRefunded = on('payment:refunded', invalidateFinance)

    // ── Booking events ─────────────────────────────────────────────────
    // A new booking might not affect payments directly, but will appear
    // in the provider and client transaction lists.
    const invalidateBookingFinance = () => {
      queryClient.invalidateQueries({ queryKey: ['provider', 'finance'] })
      queryClient.invalidateQueries({ queryKey: ['bookings', 'CLIENT', 'finance'] })
    }

    const unsubBookingCreated = on('booking:created', invalidateBookingFinance)

    // ── Cleanup ────────────────────────────────────────────────────────
    return () => {
      unsubPaymentConfirmed()
      unsubPaymentRefunded()
      unsubBookingCreated()
    }
  }, [isConnected, on, queryClient])

  return { isConnected, status }
}

export default useRealtimeFinance
