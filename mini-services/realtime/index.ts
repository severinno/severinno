// Severinno Marketplace SaaS — Realtime Mini-Service (Fase 1 / MVP)
// Socket.io server on port 3003, path "/" (required by Caddy gateway).
// The gateway selects this service via the `?XTransformPort=3003` query
// param sent by the frontend client (see src/hooks/use-realtime.ts).

import { createServer } from "http"
import { Server, Socket } from "socket.io"
import { Server as EngineServer } from "engine.io"
import {
  readSecret,
  verifySessionCookie,
  verifyEmitToken,
  authorizeClientEvent,
  filterSocketsBySessionUserId,
  selectSocketsToKickForSessionLimit,
  selectExpiredSessionSockets,
  extractEmitEventInfo,
  summarizeActiveSessions,
  type VerifiedSession,
  type BookingParticipantChecker,
} from "./security"
import { createBookingParticipantChecker, type PoolLike } from "./booking-participant"

const PORT = 3003

// ── Security env (fail closed when missing) ─────────────────────────────
// SESSION_SECRET       — verifies the HMAC-signed session cookie (same
//                        secret used by src/lib/auth.ts in the Next.js app)
// REALTIME_EMIT_TOKEN  — Bearer token required on POST /emit (server→server
//                        bridge used by src/lib/realtime-client.ts)
const SESSION_SECRET = readSecret("SESSION_SECRET")
const EMIT_TOKEN = readSecret("REALTIME_EMIT_TOKEN")
if (!SESSION_SECRET) {
  console.warn(
    "[realtime] ⚠️ SESSION_SECRET not configured — all joins will be rejected (fail closed)",
  )
}
if (!EMIT_TOKEN) {
  console.warn(
    "[realtime] ⚠️ REALTIME_EMIT_TOKEN not configured — POST /emit will be rejected (fail closed)",
  )
}

// ── Session concurrency limit (max simultaneous sockets per user) ─────────
// When a user joins with more sockets than MAX_SESSIONS_PER_USER, only the
// newest ones stay — older sockets are kicked with reason "session_limit"
// (same fetchSockets sweep as session:revoke, via the pure selector).
// Default 1 = one active session per user; configurable via env (0/negative
// are clamped to 1; NaN falls back to 1).
const MAX_SESSIONS_PER_USER = Math.max(1, Number(process.env.REALTIME_MAX_SESSIONS_PER_USER) || 1)

// ── Booking participant checker (message:send full-flow validation) ───────
// Lazy pg.Pool over DATABASE_URL (docker-secret aware). Fail-closed: without
// DATABASE_URL, messages carrying a bookingId are DENIED (can't verify real
// participation — the booking membership is the security boundary, not the
// self-declared fromId). PoolLoader is duck-typed so this module has zero
// pg imports (unit-tested in isolation via injected fake pool).
// Promise-memoized so concurrent booking-scoped messages share one lazy pool.
let bookingPoolPromise: Promise<PoolLike | null> | null = null
const loadBookingPool: () => Promise<PoolLike | null> = () => {
  bookingPoolPromise ??= (async () => {
    const url = readSecret("DATABASE_URL")
    if (!url) {
      console.warn(
        "[realtime] ⚠️ DATABASE_URL not configured — message:send with bookingId will be DENIED (fail closed)",
      )
      return null
    }
    try {
      const { Pool } = await import("pg")
      return new Pool({ connectionString: url, max: 2 })
    } catch (err) {
      console.error("[realtime] could not load pg for booking checks:", err)
      return null
    }
  })()
  return bookingPoolPromise
}
const isBookingParticipant: BookingParticipantChecker =
  createBookingParticipantChecker(loadBookingPool)

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

// Helper: audita um evento de socket SÓ DEPOIS de autorizado (dentro do
// if (await requireSession(...))). Eventos DENIED não entram nos contadores
// nem no log — audit reflete emissões reais, não tentativas.
function auditSocketEvent<T>(event: string, payload: T): void {
  auditEmit("socket", event, payload as unknown as Record<string, unknown>)
}

// ── Telemetry: emit audit + in-memory counters ────────────────────────────
// Audit every POST /emit (server→server bridge) AND client-emitted events
// with structured context — event, target rooms, userId, source — so ops can
// trace "who emitted what to which room" (e.g. the HMR orphan-socket
// scenario: a notification:new to user:{id} that nobody receives because the
// room has multiple stale sockets). Counters are in-memory per process;
// /health exposes the totals + a short ring buffer of recent emits.
const emitCounters = new Map<string, number>()
const RECENT_EMITS_MAX = 20
const recentEmits: Array<{
  t: string
  source: "emit" | "socket"
  event: string
}> = []

