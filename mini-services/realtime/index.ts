// Severinno Marketplace SaaS — Realtime Mini-Service (Fase 1 / MVP)
// Socket.io server on port 3003, path "/" (required by Caddy gateway).
// The gateway selects this service via the `?XTransformPort=3003` query
// param sent by the frontend client (see src/hooks/use-realtime.ts).

import { createServer } from 'http'
import { Server, Socket } from 'socket.io'

const PORT = 3003

// Allowed CORS origins — restrict to known domains
const ALLOWED_ORIGINS = [
  // Development
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  // Production (exact and subdomains)
  'https://severinno.com.br',
  'https://www.severinno.com.br',
]

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false
  if (ALLOWED_ORIGINS.includes(origin)) return true
  // Wildcard subdomain check: *.severinno.com.br
  if (/^https:\/\/[a-zA-Z0-9-]+\.severinno\.com\.br$/.test(origin)) return true
  return false
}

const httpServer = createServer()
const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request to the correct port
  path: '/',
  cors: {
    // Socket.io v4 uses the cors package internally, which expects the
    // (origin, callback) signature — NOT a synchronous boolean return.
    origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      callback(null, isOriginAllowed(origin))
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// ---------- Types ----------
interface JoinPayload {
  userId: string
  role: string
}

interface MessageSendPayload {
  fromId: string
  toId: string
  content: string
  bookingId?: string
}

interface BookingUpdatePayload {
  bookingId: string
  clientId: string
  providerId: string
  status: string
}

interface QuoteUpdatePayload {
  quoteId: string
  clientId: string
  providerId: string
  status: string
}

interface TrackingPositionPayload {
  bookingId: string
  clientId: string
  lat: number
  lng: number
}

// ---------- Helpers ----------
const generateId = () => Math.random().toString(36).slice(2, 11)
const nowTimestamp = () => new Date().toISOString()

// ---------- Connection handling ----------
io.on('connection', (socket: Socket) => {
  console.log(`[realtime] socket connected: ${socket.id}`)

  // join { userId, role } -> join rooms user:{userId} and role:{role}
  socket.on('join', (payload: JoinPayload, ack?: (res: { ok: boolean }) => void) => {
    try {
      const { userId, role } = payload || ({} as JoinPayload)
      if (!userId || !role) {
        ack?.({ ok: false } as any)
        return
      }
      socket.join(`user:${userId}`)
      socket.join(`role:${role}`)
      socket.data.userId = userId
      socket.data.role = role
      console.log(`[realtime] ${socket.id} joined user:${userId} role:${role}`)
      ack?.({ ok: true })
    } catch (err) {
      console.error('[realtime] join error:', err)
      ack?.({ ok: false } as any)
    }
  })

  // message:send { fromId, toId, content, bookingId? }
  // -> emit message:new (with id + timestamp) and notification:new to user:{toId}
  socket.on('message:send', (payload: MessageSendPayload) => {
    try {
      const { fromId, toId, content, bookingId } = payload || ({} as MessageSendPayload)
      if (!fromId || !toId || !content) return
      const message = {
        id: generateId(),
        fromId,
        toId,
        content,
        bookingId: bookingId ?? null,
        timestamp: nowTimestamp(),
      }
      io.to(`user:${toId}`).emit('message:new', message)
      io.to(`user:${toId}`).emit('notification:new', {
        id: generateId(),
        type: 'message',
        forId: toId,
        fromId,
        bookingId: bookingId ?? null,
        content,
        timestamp: nowTimestamp(),
        read: false,
      })
      console.log(`[realtime] message ${fromId} -> ${toId}`)
    } catch (err) {
      console.error('[realtime] message:send error:', err)
    }
  })

  // booking:update { bookingId, clientId, providerId, status }
  // -> emit booking:updated to both user:{clientId} and user:{providerId}
  socket.on('booking:update', (payload: BookingUpdatePayload) => {
    try {
      const { bookingId, clientId, providerId, status } = payload || ({} as BookingUpdatePayload)
      if (!bookingId || !clientId || !providerId) return
      const evt = {
        bookingId,
        clientId,
        providerId,
        status,
        timestamp: nowTimestamp(),
      }
      io.to(`user:${clientId}`).emit('booking:updated', evt)
      io.to(`user:${providerId}`).emit('booking:updated', evt)
      console.log(`[realtime] booking:update ${bookingId} -> ${status}`)
    } catch (err) {
      console.error('[realtime] booking:update error:', err)
    }
  })

  // quote:update { quoteId, clientId, providerId, status }
  // -> emit quote:updated to both user:{clientId} and user:{providerId}
  socket.on('quote:update', (payload: QuoteUpdatePayload) => {
    try {
      const { quoteId, clientId, providerId, status } = payload || ({} as QuoteUpdatePayload)
      if (!quoteId || !clientId || !providerId) return
      const evt = {
        quoteId,
        clientId,
        providerId,
        status,
        timestamp: nowTimestamp(),
      }
      io.to(`user:${clientId}`).emit('quote:updated', evt)
      io.to(`user:${providerId}`).emit('quote:updated', evt)
      console.log(`[realtime] quote:update ${quoteId} -> ${status}`)
    } catch (err) {
      console.error('[realtime] quote:update error:', err)
    }
  })

  // tracking:position { bookingId, clientId, lat, lng }
  // -> emit tracking:position to user:{clientId} (delivery tracking)
  socket.on('tracking:position', (payload: TrackingPositionPayload) => {
    try {
      const { bookingId, clientId, lat, lng } = payload || ({} as TrackingPositionPayload)
      if (!bookingId || !clientId || typeof lat !== 'number' || typeof lng !== 'number') return
      const evt = {
        bookingId,
        clientId,
        lat,
        lng,
        timestamp: nowTimestamp(),
      }
      io.to(`user:${clientId}`).emit('tracking:position', evt)
    } catch (err) {
      console.error('[realtime] tracking:position error:', err)
    }
  })

  // ping -> ack { pong: true, t: Date.now() }
  socket.on('ping', (_data: unknown, ack?: (res: { pong: boolean; t: number }) => void) => {
    ack?.({ pong: true, t: Date.now() })
  })

  socket.on('disconnect', (reason: string) => {
    console.log(`[realtime] socket disconnected: ${socket.id} (${reason})`)
  })

  socket.on('error', (err: unknown) => {
    console.error(`[realtime] socket error (${socket.id}):`, err)
  })
})

httpServer.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`)
})

// ---------- Graceful shutdown ----------
let shuttingDown = false
const shutdown = (signal: string) => {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[realtime] received ${signal}, shutting down...`)
  // Close all connected sockets first
  io.disconnectSockets(true)
  io.close(() => {
    httpServer.close(() => {
      console.log('[realtime] server closed')
      process.exit(0)
    })
  })
  // Hard exit after 5s as a safety net
  setTimeout(() => {
    console.warn('[realtime] forced exit after timeout')
    process.exit(1)
  }, 5000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
