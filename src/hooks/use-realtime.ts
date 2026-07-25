/**
 * Severinno Marketplace SaaS — Realtime client hook (Fase 1 / MVP)
 *
 * Wraps the singleton Socket.io client (`socketClient`) in a React hook.
 *
 * Usage:
 *   const { isConnected, join, sendMessage, ... } = useRealtime();
 *
 *   useEffect(() => {
 *     if (isConnected) join({ userId: '123', role: 'client' });
 *   }, [isConnected]);
 */

'use client'

import { useEffect, useState, useCallback } from 'react'
import socketClient, { type ConnectionStatus, type JoinPayload, type MessageSendPayload, type BookingUpdatePayload, type QuoteUpdatePayload, type TrackingPositionPayload, type EventHandler } from '@/lib/socket-client'

export type { ConnectionStatus, JoinPayload, MessageSendPayload, BookingUpdatePayload, QuoteUpdatePayload, TrackingPositionPayload }

export interface RealtimeMessage {
  id: string
  fromId: string
  toId: string
  content: string
  bookingId: string | null
  timestamp: string
}

export interface RealtimeNotification {
  id: string
  type: string
  forId: string
  fromId: string
  bookingId: string | null
  content: string
  timestamp: string
  read: boolean
}

export interface BookingUpdatedEvent {
  bookingId: string
  clientId: string
  providerId: string
  status: string
  timestamp: string
}

export interface QuoteUpdatedEvent {
  quoteId: string
  clientId: string
  providerId: string
  status: string
  timestamp: string
}

export interface TrackingPositionEvent {
  bookingId: string
  clientId: string
  lat: number
  lng: number
  timestamp: string
}

export interface UseRealtimeResult {
  isConnected: boolean
  status: ConnectionStatus
  join: (payload: JoinPayload) => Promise<boolean>
  sendMessage: (payload: MessageSendPayload) => void
  updateBooking: (payload: BookingUpdatePayload) => void
  updateQuote: (payload: QuoteUpdatePayload) => void
  sendTrackingPosition: (payload: TrackingPositionPayload) => void
  ping: () => Promise<{ pong: boolean; t: number } | null>
  emit: <T = unknown>(event: string, data?: T) => void
  on: <T = unknown>(event: string, handler: EventHandler<T>) => () => void
  off: (event: string, handler?: (...args: unknown[]) => void) => void
  disconnect: () => void
}

export function useRealtime(): UseRealtimeResult {
  const [isConnected, setIsConnected] = useState(() => {
    if (typeof window === 'undefined') return false
    return socketClient.connected
  })
  const [status, setStatus] = useState<ConnectionStatus>(() => {
    if (typeof window === 'undefined') return 'connecting'
    return socketClient.status
  })

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Connect on mount
    socketClient.connect()

    // Listen for status changes
    const unsub = socketClient.onStatusChange((newStatus) => {
      setStatus(newStatus)
      setIsConnected(newStatus === 'connected')
    })

    return () => {
      unsub()
      // Don't disconnect on unmount — singleton survives
    }
  }, [])

  const join = useCallback((payload: JoinPayload) => {
    return socketClient.join(payload)
  }, [])

  const sendMessage = useCallback((payload: MessageSendPayload) => {
    socketClient.sendMessage(payload)
  }, [])

  const updateBooking = useCallback((payload: BookingUpdatePayload) => {
    socketClient.updateBooking(payload)
  }, [])

  const updateQuote = useCallback((payload: QuoteUpdatePayload) => {
    socketClient.updateQuote(payload)
  }, [])

  const sendTrackingPosition = useCallback((payload: TrackingPositionPayload) => {
    socketClient.sendTrackingPosition(payload)
  }, [])

  const ping = useCallback(() => {
    return socketClient.ping()
  }, [])

  const emit = useCallback(<T = unknown>(event: string, data?: T) => {
    socketClient.emit(event, data)
  }, [])

  const on = useCallback(<T = unknown>(event: string, handler: EventHandler<T>) => {
    return socketClient.on(event, handler)
  }, [])

  const off = useCallback((event: string, handler?: (...args: unknown[]) => void) => {
    socketClient.off(event, handler)
  }, [])

  const disconnect = useCallback(() => {
    socketClient.disconnect()
    setIsConnected(false)
    setStatus('disconnected')
  }, [])

  return {
    isConnected,
    status,
    join,
    sendMessage,
    updateBooking,
    updateQuote,
    sendTrackingPosition,
    ping,
    emit,
    on,
    off,
    disconnect,
  }
}

export default useRealtime