function bumpEmitCounter(event: string): void {
  emitCounters.set(event, (emitCounters.get(event) ?? 0) + 1)
}

/**
 * Audit one emitted event (source="emit" = POST /emit bridge; source="socket"
 * = client-emitted handler). Best-effort: never throws into the caller.
 *
 * NOTA (segurança): o ring buffer e o log de console carregam rooms/userId
 * para debugging de operação, mas o /health (endpoint SEM auth) NÃO expõe
 * esses campos — só event/source/t — para não vazar presença de usuários
 * (mesmo dado que motivou proteger /sessions com Bearer).
 */
function auditEmit(
  source: "emit" | "socket",
  event: string,
  data: Record<string, unknown> | undefined,
): void {
  try {
    const info = extractEmitEventInfo(event, data)
    bumpEmitCounter(event)
    recentEmits.push({
      t: new Date().toISOString(),
      source,
      event,
    })
    if (recentEmits.length > RECENT_EMITS_MAX) recentEmits.shift()
    console.log(
      `[realtime] audit ${source} event=${event} rooms=[${info.rooms.join(",")}] userId=${info.userId ?? "-"}`,
    )
  } catch {
    // Auditoria nunca pode quebrar o fluxo do evento.
  }
}

// ── Active-session tracking (admin "who is online" indicator) ─────────────
// Session presence is derived live from the sockets' verified handshake
// session (socket.data.session — fixed at connect time, matching the
// revocation sweep) AND the join timestamp captured when the client joins
// user:{id}. A socket connected with a valid cookie but never joined is NOT
// counted: the indicator reflects who is actually in the user:{id} room
// (i.e. using the platform), not merely who holds a session cookie.
// No separate registry to keep in sync: fetchSockets() is the source of
// truth, so a socket that died without a clean disconnect is excluded.
interface SessionSocketMeta {
  userId: string
  role: string
  socketId: string
  connectedAt: string
  joinedAt: string
}

/**
 * Snapshot of all active sessions (sockets with a verified session AND a
 * join in user:{id}). Purely derived — no mutable registry.
 */
async function getActiveSessions(): Promise<SessionSocketMeta[]> {
  const sockets = await io.fetchSockets()
  const out: SessionSocketMeta[] = []
  for (const s of sockets) {
    const session = s.data?.session as VerifiedSession | null
    const joinedAt = s.data?.joinedAt as string | null | undefined
    if (!session || !joinedAt) continue // not verified OR not joined → offline
    out.push({
      userId: session.userId,
      role: session.role,
      socketId: s.id,
      connectedAt: (s.handshake?.time as string | undefined) ?? new Date().toISOString(),
      joinedAt,
    })
  }
  return out
}

const REVOKE_CLOSE_DELAY_MS = 500

/**
 * Enforce the per-user session limit after a join. Keeps the newest
 * MAX_SESSIONS_PER_USER sockets of the user and kicks the older ones with
 * reason "session_limit" (event `session:limit` + delayed force-close so the
 * packet flushes — same pattern as session:revoke).
 */
async function enforceSessionLimit(userId: string, justJoinedSocketId: string): Promise<void> {
  try {
    const sockets = await io.fetchSockets()
    const toKick = selectSocketsToKickForSessionLimit(
      sockets,
      userId,
      MAX_SESSIONS_PER_USER,
      justJoinedSocketId,
    )
    for (const s of toKick) {
      s.emit("session:limit", { userId, reason: "session_limit" })
      setTimeout(() => s.disconnect(true), REVOKE_CLOSE_DELAY_MS).unref()
      console.log(
        `[realtime] session limit: kicked socket ${s.id} for user:${userId} (max ${MAX_SESSIONS_PER_USER})`,
      )
    }
  } catch (err) {
    console.error("[realtime] session limit error (best-effort):", err)
  }
}

// ── Periodic TTL sweep ─────────────────────────────────────────────────────
// Sessions expire by cookie TTL (30d) without an explicit logout. The app
// (src/lib/auth.ts getSession) fires session:revoke when it sees the expired
// cookie on the next request, but a socket with NO further traffic (idle
// dashboard/tab open for months) would never trigger that path. This sweep
// closes the gap server-side: every SWEEP_INTERVAL_MS, force-close sockets
// whose verified session (fixed at handshake, incl. expiresAt) has passed its
// TTL — same event+delayed-close pattern as session:revoke so the client
// resets its singleton instead of reconnecting with the stale cookie.
const TTL_SWEEP_INTERVAL_MS = 60_000 // 1min

