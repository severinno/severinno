// Severinno Marketplace SaaS — Realtime Mini-Service (Fase 1 / MVP)
// Socket.io server on port 3003, path "/" (required by Caddy gateway).
// The gateway selects this service via the `?XTransformPort=3003` query
// param sent by the frontend client (see src/hooks/use-realtime.ts).

import { createServer } from "http"
import { Server as EngineServer } from "engine.io"
import { readFileSync } from "fs"
import { Server, Socket } from "socket.io"
import { createAdapter } from "@socket.io/redis-adapter"
import { Redis } from "ioredis"
import { randomUUID } from "crypto"

// A porta é fixa em produção (compose injeta PORT: 3003); a env existe para
// a suíte E2E subir o serviço real numa porta livre sem colidir com nada.
const PORT = Number(process.env.PORT ?? 3003)
const NODE_ENV = process.env.NODE_ENV ?? "development"

// ── /emit API key (FAIL-CLOSED) ─────────────────────────────────────────
// O endpoint /emit injeta eventos em salas user:{id} — sem autenticação,
// qualquer cliente HTTP na rede poderia forjar mensagens de chat, updates
// de booking e posições de tracking para qualquer usuário.
//
// Política (09/2026):
//   - Produção SEM REALTIME_EMIT_API_KEY configurada = boot FALHA (exit 1).
//     O serviço não soba exposto sem chave — o orquestrador reinicia e o
//     alerta de crashloop expõe o misconfiguration em vez de um endpoint
//     aberto silenciosamente.
//   - Sempre fail-closed: se a chave NÃO está configurada no servidor,
//     TODO request ao /emit é rejeitado com 503 (não há modo aberto).
//   - Em desenvolvimento, o boot apenas avisa (o /emit continua fechado).
// Copia da regra de src/lib/realtime-emit-key.ts (a imagem do realtime não
// contém src/ — os dois lados duplicam de propósito; o guard
// check-realtime-emit-key-source.mjs prende o desenho secret + _FILE).
function readEmitApiKey(): string | undefined {
  const filePath = process.env.REALTIME_EMIT_API_KEY_FILE
  if (filePath) {
    let fromFile: string
    try {
      fromFile = readFileSync(filePath, "utf8").trim()
    } catch {
      throw new Error(
        `[realtime] REALTIME_EMIT_API_KEY_FILE aponta para '${filePath}' mas o arquivo não pôde ser lido — ` +
          `o Docker Secret realtime_emit_api_key não está montado neste container. ` +
          `Fail-closed: sem fallback para a env direta. ` +
          `Verifique o bloco secrets: do serviço no compose de produção.`,
      )
    }
    if (fromFile) return fromFile
  }
  const direct = process.env.REALTIME_EMIT_API_KEY
  return direct && direct.trim() ? direct.trim() : undefined
}

const EMIT_API_KEY = readEmitApiKey()

if (!EMIT_API_KEY && NODE_ENV === "production") {
  console.error(
    "[realtime] FATAL: REALTIME_EMIT_API_KEY não configurada em produção. " +
      "/emit injeta eventos em salas de usuários e não pode ficar aberto. " +
      "Gere uma chave (ex.: `openssl rand -hex 32`) e configure REALTIME_EMIT_API_KEY " +
      "no ambiente do serviço realtime E no app Next.js (mesmo valor).",
  )
  process.exit(1)
}
if (!EMIT_API_KEY) {
  console.warn(
    "[realtime] REALTIME_EMIT_API_KEY não configurada — /emit está FECHADO " +
      "(todo request recebe 503). Configure a chave para habilitar o bridge do app.",
  )
}

/**
 * Compara duas chaves em tempo constante (evita timing attacks).
 * Ambas viram hex de um SHA-256 antes da comparação — normaliza comprimento.
 */
async function keysMatch(provided: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ])
  const av = new Uint8Array(a)
  const bv = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i]
  return diff === 0
}

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
// `EngineServer` é o `Server` do engine.io 6.x (dependência DECLARADA no
// package.json do mini-service — antes ela vinha só por transitividade do
// socket.io e o identificador nunca era importado: o serviço subia e morria
// em ReferenceError no boot).
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

// ---------- Socket ticket auth (handshake) ----------
// O app emite um ticket SINGLE-USE (POST /api/realtime/{papel}/ticket, sessão
// válida) gravando a identidade no MESMO Redis da base (TTL 60s). O handshake
// consome com GETDEL — atômico: replay não funciona. A identidade estampada
// no socket é a da SESSÃO, nunca payload do cliente (o join auto-declarado
// permitia entrar em user:{id} de terceiros).
const SOCKET_TICKET_PREFIX = "auth:socket-ticket:"

