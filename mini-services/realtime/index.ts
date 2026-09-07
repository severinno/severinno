// Severinno Marketplace SaaS — Realtime Mini-Service (Fase 1 / MVP)
// Socket.io server on port 3003, path "/" (required by Caddy gateway).
// The gateway selects this service via the `?XTransformPort=3003` query
// param sent by the frontend client (see src/hooks/use-realtime.ts).

import { createServer } from "http"
import { Server, Socket } from "socket.io"
import { createAdapter } from "@socket.io/redis-adapter"
import { Redis } from "ioredis"
import { randomUUID } from "crypto"

const PORT = 3003

// Allowed CORS origins — restrict to known domains
const ALLOWED_ORIGINS = [
  // Development
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  // Production (exact and subdomains)
  "https://severinno.com.br",
  "https://www.severinno.com.br",
]

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false
  if (ALLOWED_ORIGINS.includes(origin)) return true
  // Wildcard subdomain check: *.severinno.com.br
  if (/^https:\/\/[a-zA-Z0-9-]+\.severinno\.com\.br$/.test(origin)) return true
  return false
}

const httpServer = createServer()

// Engine created manually (no auto-attach) so /health and /emit can share
// the same HTTP port. engine.io's prefix check (path "/") claims EVERY URL,
// so with the default attach() our HTTP endpoints would never be reachable.
const engine = new EngineServer({
  path: "/",
  pingTimeout: 60000,
  pingInterval: 25000,
  cors: {
    // Socket.io v4 / engine.io v6 use the cors package internally, which
    // expects the (origin, callback) signature — NOT a synchronous boolean.
    origin: function (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) {
      callback(null, isOriginAllowed(origin))
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
})

const io = new Server({ path: "/" })
io.bind(engine)

// Redis pub/sub adapter — enables horizontal scaling across replicas.
// REDIS_URL is already injected by docker-compose (base + prod).
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379"

const pubClient = new Redis(REDIS_URL, { maxRetriesPerRequest: null })
const subClient = pubClient.duplicate()

io.adapter(createAdapter(pubClient, subClient))

pubClient.on("ready", () => console.log("[realtime] redis adapter connected"))
pubClient.on("error", (err) => console.error("[realtime] redis adapter error:", err))
subClient.on("error", (err) => console.error("[realtime] redis sub error:", err))

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
const generateId = () => randomUUID()
const nowTimestamp = () => new Date().toISOString()

// ---------- Shared emit logic (socket listeners + HTTP /emit) ----------
function handleMessageSend(payload: MessageSendPayload): void {
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
  io.to(`user:${toId}`).emit("message:new", message)
  io.to(`user:${toId}`).emit("notification:new", {
    id: generateId(),
    type: "message",
    forId: toId,
    fromId,
    bookingId: bookingId ?? null,
    content,
    timestamp: nowTimestamp(),
    read: false,
  })
  console.log(`[realtime] message ${fromId} -> ${toId}`)
}

function handleBookingUpdate(payload: BookingUpdatePayload): void {
  const { bookingId, clientId, providerId, status } = payload || ({} as BookingUpdatePayload)
  if (!bookingId || !clientId || !providerId) return
  const evt = {
    bookingId,
    clientId,
    providerId,
    status,
    timestamp: nowTimestamp(),
  }
  io.to(`user:${clientId}`).emit("booking:updated", evt)
  io.to(`user:${providerId}`).emit("booking:updated", evt)
  console.log(`[realtime] booking:update ${bookingId} -> ${status}`)
}

function handleQuoteUpdate(payload: QuoteUpdatePayload): void {
  const { quoteId, clientId, providerId, status } = payload || ({} as QuoteUpdatePayload)
  if (!quoteId || !clientId || !providerId) return
  const evt = {
    quoteId,
    clientId,
    providerId,
    status,
    timestamp: nowTimestamp(),
  }
  io.to(`user:${clientId}`).emit("quote:updated", evt)
  io.to(`user:${providerId}`).emit("quote:updated", evt)
  console.log(`[realtime] quote:update ${quoteId} -> ${status}`)
}

function handleTrackingPosition(payload: TrackingPositionPayload): void {
  const { bookingId, clientId, lat, lng } = payload || ({} as TrackingPositionPayload)
  if (!bookingId || !clientId || typeof lat !== "number" || typeof lng !== "number") return
  const evt = {
    bookingId,
    clientId,
    lat,
    lng,
    timestamp: nowTimestamp(),
  }
  io.to(`user:${clientId}`).emit("tracking:position", evt)
  console.log(`[realtime] tracking:position ${bookingId} (${lat},${lng})`)
}

function handleNotificationNew(payload: { toId: string; notification?: unknown }): void {
  const { toId, notification } = payload || {}
  if (!toId) return
  io.to(`user:${toId}`).emit("notification:new", notification ?? {})
  console.log(`[realtime] notification:new -> user:${toId}`)
}

// ---------- Connection handling ----------
io.on("connection", (socket: Socket) => {
  console.log(`[realtime] socket connected: ${socket.id}`)

  // join { userId, role } -> join rooms user:{userId} and role:{role}
  socket.on("join", (payload: JoinPayload, ack?: (res: { ok: boolean }) => void) => {
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
      console.error("[realtime] join error:", err)
      ack?.({ ok: false } as any)
    }
  })

  // message:send { fromId, toId, content, bookingId? }
  // -> emit message:new (with id + timestamp) and notification:new to user:{toId}
  socket.on("message:send", (payload: MessageSendPayload) => {
    try {
      handleMessageSend(payload)
    } catch (err) {
      console.error("[realtime] message:send error:", err)
    }
  })

  // booking:update { bookingId, clientId, providerId, status }
  // -> emit booking:updated to both user:{clientId} and user:{providerId}
  socket.on("booking:update", (payload: BookingUpdatePayload) => {
    try {
      handleBookingUpdate(payload)
    } catch (err) {
      console.error("[realtime] booking:update error:", err)
    }
  })

  // quote:update { quoteId, clientId, providerId, status }
  // -> emit quote:updated to both user:{clientId} and user:{providerId}
  socket.on("quote:update", (payload: QuoteUpdatePayload) => {
    try {
      handleQuoteUpdate(payload)
    } catch (err) {
      console.error("[realtime] quote:update error:", err)
    }
  })

  // tracking:position { bookingId, clientId, lat, lng }
  // -> emit tracking:position to user:{clientId} (delivery tracking)
  socket.on("tracking:position", (payload: TrackingPositionPayload) => {
    try {
      handleTrackingPosition(payload)
    } catch (err) {
      console.error("[realtime] tracking:position error:", err)
    }
  })

  // ping -> ack { pong: true, t: Date.now() }
  socket.on("ping", (_data: unknown, ack?: (res: { pong: boolean; t: number }) => void) => {
    ack?.({ pong: true, t: Date.now() })
  })

  socket.on("disconnect", (reason: string) => {
    console.log(`[realtime] socket disconnected: ${socket.id} (${reason})`)
  })

  socket.on("error", (err: unknown) => {
    console.error(`[realtime] socket error (${socket.id}):`, err)
  })
})

// ---------- HTTP routing (admin endpoints + socket.io delegation) ----------
// GET  /health -> {"status":"ok"}
// POST /emit   -> { event, data } — server-side bridge used by
//                 src/lib/realtime-client.ts (Next.js app server)
// Every other request is delegated to engine.io (socket.io handshakes).
httpServer.on("request", (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost")

  if (url.pathname === "/health" && req.method === "GET") {
    const clientsCount = io.engine ? io.engine.clientsCount : 0
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(
      JSON.stringify({
        status: "ok",
        uptime: process.uptime(),
        connections: clientsCount,
        timestamp: new Date().toISOString(),
      }),
    )
    return
  }

  if (url.pathname === "/metrics" && req.method === "GET") {
    const clientsCount = io.engine ? io.engine.clientsCount : 0
    const rooms = io.sockets.adapter.rooms
    const roomsList = Array.from(rooms.entries())
      .filter(([name]) => name.startsWith("user:") || name.startsWith("role:"))
      .map(([name, sockets]) => ({ room: name, clients: sockets.size }))
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(
      JSON.stringify({
        connections: clientsCount,
        rooms: roomsList,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      }),
    )
    return
  }

  if (url.pathname === "/emit" && req.method === "POST") {
    // Authenticate internal API calls via x-api-key header
    const emitApiKey = process.env.REALTIME_EMIT_API_KEY
    if (emitApiKey) {
      const providedKey = req.headers["x-api-key"]
      if (providedKey !== emitApiKey) {
        res.writeHead(401, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: false, error: "unauthorized" }))
        return
      }
    }

    let body = ""
    req.setEncoding("utf8")
    req.on("data", (chunk: string) => {
      body += chunk
      if (body.length > 1_000_000) req.destroy()
    })
    req.on("end", () => {
      try {
        const { event, data } = JSON.parse(body || "{}") as {
          event?: string
          data?: Record<string, unknown>
        }
        switch (event) {
          case "booking:update":
            handleBookingUpdate(data as BookingUpdatePayload)
            break
          case "quote:update":
            handleQuoteUpdate(data as QuoteUpdatePayload)
            break
          case "message:send":
            handleMessageSend(data as MessageSendPayload)
            break
          case "notification:new":
            handleNotificationNew(data as { toId: string; notification?: unknown })
            break
          case "tracking:position":
            handleTrackingPosition(data as TrackingPositionPayload)
            break
          default:
            res.writeHead(400, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ ok: false, error: `unknown event: ${event}` }))
            return
        }
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: true, event }))
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: false, error: "invalid JSON body" }))
        console.error("[realtime] /emit error:", err)
      }
    })
    return
  }

  // socket.io handshake / polling requests
  io.engine.handleRequest(req, res)
})

httpServer.on("upgrade", (req, socket, head) => {
  io.engine.handleUpgrade(req, socket, head)
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
      pubClient.disconnect()
      subClient.disconnect()
      console.log("[realtime] server closed")
      process.exit(0)
    })
  })
  // Hard exit after 5s as a safety net
  setTimeout(() => {
    console.warn("[realtime] forced exit after timeout")
    process.exit(1)
  }, 5000).unref()
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