const ttlSweep = setInterval(async () => {
  try {
    const sockets = await io.fetchSockets()
    const expired = selectExpiredSessionSockets(sockets, Date.now())
    for (const s of expired) {
      const userId = s.data.session?.userId ?? "unknown"
      s.emit("session:revoked", { userId, reason: "session_expired" })
      setTimeout(() => s.disconnect(true), REVOKE_CLOSE_DELAY_MS).unref()
      console.log(
        `[realtime] TTL sweep: session expired for user:${userId} — closing socket ${s.id}`,
      )
    }
  } catch (err) {
    console.error("[realtime] TTL sweep error (best-effort):", err)
  }
}, TTL_SWEEP_INTERVAL_MS)
// Não segura o processo aberto por causa do timer.
ttlSweep.unref()

function handleSessionRevoke(payload: { userId?: string }): void {
  const { userId } = payload || {}
  if (!userId) return
  const room = `user:${userId}`
  // Server-side session revocation (logout via destroySession). Notify the
  // user's sockets so clients can reset their local state, then force-close
  // them so a stale socket can't keep receiving room events after logout.
  io.to(room).emit("session:revoked", { userId })
  // Hardened: the room broadcast only reaches sockets that JOINED. A socket
  // connected with a valid cookie but never joined (or between connect and
  // join) has NO room membership — sweep ALL connected sockets via
  // io.fetchSockets() and match by the verified session fixed at handshake
  // (socket.data.session), so every socket of the revoked user is notified
  // AND force-closed, not just the joined ones.
  io.fetchSockets()
    .then((sockets) => {
      const revocable = filterSocketsBySessionUserId(sockets, userId)
      // Direct notify for sockets the room broadcast can't reach (joined
      // ones already got it; a second event is a harmless no-op for the
      // client's idempotent handler).
      for (const s of revocable) s.emit("session:revoked", { userId })
      // The force-close is DELAYED: engine.io discards buffered packets when
      // a polling transport closes immediately, which would drop the
      // revocation event and leave the client reconnecting with a stale
      // session. Waiting a beat lets the packet flush to every transport
      // first (fail-safe: the client's own disconnect on session:revoked
      // makes this a no-op otherwise).
      setTimeout(() => {
        for (const s of revocable) s.disconnect(true)
      }, REVOKE_CLOSE_DELAY_MS).unref()
      console.log(
        `[realtime] session revoked for user:${userId} — ${revocable.length} socket(s) matched via fetchSockets (incl. non-joined)`,
      )
    })
    .catch((err) => {
      console.error("[realtime] session:revoke fetchSockets error:", err)
      // Fallback: room-based disconnect still covers the joined sockets even
      // if the sweep fails (e.g. adapter without fetchSockets support).
      setTimeout(() => {
        io.in(room).disconnectSockets(true)
      }, REVOKE_CLOSE_DELAY_MS).unref()
    })
}