interface TicketIdentity {
  userId: string
  role: string
}

async function consumeTicket(ticket: unknown): Promise<TicketIdentity | null> {
  // 64 hex chars = 32 bytes de randomBytes — rejeita lixo antes do Redis.
  if (typeof ticket !== "string" || !/^[0-9a-f]{64}$/.test(ticket)) return null
  try {
    const raw = await pubClient.getdel(`${SOCKET_TICKET_PREFIX}${ticket}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TicketIdentity>
    if (!parsed.userId || !parsed.role) return null
    return { userId: String(parsed.userId), role: String(parsed.role) }
  } catch (err) {
    console.error("[realtime] ticket consume error:", err)
    return null
  }
}

// Handshake autenticado: sem ticket válido, a conexão só entra FORA de
// produção (fallback dev — scripts e2e/smoke locais; o socket fica NÃO
// autenticado e não recebe salas). Em produção é fail-closed.
io.use(async (socket, next) => {
  const identity = await consumeTicket(socket.handshake.auth?.ticket)
  if (identity) {
    socket.data.userId = identity.userId
    socket.data.role = identity.role
    socket.data.authenticated = true
    console.log(
      `[realtime] handshake autenticado: ${socket.id} user:${identity.userId} role:${identity.role}`,
    )
    return next()
  }
  if (NODE_ENV !== "production") {
    socket.data.authenticated = false
    console.warn(`[realtime] handshake SEM ticket (dev): ${socket.id} fica não autenticado`)
    return next()
  }
  console.warn(`[realtime] handshake REJEITADO (sem ticket válido): ${socket.id}`)
  next(new Error("unauthorized: ticket de socket ausente, expirado ou já usado"))
})

// ---------- Types ----------
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

interface MessageDeliveredPayload {
  messageId: string
  toId: string
  fromId: string
  bookingId?: string
}

interface MessageReadPayload {
  messageId?: string
  readerId: string
  fromId: string
  bookingId?: string
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

function handleMessageDelivered(payload: MessageDeliveredPayload): void {
  const { messageId, toId, fromId, bookingId } = payload || ({} as MessageDeliveredPayload)
  if (!messageId || !fromId) return
  const evt = {
    messageId,
    toId,
    fromId,
    bookingId: bookingId ?? null,
    deliveredAt: nowTimestamp(),
  }
  io.to(`user:${fromId}`).emit("message:delivered", evt)
  console.log(`[realtime] message:delivered ${messageId} -> user:${fromId}`)
}

function handleMessageRead(payload: MessageReadPayload): void {
  const { messageId, readerId, fromId, bookingId } = payload || ({} as MessageReadPayload)
  if (!fromId || !readerId) return
  const evt = {
    messageId: messageId ?? null,
    readerId,
    fromId,
    bookingId: bookingId ?? null,
    readAt: nowTimestamp(),
  }
  io.to(`user:${fromId}`).emit("message:read", evt)
  console.log(`[realtime] message:read by ${readerId} -> user:${fromId}`)
}

// ---------- Connection handling ----------
io.on("connection", (socket: Socket) => {
  console.log(`[realtime] socket connected: ${socket.id}`)

  // join -> salas user:{userId} e role:{role} DA IDENTIDADE DO HANDSHAKE.
  // O payload do cliente é IGNORADO — o servidor decide quem é quem; sem
  // autenticação (fallback dev), o join falha com reason.
  socket.on("join", (_payload: unknown, ack?: (res: { ok: boolean; reason?: string }) => void) => {
    try {
      const userId = socket.data.userId as string | undefined
      const role = socket.data.role as string | undefined
      if (!socket.data.authenticated || !userId || !role) {
        ack?.({
          ok: false,
          reason: "não autenticado: obtenha um ticket em /api/realtime/{papel}/ticket",
        })
        return
      }
      socket.join(`user:${userId}`)
      socket.join(`role:${role}`)
      console.log(`[realtime] ${socket.id} joined user:${userId} role:${role}`)
      ack?.({ ok: true })
    } catch (err) {
      console.error("[realtime] join error:", err)
      ack?.({ ok: false })
    }
  })

  // message:send — o fromId é a identidade do handshake (o payload não
  // decide quem envia); não autenticado não retransmite.
  // SEGURANÇA: exige bookingId para garantir que o remetente e destinatário
  // possuem um contexto de negociação aberto (anti-spam/assédio).
  socket.on("message:send", (payload: MessageSendPayload) => {
    try {
      const userId = socket.data.userId as string | undefined
      if (!socket.data.authenticated || !userId) {
        console.warn(`[realtime] message:send recusado (não autenticado): ${socket.id}`)
        return
      }
      if (!payload?.bookingId) {
        console.warn(`[realtime] message:send recusado (bookingId ausente): ${socket.id}`)
        return
      }
      if (!payload?.toId) {
        console.warn(`[realtime] message:send recusado (toId ausente): ${socket.id}`)
        return
      }
      handleMessageSend({ ...payload, fromId: userId })
    } catch (err) {
      console.error("[realtime] message:send error:", err)
    }
  })

  // booking:update — DESABILITADO no socket do cliente.
  // SEGURANÇA: o payload do cliente inclui clientId e providerId — um atacante
  // pode colocar seu próprio ID no campo clientId e alterar status de bookings
  // de terceiros. Mudanças de status devem ser emitidas SOMENTE pelo backend
  // via POST /emit (autenticado por REALTIME_EMIT_API_KEY).
  socket.on("booking:update", (_payload: BookingUpdatePayload) => {
    console.warn(
      `[realtime] booking:update via socket RECUSADO (use /emit server-side): ${socket.id}`,
    )
  })

  // quote:update — DESABILITADO no socket do cliente (mesma razão do booking:update).
  socket.on("quote:update", (_payload: QuoteUpdatePayload) => {
    console.warn(
      `[realtime] quote:update via socket RECUSADO (use /emit server-side): ${socket.id}`,
    )
  })

  // tracking:position { bookingId, clientId, lat, lng }
  // -> emit tracking:position to user:{clientId} (delivery tracking)
  socket.on("tracking:position", (payload: TrackingPositionPayload) => {
    try {
      if (!socket.data.authenticated) {
        console.warn(`[realtime] tracking:position recusado (não autenticado): ${socket.id}`)
        return
      }
      if (socket.data.role !== "PROVIDER" && socket.data.role !== "ADMIN") {
        console.warn(
          `[realtime] tracking:position recusado (papel '${socket.data.role}' não autorizado): ${socket.id}`,
        )
        return
      }
      handleTrackingPosition(payload)
    } catch (err) {
      console.error("[realtime] tracking:position error:", err)
    }
  })

  // message:delivered { messageId, fromId, bookingId }
  // -> emit message:delivered to user:{fromId}
  socket.on("message:delivered", (payload: MessageDeliveredPayload) => {
    try {
      const userId = socket.data.userId as string | undefined
      if (!socket.data.authenticated || !userId) {
        return
      }
      handleMessageDelivered({ ...payload, toId: userId })
    } catch (err) {
      console.error("[realtime] message:delivered error:", err)
    }
  })

  // message:read { messageId, fromId, bookingId }
  // -> emit message:read to user:{fromId}
  socket.on("message:read", (payload: MessageReadPayload) => {
    try {
      const userId = socket.data.userId as string | undefined
      if (!socket.data.authenticated || !userId) {
        return
      }
      handleMessageRead({ ...payload, readerId: userId })
    } catch (err) {
      console.error("[realtime] message:read error:", err)
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
  void (async () => {
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
      // FAIL-CLOSED: sem chave configurada no servidor, /emit rejeita TUDO.
      // (Produção nem chega aqui: o boot falha sem REALTIME_EMIT_API_KEY.)
      if (!EMIT_API_KEY) {
        res.writeHead(503, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            ok: false,
            error: "realtime /emit disabled: REALTIME_EMIT_API_KEY not configured",
          }),
        )
        return
      }

      const providedHeader = req.headers["x-api-key"]
      const providedKey = Array.isArray(providedHeader) ? providedHeader[0] : providedHeader
      const authorized = providedKey ? await keysMatch(providedKey, EMIT_API_KEY) : false
      if (!authorized) {
        console.warn(
          `[realtime] /emit unauthorized from ${req.socket.remoteAddress ?? "?"} ` +
            `(has key: ${!!providedKey})`,
        )
        res.writeHead(401, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: false, error: "unauthorized" }))
        return
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
            case "message:delivered":
              handleMessageDelivered(data as MessageDeliveredPayload)
              break
            case "message:read":
              handleMessageRead(data as MessageReadPayload)
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
  })().catch((err) => {
    console.error("[realtime] request handler error:", err)
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: "internal error" }))
    }
  })
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
