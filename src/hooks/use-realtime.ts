/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Severinno Marketplace SaaS — Realtime client hook (Fase 1 / MVP)
 *
 * Singleton Socket.io client that connects to the realtime mini-service
 * (port 3003) through the Caddy gateway. The gateway selects the upstream
 * service by the `?XTransformPort=3003` query string and forwards to path `/`.
 *
 *   io("/?XTransformPort=3003")   <- NEVER put the port in the URL.
 *
 * Usage:
 *   const { isConnected, join, sendMessage, ... } = useRealtime();
 *
 *   useEffect(() => {
 *     if (isConnected) join({ userId: '123', role: 'client' });
 *   }, [isConnected]);
 */

"use client"

import { useEffect, useMemo, useState } from "react"
import { io, Socket } from "socket.io-client"

// ---------- Types ----------
export type ConnectionStatus =
  "connecting" | "connected" | "disconnected" | "reconnecting" | "error"

export interface JoinPayload {
  userId: string
  role: string
}

export interface MessageSendPayload {
  fromId: string
  toId: string
  content: string
  bookingId?: string
}

export interface BookingUpdatePayload {
  bookingId: string
  clientId: string
  providerId: string
  status: string
}

export interface QuoteUpdatePayload {
  quoteId: string
  clientId: string
  providerId: string
  status: string
}

export interface TrackingPositionPayload {
  bookingId: string
  clientId: string
  lat: number
  lng: number
}

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

// ---------- Singleton socket ----------
// Only build it in the browser. SSR returns null.
let socketRef: Socket | null = null

/**
 * Resolve the Socket.io server URL:
 *  - NEXT_PUBLIC_REALTIME_URL set (dev/e2e) → connect directly to the
 *    realtime mini-service (e.g. http://localhost:3003).
 *  - otherwise → Caddy gateway picks the upstream from `XTransformPort`.
 *    The path MUST be "/" (see Caddyfile + examples/websocket/*).
 */
function getSocketUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_REALTIME_URL
  if (explicit) return explicit
  return "/?XTransformPort=3003"
}

function getSocket(): Socket | null {
  if (typeof window === "undefined") return null
  if (socketRef) return socketRef

  socketRef = io(getSocketUrl(), {
    transports: ["websocket", "polling"],
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  })
  return socketRef
}

// ---------- Hook ----------
export interface UseRealtimeResult {
  isConnected: boolean
  status: ConnectionStatus
  // helpers
  join: (payload: JoinPayload) => Promise<boolean>
  sendMessage: (payload: MessageSendPayload) => void
  updateBooking: (payload: BookingUpdatePayload) => void
  updateQuote: (payload: QuoteUpdatePayload) => void
  sendTrackingPosition: (payload: TrackingPositionPayload) => void
  ping: () => Promise<{ pong: boolean; t: number } | null>
  // generic emit + listener helpers
  emit: <T = unknown>(event: string, data?: T) => void
  on: <T = unknown>(event: string, handler: (data: T) => void) => () => void
  off: (event: string, handler?: (...args: unknown[]) => void) => void
  disconnect: () => void
}

export function useRealtime(): UseRealtimeResult {
  const [isConnected, setIsConnected] = useState(false)
  const [status, setStatus] = useState<ConnectionStatus>("connecting")

  useEffect(() => {
    const s = getSocket()
    if (!s) return // SSR guard

    const onConnect = () => {
      setIsConnected(true)
      setStatus("connected")
    }
    const onDisconnect = () => {
      setIsConnected(false)
      setStatus("disconnected")
    }
    const onConnectError = () => {
      setIsConnected(false)
      setStatus("error")
    }
    const onReconnectAttempt = () => {
      setStatus("reconnecting")
    }
    const onReconnect = () => {
      setIsConnected(true)
      setStatus("connected")
    }
    // Sync component state with the singleton socket's current status
    // (e.g. when reused across mounts / hot reload). Wrapped in a function so
    // the sync isn't a direct setState call in the effect body.
    const syncFromSocket = () => {
      if (s.connected) {
        setIsConnected(true)
        setStatus("connected")
      } else if (!s.active) {
        setStatus("connecting")
      }
    }

    s.on("connect", onConnect)
    s.on("disconnect", onDisconnect)
    s.on("connect_error", onConnectError)
    s.on("reconnect_attempt", onReconnectAttempt)
    s.on("reconnect", onReconnect)

    syncFromSocket()

    return () => {
      s.off("connect", onConnect)
      s.off("disconnect", onDisconnect)
      s.off("connect_error", onConnectError)
      s.off("reconnect_attempt", onReconnectAttempt)
      s.off("reconnect", onReconnect)
    }
  }, [])

  // ---------- Helpers ----------
  const join = useMemo<UseRealtimeResult["join"]>(
    () => (payload: JoinPayload) =>
      new Promise<boolean>((resolve) => {
        const s = socketRef
        if (!s || !s.connected) return resolve(false)
        s.emit("join", payload, (res: { ok: boolean }) => resolve(!!res?.ok))
      }),
    [],
  )

  const sendMessage = useMemo<UseRealtimeResult["sendMessage"]>(
    () => (payload: MessageSendPayload) => {
      socketRef?.emit("message:send", payload)
    },
    [],
  )

  const updateBooking = useMemo<UseRealtimeResult["updateBooking"]>(
    () => (payload: BookingUpdatePayload) => {
      socketRef?.emit("booking:update", payload)
    },
    [],
  )

  const updateQuote = useMemo<UseRealtimeResult["updateQuote"]>(
    () => (payload: QuoteUpdatePayload) => {
      socketRef?.emit("quote:update", payload)
    },
    [],
  )

  const sendTrackingPosition = useMemo<UseRealtimeResult["sendTrackingPosition"]>(
    () => (payload: TrackingPositionPayload) => {
      socketRef?.emit("tracking:position", payload)
    },
    [],
  )

  const ping = useMemo<UseRealtimeResult["ping"]>(
    () => () =>
      new Promise<{ pong: boolean; t: number } | null>((resolve) => {
        const s = socketRef
        if (!s || !s.connected) return resolve(null)
        s.emit("ping", (res: { pong: boolean; t: number }) => resolve(res ?? null))
      }),
    [],
  )

  const emit = useMemo<UseRealtimeResult["emit"]>(
    () => (event: string, data?: unknown) => {
      socketRef?.emit(event, data as any)
    },
    [],
  )

  const on = useMemo<UseRealtimeResult["on"]>(
    () =>
      <T>(event: string, handler: (data: T) => void) => {
        const s = socketRef
        if (!s) return () => {}
        const wrapped = (data: T) => handler(data)
        s.on(event, wrapped as any)
        return () => {
          s.off(event, wrapped as any)
        }
      },
    [],
  )

  const off = useMemo<UseRealtimeResult["off"]>(
    () => (event: string, handler?: (...args: unknown[]) => void) => {
      if (handler) socketRef?.off(event, handler as any)
      else socketRef?.off(event)
    },
    [],
  )

  const disconnect = useMemo<UseRealtimeResult["disconnect"]>(
    () => () => {
      const s = socketRef
      if (s) {
        s.disconnect()
        socketRef = null
        setIsConnected(false)
        setStatus("disconnected")
      }
    },
    [],
  )

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
