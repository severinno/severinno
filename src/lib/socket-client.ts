/**
 * Socket.io singleton client — extracted from use-realtime.ts.
 *
 * Manages a single Socket.io connection to the realtime mini-service
 * (port 3003) through the Caddy gateway.
 *
 * Usage:
 *   import socketClient from "@/lib/socket-client";
 *   socketClient.connect();
 *   socketClient.join({ userId: "123", role: "CLIENT" });
 */

import { io, Socket } from "socket.io-client"

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "error"

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

export type EventHandler<T = unknown> = (data: T) => void

type StatusListener = (status: ConnectionStatus) => void

class SocketClient {
  private _socket: Socket | null = null
  private _status: ConnectionStatus = "disconnected"
  private _statusListeners = new Set<StatusListener>()
  /** Tracks listener registrations so `on` returns a working unsubscribe */
  private _handlerRefs = new Map<string, Array<{ wrapped: (...args: unknown[]) => void; raw: EventHandler }>>()

  /** Get current connection status */
  get status(): ConnectionStatus {
    return this._status
  }

  /** Whether the socket is currently connected */
  get connected(): boolean {
    return this._socket?.connected ?? false
  }

  /** Subscribe to status changes. Returns unsubscribe function. */
  onStatusChange(listener: StatusListener): () => void {
    this._statusListeners.add(listener)
    return () => {
      this._statusListeners.delete(listener)
    }
  }

  private _setStatus(status: ConnectionStatus) {
    this._status = status
    this._statusListeners.forEach((fn) => fn(status))
  }

  /**
   * Connect to the realtime mini-service.
   * Safe to call multiple times — returns existing socket if already connected.
   */
  connect(): Socket {
    if (this._socket?.connected) return this._socket
    if (this._socket) {
      this._socket.connect()
      return this._socket
    }

    const s = io("/?XTransformPort=3003", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    })

    s.on("connect", () => this._setStatus("connected"))
    s.on("disconnect", () => this._setStatus("disconnected"))
    s.on("connect_error", () => this._setStatus("error"))
    s.on("reconnect_attempt", () => this._setStatus("reconnecting"))
    s.on("reconnect", () => this._setStatus("connected"))

    this._socket = s
    this._setStatus("connecting")
    return s
  }

  /** Disconnect and clean up */
  disconnect(): void {
    this._handlerRefs.clear()
    if (this._socket) {
      this._socket.removeAllListeners()
      this._socket.disconnect()
      this._socket = null
    }
    this._setStatus("disconnected")
  }

  /** Join a user room on the server */
  join(payload: JoinPayload): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (!this._socket?.connected) return resolve(false)
      this._socket.emit("join", payload, (res: { ok: boolean }) =>
        resolve(!!res?.ok),
      )
    })
  }

  /** Send a chat message */
  sendMessage(payload: MessageSendPayload): void {
    this._socket?.emit("message:send", payload)
  }

  /** Notify clients of a booking status update */
  updateBooking(payload: BookingUpdatePayload): void {
    this._socket?.emit("booking:update", payload)
  }

  /** Notify clients of a quote status update */
  updateQuote(payload: QuoteUpdatePayload): void {
    this._socket?.emit("quote:update", payload)
  }

  /** Send a GPS tracking position update */
  sendTrackingPosition(payload: TrackingPositionPayload): void {
    this._socket?.emit("tracking:position", payload)
  }

  /** Ping the server to check connectivity */
  ping(): Promise<{ pong: boolean; t: number } | null> {
    return new Promise((resolve) => {
      if (!this._socket?.connected) return resolve(null)
      this._socket.emit("ping", (res: { pong: boolean; t: number }) =>
        resolve(res ?? null),
      )
    })
  }

  /** Emit a generic event */
  emit<T = unknown>(event: string, data?: T): void {
    this._socket?.emit(event, data)
  }

  /**
   * Listen for an event. Returns an unsubscribe function.
   * Tracks the handler internally so unsubscribe works reliably.
   */
  on<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    if (!this._socket) return () => {}

    const wrapped = (data: T) => handler(data)
    this._socket.on(event as string, wrapped as (...args: unknown[]) => void)

    // Track for proper cleanup
    const refs = this._handlerRefs.get(event) ?? []
    refs.push({ wrapped: wrapped as (...args: unknown[]) => void, raw: handler as EventHandler })
    this._handlerRefs.set(event, refs)

    return () => {
      this._socket?.off(event as string, wrapped as (...args: unknown[]) => void)
      const existing = this._handlerRefs.get(event) ?? []
      this._handlerRefs.set(
        event,
        existing.filter((r) => r.raw !== handler),
      )
    }
  }

  /** Remove a listener */
  off(event: string, handler?: (...args: unknown[]) => void): void {
    if (handler) {
      this._socket?.off(event, handler as (...args: unknown[]) => void)
    } else {
      this._socket?.off(event)
    }
  }
}

/** Singleton instance */
const socketClient = new SocketClient()
export default socketClient