// ---------- Connection handling ----------
io.on("connection", (socket: Socket) => {
  console.log(`[realtime] socket connected: ${socket.id}`)

  // Verify the HMAC-signed session cookie once, at handshake time. The
  // httpOnly cookie is sent by the browser with the handshake (withCredentials
  // on the client + credentials CORS), so the session is fixed per socket.
  const session: VerifiedSession | null = verifySessionCookie(
    socket.handshake.headers.cookie,
    SESSION_SECRET,
  )
  socket.data.session = session
  if (session) {
    console.log(
      `[realtime] ${socket.id} verified session for user:${session.userId} role:${session.role}`,
    )
  } else {
    console.warn(
      `[realtime] ${socket.id} has no valid session — join and client events will be rejected`,
    )
  }

  // Require a verified session matching the join payload. Prevents any client
  // from subscribing to another user's rooms (user:{userId} / role:{role}).
  // join { userId, role } -> join rooms user:{userId} and role:{role}
  socket.on(
    "join",
    (payload: JoinPayload, ack?: (res: { ok: boolean; error?: string }) => void) => {
      try {
        const { userId, role } = payload || ({} as JoinPayload)
        if (!userId || !role) {
          ack?.({ ok: false, error: "invalid payload" } as any)
          return
        }
        const sess = socket.data.session as VerifiedSession | null
        if (!sess || sess.userId !== userId || sess.role.toLowerCase() !== role.toLowerCase()) {
          console.warn(
            `[realtime] join DENIED for ${socket.id}: userId=${userId} role=${role} (session: ${sess ? sess.userId + "/" + sess.role : "none"})`,
          )
          ack?.({ ok: false, error: "UNAUTHORIZED" } as any)
          return
        }
        socket.join(`user:${userId}`)
        socket.join(`role:${role}`)
        socket.data.userId = userId
        socket.data.role = role
        socket.data.joinedAt = new Date().toISOString()
        console.log(`[realtime] ${socket.id} joined user:${userId} role:${role}`)
        ack?.({ ok: true })
        // Session concurrency limit (best-effort, never blocks the join ack).
        // Kicks OLDER sockets of the same user (reason session_limit) keeping
        // only the newest MAX_SESSIONS_PER_USER.
        enforceSessionLimit(userId, socket.id).catch((err) => {
          console.error("[realtime] session limit enforcement error:", err)
        })
      } catch (err) {
        console.error("[realtime] join error:", err)
        ack?.({ ok: false, error: "internal" } as any)
      }
    },
  )

  // Client-emitted broadcast events are gated via the extracted pure
  // authorizeClientEvent (security.ts): verified session + identity match
  // (fromIds). message:send additionally validates REAL booking membership
  // (bookingId participant) via the injected pg-backed checker — a client
  // cannot claim a booking it doesn't belong to. The server-side /emit bridge
  // is the trusted path (Bearer-protected) and skips client auth.
  const requireSession = async (
    event: string,
    fromIds: string[],
    bookingId?: string,
    toId?: string,
  ): Promise<boolean> => {
    try {
      const result = await authorizeClientEvent({
        session: socket.data.session as VerifiedSession | null,
        fromIds,
        bookingId: bookingId || undefined,
        toId: toId || undefined,
        // authorizeClientEvent only consults the resolver when bookingId is
        // present, so passing it unconditionally is safe (no extra DB hit).
        isBookingParticipant,
      })
      if (!result.ok) {
        console.warn(
          `[realtime] ${event} DENIED for ${socket.id} (${result.reason}): userId=${
            (socket.data.session as VerifiedSession | null)?.userId ?? "none"
          } bookingId=${bookingId ?? "-"}`,
        )
      }
      return result.ok
    } catch (err) {
      // Nunca deixa uma rejeição escapar sem handler (fail-closed): um resolver
      // de participante com bug vira deny silencioso em vez de unhandled rejection.
      console.error(`[realtime] ${event} auth error for ${socket.id}:`, err)
      return false
    }
  }

  // message:send { fromId, toId, content, bookingId? }
  // -> emit message:new (with id + timestamp) and notification:new to user:{toId}
  // Full-flow validation: session + fromId + (bookingId ⇒ real participant).
  socket.on("message:send", async (payload: MessageSendPayload) => {
    try {
      const p = payload || ({} as MessageSendPayload)
      // Full-flow validation: session + fromId + (bookingId ⇒ remetente E
      // destinatário são participantes reais do booking).
      if (await requireSession("message:send", p.fromId ? [p.fromId] : [], p.bookingId, p.toId)) {
        auditSocketEvent("message:send", p)
        handleMessageSend(p)
      }
    } catch (err) {
      console.error("[realtime] message:send error:", err)
    }
  })

  // booking:update { bookingId, clientId, providerId, status }
  // -> emit booking:updated to both user:{clientId} and user:{providerId}
  socket.on("booking:update", async (payload: BookingUpdatePayload) => {
    try {
      const p = payload || ({} as BookingUpdatePayload)
      if (await requireSession("booking:update", [p.clientId, p.providerId].filter(Boolean))) {
        auditSocketEvent("booking:update", p)
        handleBookingUpdate(p)
      }
    } catch (err) {
      console.error("[realtime] booking:update error:", err)
    }
  })

  // quote:update { quoteId, clientId, providerId, status }
  // -> emit quote:updated to both user:{clientId} and user:{providerId}
  socket.on("quote:update", async (payload: QuoteUpdatePayload) => {
    try {
      const p = payload || ({} as QuoteUpdatePayload)
      if (await requireSession("quote:update", [p.clientId, p.providerId].filter(Boolean))) {
        auditSocketEvent("quote:update", p)
        handleQuoteUpdate(p)
      }
    } catch (err) {
      console.error("[realtime] quote:update error:", err)
    }
  })

  // tracking:position { bookingId, clientId, lat, lng }
  // -> emit tracking:position to user:{clientId} (delivery tracking)
  socket.on("tracking:position", async (payload: TrackingPositionPayload) => {
    try {
      const p = payload || ({} as TrackingPositionPayload)
      if (await requireSession("tracking:position", p.clientId ? [p.clientId] : [])) {
        auditSocketEvent("tracking:position", p)
        handleTrackingPosition(p)
      }
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

// ---------- Health snapshot (aggregated session/socket metrics) ------------
// Exposes for ops: total connected sockets (all), verified (valid session),
// joined (in a user:{id} room) + the per-user aggregation. `usersWithMultiple
// Sockets` is the HMR-orphan signal: a dev reload leaves stale sockets behind
// (Next dev resets the module singleton on navigation); a user holding >1
// socket is exactly that symptom. Counters + recent emits come from the audit
// ring above.
async function getHealthSnapshot(): Promise<Record<string, unknown>> {
  let socketsCount = 0
  let verifiedCount = 0
  let joinedCount = 0
  const sessions: SessionMetaLike[] = []
  try {
    const sockets = await io.fetchSockets()
    socketsCount = sockets.length
    for (const s of sockets) {
      const session = s.data?.session as VerifiedSession | null
      if (session) verifiedCount += 1
      if (s.data?.joinedAt) {
        joinedCount += 1
        sessions.push({
          userId: session?.userId ?? "unknown",
          role: session?.role ?? "unknown",
          socketId: s.id,
        })
      }
    }
  } catch (err) {
    // fetchSockets falhou (adapter indisponível) — metrics parciais/zero.
    console.error("[realtime] /health fetchSockets error:", err)
  }
  const metrics = summarizeActiveSessions(sessions)
  return {
    uptimeSeconds: Math.floor(process.uptime()),
    sockets: { total: socketsCount, verified: verifiedCount, joined: joinedCount },
    sessions: metrics,
    emitCounters: Object.fromEntries(emitCounters),
    recentEmits: recentEmits.slice(-10),
  }
}

type SessionMetaLike = {
  userId: string
  role: string
  socketId: string
}

// ---------- HTTP routing (admin endpoints + socket.io delegation) ----------
// GET  /health -> { status, sockets, sessions, emitCounters, recentEmits }
// POST /emit   -> { event, data } — server-side bridge used by
//                 src/lib/realtime-client.ts (Next.js app server)
// Every other request is delegated to engine.io (socket.io handshakes).
httpServer.on("request", (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost")

  if (url.pathname === "/health" && req.method === "GET") {
    // Richer health: status ok + aggregated session/socket metrics. Best-effort:
    // if fetchSockets fails the endpoint still answers 200 with the error flag
    // (the docker healthcheck only requires HTTP 200).
    getHealthSnapshot()
      .then((snapshot) => {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ status: "ok", ...snapshot }))
      })
      .catch((err) => {
        console.error("[realtime] /health snapshot error:", err)
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ status: "ok", metricsError: (err as Error).message }))
      })
    return
  }

  // GET /sessions -> active sessions (sockets with a verified session AND
  // a join in user:{id} — the "who is online" snapshot for the admin panel).
  // Same Bearer protection as POST /emit: this endpoint reveals who is
  // online, so it must never be reachable by unauthenticated clients.
  if (url.pathname === "/sessions" && req.method === "GET") {
    if (!verifyEmitToken(req.headers.authorization, EMIT_TOKEN)) {
      res.writeHead(401, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }))
      return
    }
    getActiveSessions()
      .then((sessions) => {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: true, sessions, total: sessions.length }))
      })
      .catch((err) => {
        console.error("[realtime] /sessions error:", err)
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: false, error: "internal" }))
      })
    return
  }

  if (url.pathname === "/emit" && req.method === "POST") {
    // Require Authorization: Bearer <REALTIME_EMIT_TOKEN> (timing-safe,
    // fail closed). This endpoint broadcasts events to arbitrary user rooms,
    // so it must never be reachable by unauthenticated clients.
    if (!verifyEmitToken(req.headers.authorization, EMIT_TOKEN)) {
      res.writeHead(401, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }))
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
          case "notification:new":
            handleNotificationNew(data as { toId: string; notification?: unknown })
            break
          case "tracking:position":
            handleTrackingPosition(data as TrackingPositionPayload)
            break
          case "session:revoke":
            handleSessionRevoke(data as { userId?: string })
            break
          default:
            // Sinal de misconfiguration para o operador: evento desconhecido
            // NÃO é contado como emitido (auditoria reflete emissões reais).
            console.warn(`[realtime] audit emit event=unknown (${String(event)}) — 400`)
            res.writeHead(400, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ ok: false, error: `unknown event: ${event}` }))
            return
        }
        // Telemetria: audita SOMENTE eventos aceitos (source=emit) — userId/
        // rooms extraídos do payload, best-effort, nunca lança. Consistente com
        // o caminho socket (audit pós-autorização): contador = emissões reais.
        auditEmit("emit", event ?? "unknown", data)
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
