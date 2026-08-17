// Severinno Marketplace SaaS — Realtime Mini-Service (Fase 1 / MVP)
// Socket.io server on port REALTIME_PORT (default 3003), path "/" (required
// by Caddy gateway). The gateway selects this service via the
// `?XTransformPort=<port>` query param sent by the frontend client (see
// src/hooks/use-realtime.ts).

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
  selectOrphanSockets,
  renewSessionSockets,
  countRenewedSockets,
  bumpMinuteWindow,
  parseExpiredSpikeThreshold,
  computeExpiredSweepMetrics,
  parseSweepIntervalMs,
  parseTelemetryIntervalMs,
  parseRealtimePort,
  extractEmitEventInfo,
  toPublicRecentEmits,
  type RecentEmitEntry,
  summarizeActiveSessions,
  computeSocketAgeMs,
  parseMaxSessionsPerRole,
  resolveMaxSessionsPerRole,
  parseMaxSessionsPerPlan,
  resolveMaxSessionsForUser,
  type VerifiedSession,
  type BookingParticipantChecker,
} from "./security"
import {
  createRedisLoader,
  createTelemetryPersister,
  readTelemetryWindow,
  DEFAULT_METRICS_MINUTES,
  MAX_METRICS_MINUTES,
  type TelemetrySessionsSnapshot,
} from "./redis-telemetry"
import {
  createKickAuditPersister,
  parseKickAuditFlushIntervalMs,
  type KickAuditRedisLoader,
} from "./redis-kick-audit"
import {
  createOrphanAlert,
  parseOrphanAlertThreshold,
  parseOrphanAlertCooldownMs,
  resolveAlertDsn,
} from "./ops-alert"
import { createBookingParticipantChecker, type PoolLike } from "./booking-participant"
import { createUserPlanLoader } from "./user-plan"
import {
  createSessionLimitNotifier,
  SESSION_LIMIT_TYPE,
  SESSION_LIMIT_TITLE,
  SESSION_LIMIT_BODY,
} from "./session-notification"

// Porta HTTP/socket — REALTIME_PORT (fallback 3003). O compose repassa
// `REALTIME_PORT: ${REALTIME_PORT:-3003}` ao container (docker-compose.yml);
// NÃO lemos PORT (convenção de PaaS tipo Heroku/Render): um PORT injetado
// pelo runtime sobrescreveria silenciosamente o default documentado.
// Configurável para smoke de boot em porta alternativa e testes de
// isolamento (várias instâncias no mesmo host sem colisão de porta).
const PORT = parseRealtimePort(process.env.REALTIME_PORT)

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
// When a user joins with more sockets than their role's limit, only the
// newest ones stay — older sockets are kicked with reason "session_limit"
// (same fetchSockets sweep as session:revoke, via the pure selector).
//
// Default 1 = one active session per user. Configuração por ENV estruturado:
//   REALTIME_MAX_SESSIONS_PER_USER       → fallback global (número simples;
//                                          0/negativo clamped a 1; NaN → 1)
//   REALTIME_MAX_SESSIONS_PER_ROLE       → override POR ROLE (JSON):
//                                          '{"CLIENT":1,"PROVIDER":2,"ADMIN":5}'
//                                          Roles sem override usam o fallback
//                                          global; JSON inválido → fallback.
//   REALTIME_MAX_SESSIONS_PER_PLAN       → override POR PLANO/TENANT (JSON):
//                                          '{"FREE":1,"PREMIUM":5}'
//                                          O plano do usuário é lido do banco
//                                          no join (user-plan.ts, fail-open:
//                                          sem DB/coluna → null → cai no
//                                          per-role atual). Planos sem
//                                          override usam o per-role (nunca
//                                          rebaixam quem já tem limite por
//                                          role maior); JSON inválido → per-role.
const DEFAULT_MAX_SESSIONS_PER_USER = Math.max(
  1,
  Number(process.env.REALTIME_MAX_SESSIONS_PER_USER) || 1,
)
const MAX_SESSIONS_PER_ROLE = parseMaxSessionsPerRole(process.env.REALTIME_MAX_SESSIONS_PER_ROLE)
if (process.env.REALTIME_MAX_SESSIONS_PER_ROLE && !MAX_SESSIONS_PER_ROLE) {
  console.warn("[realtime] ⚠️ REALTIME_MAX_SESSIONS_PER_ROLE inválido — usando o default global")
}
const MAX_SESSIONS_PER_PLAN = parseMaxSessionsPerPlan(process.env.REALTIME_MAX_SESSIONS_PER_PLAN)
if (process.env.REALTIME_MAX_SESSIONS_PER_PLAN && !MAX_SESSIONS_PER_PLAN) {
  console.warn("[realtime] ⚠️ REALTIME_MAX_SESSIONS_PER_PLAN inválido — usando o per-role atual")
}

// ── Session-limits config resolvida (GET /sessions → painel admin) ────────
// O painel admin reflete a config ATUAL de limites por role num card de
// status: o default global + o max resolvido para cada role conhecida
// (override por role quando presente, senão o fallback global — a MESMA
// resolução que enforceSessionLimit usa no join). Fonte única: qualquer
// mudança na env reflete aqui sem tocar no card.
const SESSION_LIMITS_CONFIG = {
  default: DEFAULT_MAX_SESSIONS_PER_USER,
  perRole: Object.fromEntries(
    ["CLIENT", "PROVIDER", "ADMIN"].map((role) => [
      role,
      resolveMaxSessionsPerRole(role, MAX_SESSIONS_PER_ROLE, DEFAULT_MAX_SESSIONS_PER_USER),
    ]),
  ),
  // Override por PLANO/TENANT (quando configurado) — o card de status do
  // painel admin mostra o limite por plano; usuários sem override caem no
  // per-role. Fonte única: a MESMA env que enforceSessionLimit usa.
  perPlan: MAX_SESSIONS_PER_PLAN ?? {},
}

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
      // Pool compartilhado por booking check (fail-CLOSED: message:send com
      // bookingId é DENIED) e plan lookup (fail-OPEN: cai no per-role) — a
      // mensagem cobre os dois consumidores sem contexto enganoso.
      console.warn(
        "[realtime] ⚠️ DATABASE_URL not configured — booking checks DENIED (fail closed) e plan lookups caem no per-role (fail open)",
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

// ── User plan loader (limite de sessões POR PLANO) ────────────────────────
// Lê o plano do usuário (coluna "plan") no JOIN via o MESMO pool lazy do
// booking check. Fail-open: sem DATABASE_URL, erro de query ou coluna
// inexistente (banco pré-migration) → null → o limite cai no per-role atual
// (o plano nunca quebra o join nem derruba o serviço).
const loadUserPlan = createUserPlanLoader(loadBookingPool)

// ── Session-limit in-app notification ───────────────────────────────────────
// Quando o limite de sessões derruba um socket antigo, persiste uma notificação
// in-app (type SESSION_LIMIT — lida pelo sino do app via /api/notifications) e
// emite notification:new para a sala user:{id}, onde o socket NOVO (ainda
// conectado) mostra o toast e invalida a query do sino. Mesmo pool lazy do
// booking check; fail-open (kick nunca quebra se o insert falhar).
const notifySessionLimit = createSessionLimitNotifier(loadBookingPool)

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
// ── Renew telemetry (session:renew / cookie rotation) ─────────────────────
// Contadores de RENOVAÇÃO APLICADA (event session:renew vindo do bridge
// /emit — a reemissão de cookie do app): buckets por minuto (janela
// deslizante em memória, como os emitCounters) para ops monitorar se a
// propagação da rotação está fluindo: renews/min > 0 quando o app reemite.
// A contagem reflete sockets EFETIVAMENTE estendidos (renewSessionSockets
// EXTEND-ONLY devolve quantos atualizou) — um renew atrasado que não estende
// nada não incrementa.
// Janela de 1h (60 buckets) compartilhada pelos contadores por minuto do
// /health (renew e TTL-sweep) — a poda e a chave vivem em security.ts
// (minuteWindowKey / bumpMinuteWindow), fonte única da semântica da janela.
const MINUTE_WINDOW_MAX = 60

const renewCounters = new Map<string, number>()

// ── TTL-sweep telemetry (sockets fechados com session_expired) ────────────
// Contador de sockets ENCERRADOS pelo sweep de TTL (e pela varredura manual
// /revoke-orphans quando o motivo é TTL expirado) — buckets por minuto
// (janela deslizante de 1h em memória, MESMO helper do renew) expostos no
// /health. O flag de SPIKE acende quando um único minuto passa de
// REALTIME_EXPIRED_SPIKE_THRESHOLD expirações: sinal de ataque de sessões
// stale (lote de cookies vencendo juntos) ou bug de rotatividade
// (session:renew não propagando → expirações em massa). Dados agregados —
// sem userIds — então o /health público (SEM auth) pode expor.
const expiredCounters = new Map<string, number>()
const RAW_SPIKE_THRESHOLD = process.env.REALTIME_EXPIRED_SPIKE_THRESHOLD
const EXPIRED_SPIKE_THRESHOLD = parseExpiredSpikeThreshold(RAW_SPIKE_THRESHOLD)
// Warn consistente com a semântica do parser (security.ts): o fallback é
// usado para missing/empty/NaN/'0' — a condição espelha exatamente o parser
// para o operador nunca ver um default silencioso (negativo clampa a 1 com
// intenção e não gera warn).
if (
  RAW_SPIKE_THRESHOLD !== undefined &&
  (!Number.isFinite(Number(RAW_SPIKE_THRESHOLD)) || Number(RAW_SPIKE_THRESHOLD) === 0)
) {
  console.warn("[realtime] ⚠️ REALTIME_EXPIRED_SPIKE_THRESHOLD inválido — usando o default")
}

const RECENT_EMITS_MAX = 20
// Ring COMPLETO: carrega userId/rooms/relatedIds (presença de usuários). O
// GET /health (SEM auth) recebe a forma pública via toPublicRecentEmits(); o
// GET /health/detailed (Bearer) expõe a entrada completa para debugging do
// socket órfão.
const recentEmits: Array<RecentEmitEntry> = []

// ── Kick audit (admin "last kick reason + history" display) ────────────────
// Tracks WHY a user's sockets were force-closed (session_limit vs revoke vs
// session_expired) + the last timestamp + a running count + recent HISTORY,
// persisted in Redis (realtime:kick-audit) so it SURVIVES a realtime restart
// and the admin panel can list per-user kicks over time. Writes are BATCHED
// (debounced flush, pool de 1, cooldown env REALTIME_KICK_AUDIT_FLUSH_MS) and
// fail-open: sem REDIS_URL/Redis fora → o pending in-memory cobre o processo
// (mesmo comportamento do antigo Map). Exposed via GET /sessions
// (Bearer-protected) — por que o dashboard caiu: session_limit (2ª aba),
// revoke (admin) ou session_expired (TTL).
const telemetryLoadClient = createRedisLoader()
const kickAuditLoadClient = telemetryLoadClient as unknown as KickAuditRedisLoader
const kickAudit = createKickAuditPersister({
  loadClient: kickAuditLoadClient,
  flushIntervalMs: parseKickAuditFlushIntervalMs(process.env.REALTIME_KICK_AUDIT_FLUSH_MS),
})

function bumpEmitCounter(event: string): void {
  emitCounters.set(event, (emitCounters.get(event) ?? 0) + 1)
}

/**
 * Audit one emitted event (source="emit" = POST /emit bridge; source="socket"
 * = client-emitted handler). Best-effort: never throws into the caller.
 *
 * NOTA (segurança): o ring buffer carrega rooms/userId para debugging de
 * operação, mas o /health (endpoint SEM auth) NÃO expõe esses campos — só
 * event/source/t (toPublicRecentEmits) — para não vazar presença de
 * usuários (mesmo dado que motivou proteger /sessions com Bearer). O
 * /health/detailed (Bearer) expõe a entrada completa.
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
      userId: info.userId,
      rooms: info.rooms,
      relatedIds: info.relatedIds,
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
  /** Idade do socket em ms desde o handshake (admin exibe "há X min"). */
  ageMs: number
}

/**
 * Snapshot of all active sessions (sockets with a verified session AND a
 * join in user:{id}). Purely derived — no mutable registry.
 */
async function getActiveSessions(): Promise<SessionSocketMeta[]> {
  const sockets = await io.fetchSockets()
  const nowMs = Date.now()
  const out: SessionSocketMeta[] = []
  for (const s of sockets) {
    const session = s.data?.session as VerifiedSession | null
    const joinedAt = s.data?.joinedAt as string | null | undefined
    if (!session || !joinedAt) continue // not verified OR not joined → offline
    const connectedAt = (s.handshake?.time as string | undefined) ?? new Date(nowMs).toISOString()
    out.push({
      userId: session.userId,
      role: session.role,
      socketId: s.id,
      connectedAt,
      joinedAt,
      ageMs: computeSocketAgeMs(connectedAt, nowMs),
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
async function enforceSessionLimit(
  userId: string,
  role: string,
  justJoinedSocketId: string,
): Promise<void> {
  try {
    // Limite POR PLANO/TENANT: o plano do usuário (lido do banco, fail-open
    // → null) vence quando o env per-plan tem override; senão cai no per-role
    // atual (override por role → default global). Ex.: FREE=1, PREMIUM=5
    // (JSON no env) sobrepõem o per-role para quem tem plano no env.
    const plan = MAX_SESSIONS_PER_PLAN ? await loadUserPlan(userId) : null
    const maxSessions = resolveMaxSessionsForUser(
      plan ?? undefined,
      MAX_SESSIONS_PER_PLAN,
      role,
      MAX_SESSIONS_PER_ROLE,
      DEFAULT_MAX_SESSIONS_PER_USER,
    )
    const sockets = await io.fetchSockets()
    const toKick = selectSocketsToKickForSessionLimit(
      sockets,
      userId,
      maxSessions,
      justJoinedSocketId,
    )
    for (const s of toKick) {
      // Payload inclui o limite por role aplicado (max) — o client/painel
      // admin pode exibir "limite N" sem conhecer a config do servidor.
      s.emit("session:limit", { userId, reason: "session_limit", max: maxSessions })
      setTimeout(() => s.disconnect(true), REVOKE_CLOSE_DELAY_MS).unref()
      // Audit com o max POR ROLE aplicado (mesmo valor do payload session:limit)
      // — o tooltip do admin exibe "limite N" sem conhecer a config do servidor.
      kickAudit.record(userId, "session_limit", s.id, new Date().toISOString(), maxSessions)
      console.log(
        `[realtime] session limit: kicked socket ${s.id} for user:${userId} role:${role} plan:${plan ?? "-"} (max ${maxSessions})`,
      )
    }

    // Notificação in-app (1 por evento de kick, não por socket): o usuário vê
    // "Sua sessão foi encerrada em outro dispositivo" no sino. Best-effort —
    // sem DB ou erro no insert → apenas log, o kick já aconteceu.
    if (toKick.length > 0) {
      const created = await notifySessionLimit(userId)
      if (created) {
        // O socket NOVO (que causou o kick) está na sala user:{userId} — recebe
        // notification:new → toast + invalidação da query do sino no app.
        io.to(`user:${userId}`).emit("notification:new", {
          id: created.id,
          type: SESSION_LIMIT_TYPE,
          title: SESSION_LIMIT_TITLE,
          body: SESSION_LIMIT_BODY,
          read: false,
          createdAt: created.createdAt,
        })
        console.log(`[realtime] session_limit notification created for user:${userId}`)
      }
    }
  } catch (err) {
    console.error("[realtime] session limit error (best-effort):", err)
  }
}

// ── Periodic TTL sweep ─────────────────────────────────────────────────────
// Sessions expire by cookie TTL (default 30d) without an explicit logout. The
// app (src/lib/auth.ts getSession) fires session:revoke when it sees the expired
// cookie on the next request, but a socket with NO further traffic (idle
// dashboard/tab open for months) would never trigger that path. This sweep
// closes the gap server-side: every SWEEP_INTERVAL_MS, force-close sockets
// whose verified session (fixed at handshake, incl. expiresAt) has passed its
// TTL — same event+delayed-close pattern as session:revoke so the client
// resets its singleton instead of reconnecting with the stale cookie.
//
// Intervalo configurável via env REALTIME_TTL_SWEEP_MS (ms; default 60s;
// clamp >= 1s — parseSweepIntervalMs em security.ts, unit-tested). Um valor
// baixo (ex.: 2000) em dev/CI acelera a validação do sweep de TTL (spec
// e2e/realtime-ttl-sweep.spec.ts) sem tocar em produção.
const TTL_SWEEP_INTERVAL_MS = parseSweepIntervalMs(process.env.REALTIME_TTL_SWEEP_MS)

const ttlSweep = setInterval(async () => {
  try {
    const sockets = await io.fetchSockets()
    const expired = selectExpiredSessionSockets(sockets, Date.now())
    for (const s of expired) {
      const userId = s.data.session?.userId ?? "unknown"
      s.emit("session:revoked", { userId, reason: "session_expired" })
      setTimeout(() => s.disconnect(true), REVOKE_CLOSE_DELAY_MS).unref()
      kickAudit.record(userId, "session_expired", s.id, new Date().toISOString())
      console.log(
        `[realtime] TTL sweep: session expired for user:${userId} — closing socket ${s.id}`,
      )
    }
    // Telemetria do TTL sweep: contabiliza os sockets ENCERRADOS (expired.
    // length) no bucket do minuto — /health expõe a janela de 1h + spike
    // (sinal de ataque de sessões stale / bug de rotatividade).
    bumpMinuteWindow(expiredCounters, expired.length, MINUTE_WINDOW_MAX)
  } catch (err) {
    console.error("[realtime] TTL sweep error (best-effort):", err)
  }
}, TTL_SWEEP_INTERVAL_MS)
// Não segura o processo aberto por causa do timer.
ttlSweep.unref()

// ── Telemetry persist (Redis, janela deslizante) ──────────────────────────
// Persiste a telemetria (emitCounters + o sinal de sockets órfãos
// usersWithMultipleSockets) em Redis a cada REALTIME_TELEMETRY_INTERVAL_MS
// (default 30s; env via parseTelemetryIntervalMs) para dashboards de operação
// e alertas — o admin route do app (GET /api/admin/realtime/telemetry) lê os
// buckets de minuto + a flag. Fail-open: sem REDIS_URL ou Redis fora → loga
// (deduplicado) e segue; telemetria nunca quebra o realtime. O snapshot vem
// do MESMO getHealthSnapshot() exposto no /health (fetchSockets é a fonte da
// verdade — sem registro separado para manter em sync).
const TELEMETRY_INTERVAL_MS = parseTelemetryIntervalMs(process.env.REALTIME_TELEMETRY_INTERVAL_MS)
// Loader compartilhado: o persister escreve e o GET /metrics lê o MESMO client
// lazy (um único ioredis, docker-secret aware, memoizado) — declarado UMA vez
// no topo (usado também pelo kick-audit); esta seção apenas o consome.
const telemetry = createTelemetryPersister({
  loadClient: telemetryLoadClient,
  // Flag de órfãos: TTL ≈ 2× o intervalo — a flag self-clears quando a
  // condição deixa de ser observada (janela deslizante do "agora").
  flagTtlS: Math.max(60, Math.ceil((2 * TELEMETRY_INTERVAL_MS) / 1000)),
})

// ── Orphan-socket operational alert (Sentry/GlitchTip webhook) ─────────────
// Alerta quando usersWithMultipleSockets cruza o threshold (default 0 = qualquer
// órfão — o sintoma do HMR leak em staging antes de chegar à produção). O mesmo
// snapshot do /health alimenta o alerta; cooldown por direção (default 15min) e
// recovery notice quando cai de volta (padrão do geo-health-alert). Fail-open:
// sem DSN ou webhook fora → log dedup e segue. Envs:
//   GLITCHTIP_DSN | SENTRY_DSN            — ingest (docker-secret aware)
//   REALTIME_ORPHAN_ALERT_THRESHOLD        — default 0 (usuários multi-socket)
//   REALTIME_ORPHAN_ALERT_COOLDOWN_MS      — default 15min (clamp >= 60s)
// ⚠️ Per-processo: cada instância do realtime vê só os próprios sockets (o
// mesmo escopo da revogação/TTL/limite de sessões) — o threshold é por
// instância, não global entre réplicas.
const orphanAlertDsn = resolveAlertDsn()
if (!orphanAlertDsn) {
  console.warn(
    "[realtime] ⚠️ orphan-socket alert DISABLED — no GLITCHTIP_DSN/SENTRY_DSN configured (fail-open by design; set it to detect HMR leaks in staging)",
  )
}
const orphanAlert = createOrphanAlert({
  dsn: orphanAlertDsn,
  threshold: parseOrphanAlertThreshold(process.env.REALTIME_ORPHAN_ALERT_THRESHOLD),
  cooldownMs: parseOrphanAlertCooldownMs(process.env.REALTIME_ORPHAN_ALERT_COOLDOWN_MS),
})

let telemetryPersisting = false
const telemetryTimer = setInterval(async () => {
  // Guard de overlap: se um ciclo (fetchSockets + persist) demorar mais que o
  // intervalo, pula o próximo em vez de empilhar execuções assíncronas.
  if (telemetryPersisting) return
  telemetryPersisting = true
  try {
    const snapshot = await getHealthSnapshot()
    await telemetry.persist(
      snapshot.emitCounters as Record<string, number>,
      snapshot.sessions as unknown as TelemetrySessionsSnapshot,
    )
    // Alerta operacional sobre o MESMO snapshot do /health (fail-open interno).
    await orphanAlert.evaluate(snapshot.sessions as unknown as TelemetrySessionsSnapshot)
  } catch (err) {
    // Best-effort: nunca pode rejeitar (unhandled rejection) — o persister e o
    // alerta já são fail-open; este catch cobre erros do snapshot em si.
    console.error("[realtime] telemetry timer error (best-effort):", err)
  } finally {
    telemetryPersisting = false
  }
}, TELEMETRY_INTERVAL_MS)
telemetryTimer.unref()

// ── Session renewal (cookie rotation) ─────────────────────────────────────
// The app's getSession reissues the cookie past the rotation threshold (<15d
// remaining, src/lib/auth.ts) and propagates the NEW expiry via the
// Bearer-protected /emit bridge (event session:renew). Sockets fix expiresAt
// at HANDSHAKE time, so without this the TTL sweep would close a still-valid
// re-issued session when the ORIGINAL expiry passes. renewSessionSockets is
// EXTEND-ONLY: a stale/out-of-order renewal is a no-op (never shortens).
// Same fetchSockets sweep as session:revoke, so connected-but-not-joined
// sockets are covered too.
function handleSessionRenew(payload: { userId?: string; expiresAt?: number }): void {
  const { userId, expiresAt } = payload || {}
  if (!userId || typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return
  io.fetchSockets()
    .then((sockets) => {
      const updated = renewSessionSockets(sockets, userId, expiresAt)
      // Telemetria: contabiliza a renovação APLICADA (sockets efetivamente
      // estendidos) no bucket do minuto — ops vê renews/min no /health.
      bumpMinuteWindow(renewCounters, updated, MINUTE_WINDOW_MAX)
      console.log(
        `[realtime] session renewed for user:${userId} — ${updated} socket(s) re-expired to ${expiresAt}`,
      )
    })
    .catch((err) => {
      console.error("[realtime] session:renew fetchSockets error:", err)
    })
}

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
      // Kick audit: revoke can hit many sockets at once — record ONE entry
      // per revoke event (count tracks revokes, not sockets). Only record
      // when a socket was actually force-closed — repo principle: the audit
      // reflects real events, not attempts.
      if (revocable.length > 0) {
        kickAudit.record(userId, "revoke", revocable[0]?.id ?? "", new Date().toISOString())
      }
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
        enforceSessionLimit(userId, sess.role, socket.id).catch((err) => {
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
  let extendedExpirySockets = 0
  const sessions: SessionMetaLike[] = []
  try {
    const sockets = await io.fetchSockets()
    socketsCount = sockets.length
    // Sockets com expiry estendido pela rotação de cookie (session:renew) —
    // derivado ao vivo (fetchSockets é a fonte da verdade, sem registro
    // paralelo): quem foi renovado e ainda está conectado conta aqui.
    extendedExpirySockets = countRenewedSockets(sockets)
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
  // fromEntries calculado UMA vez por snapshot (usado em perMinute E nas
  // métricas) — evita duplicar o trabalho em cada chamada do /health,
  // timer de telemetria ou alerta de órfãos.
  const expiredPerMinute = Object.fromEntries(expiredCounters)
  return {
    uptimeSeconds: Math.floor(process.uptime()),
    sockets: { total: socketsCount, verified: verifiedCount, joined: joinedCount },
    sessions: metrics,
    emitCounters: Object.fromEntries(emitCounters),
    // Telemetria da rotação de cookie: renews APLICADOS por minuto (janela
    // deslizante de 1h em memória) + o total ATUAL de sockets com expiry
    // estendido — ops monitora se a propagação session:renew está fluindo
    // (renews/min > 0 quando o app reemite; socketsWithExtendedExpiry conta
    // quem já foi estendido e segue conectado). Dados agregados — sem
    // userIds — então o /health público (SEM auth) pode expor.
    renews: {
      perMinute: Object.fromEntries(renewCounters),
      socketsWithExtendedExpiry: extendedExpirySockets,
    },
    // Telemetria do TTL sweep: sockets encerrados com session_expired na
    // janela de 1h (perMinute + lastHourTotal + maxPerMinute) e o flag de
    // SPIKE (maxPerMinute > REALTIME_EXPIRED_SPIKE_THRESHOLD) — sinal de
    // ataque de sessões stale (lote de cookies vencendo juntos) ou bug de
    // rotatividade (session:renew não propagando → expirações em massa).
    // Dados AGREGADOS (sem userIds) — o /health público (SEM auth) expõe.
    ttlSweep: {
      perMinute: expiredPerMinute,
      ...computeExpiredSweepMetrics(expiredPerMinute, EXPIRED_SPIKE_THRESHOLD),
      spikeThreshold: EXPIRED_SPIKE_THRESHOLD,
    },
    // Fronteira de privacidade: o /health é SEM auth — só a forma pública
    // (sem userId/rooms). O detalhe completo vive no /health/detailed (Bearer).
    recentEmits: toPublicRecentEmits(recentEmits.slice(-10)),
  }
}

type SessionMetaLike = {
  userId: string
  role: string
  socketId: string
}

// ---------- HTTP routing (admin endpoints + socket.io delegation) ----------
// GET  /health          -> público: { status, sockets, sessions, emitCounters,
//                           recentEmits } — SEM userId/rooms (privacidade)
// GET  /health/detailed -> Bearer: snapshot + recentEmits COMPLETO (userId/
//                           rooms) + kick audit — debugging do socket órfão  // GET /sessions        -> Bearer: sessões ativas + kicks
// GET /metrics         -> Bearer: telemetria persistida no Redis (emitCounters
//                           por minuto + histórico usersWithMultipleSockets +
//                           flag órfã) — dashboards de operação
// POST /revoke-orphans -> Bearer: desconecta sockets órfãos (sessão TTL
//                           expirada OU usuário não existe mais no DB)
// POST /emit            -> Bearer: bridge server→server usado pelo app
// Every other request is delegated to engine.io (socket.io handshakes).
httpServer.on("request", (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost")

  // GET /health/detailed (Bearer) — o detalhe que o /health público omite:
  // recentEmits COMPLETO com userId/rooms/relatedIds (rastreio de quem emitiu
  // o quê para qual sala — o diagnóstico do socket órfão do HMR) + o kick
  // audit. Mesma proteção do /sessions: expõe presença de usuários, então
  // nunca pode ser reachable sem Bearer.
  if (url.pathname === "/health/detailed" && req.method === "GET") {
    if (!verifyEmitToken(req.headers.authorization, EMIT_TOKEN)) {
      res.writeHead(401, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }))
      return
    }
    getHealthSnapshot()
      .then(async (snapshot) => {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            ok: true,
            ...snapshot,
            // Sobrescreve o recentEmits já stripped pelo snapshot com a forma
            // COMPLETA (ring inteiro, não só os últimos 10 do /health).
            recentEmits: recentEmits.slice(-RECENT_EMITS_MAX),
            // Kick audit persistido no Redis (sobrevive a restart): última
            // razão + contagem + histórico por usuário.
            kicks: await kickAudit.snapshot(),
          }),
        )
      })
      .catch((err) => {
        console.error("[realtime] /health/detailed error:", err)
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: false, error: "internal" }))
      })
    return
  }

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
      .then(async (sessions) => {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(
          JSON.stringify({
            ok: true,
            sessions,
            total: sessions.length,
            // Config atual de limites por role (default + max resolvido por
            // role) — o painel admin exibe num card de status; reflete a
            // MESMA resolução do join (fonte única: SESSION_LIMITS_CONFIG).
            limits: SESSION_LIMITS_CONFIG,
            // Kick audit persistido no Redis (sobrevive a restart): motivo do
            // último kick por usuário (session_limit/revoke/expired) + contagem
            // + histórico + o limite aplicado (max) — consumido pelo painel
            // admin (Bearer-protected).
            kicks: await kickAudit.snapshot(),
          }),
        )
      })
      .catch((err) => {
        console.error("[realtime] /sessions error:", err)
        res.writeHead(500, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: false, error: "internal" }))
      })
    return
  }

  // GET /metrics -> telemetria persistida no Redis (janela deslizante por
  // minuto, TTL 24h): emitCounters agregados + histórico do sinal de sockets
  // órfãos (usersWithMultipleSockets) + a flag "órfãos agora". Mesma proteção
  // Bearer do /sessions e /health/detailed: é dado operacional do serviço.
  // Redis fora → `{ ok: false, available: false }` (degradação graciosa, o
  // dashboard mostra a telemetria como offline — nunca 500).
  // POST /revoke-orphans (Bearer) — varredura manual de sockets órfãos,
  // disparada pelo botão "Revogar sockets órfãos" do painel admin (o app
  // proxyia via /api/admin/realtime/sessions/revoke-orphans). Um socket é
  // órfão quando a sessão verificada no handshake (socket.data.session):
  //   (a) expirou por TTL (cookie expiresAt no passado — o sweep periódico
  //       fecharia, o admin quer AGORA), ou
  //   (b) aponta para um userId que não existe (mais) no banco — conta
  //       soft-deletada/removida com socket stale ainda na sala user:{id}.
  // Usa o MESMO padrão do session:revoke/sweep: evento session:revoked +
  // force-close atrasado (flush do pacote) + kick audit. A checagem de
  // existência no DB reusa o pool pg lazy do booking check — fail-open:
  // sem DATABASE_URL ou erro no query, sockets NÃO são derrubados por essa
  // rota (evita desconectar usuários válidos por falha de infra); os
  // expirados por TTL são sempre revogados (não dependem do DB).
  if (url.pathname === "/revoke-orphans" && req.method === "POST") {
    if (!verifyEmitToken(req.headers.authorization, EMIT_TOKEN)) {
      res.writeHead(401, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }))
      return
    }
    ;(async () => {
      const nowMs = Date.now()
      const sockets = await io.fetchSockets()

      // isUserAlive: userId existe no banco? Fail-open — sem pool ou erro no
      // query devolve true (usuário considerado vivo, não revoga por engano).
      let checkPool: PoolLike | null = null
      try {
        checkPool = await loadBookingPool()
      } catch {
        checkPool = null
      }
      const isUserAlive = async (userId: string): Promise<boolean> => {
        if (!checkPool) return true
        try {
          // Tabela "User" (sem @@map — como "Booking" no booking check),
          // colunas camelCase. `deletedAt IS NULL` exclui contas soft-deletadas.
          const r = await checkPool.query(
            'SELECT 1 FROM "User" WHERE id = $1 AND "deletedAt" IS NULL',
            [userId],
          )
          return (r.rowCount ?? 0) > 0
        } catch (err) {
          console.error(
            `[realtime] revoke-orphans user check failed for ${userId} (fail-open):`,
            err,
          )
          return true
        }
      }

      const { expired, missingUser, toRevoke, userIdsToCheck } = await selectOrphanSockets(
        sockets,
        nowMs,
        isUserAlive,
      )

      const reasonBySocket = new Map<string, string>()
      for (const s of expired) reasonBySocket.set(s.id, "session_expired")
      for (const s of missingUser) reasonBySocket.set(s.id, "revoke")

      for (const s of toRevoke) {
        const userId = s.data.session?.userId ?? "unknown"
        const reason = reasonBySocket.get(s.id) ?? "revoke"
        s.emit("session:revoked", { userId, reason })
        setTimeout(() => s.disconnect(true), REVOKE_CLOSE_DELAY_MS).unref()
        // Kick audit com o MESMO reason emitido (session_expired para TTL,
        // revoke para usuário inexistente) — o painel admin mostra o motivo
        // real do último kick, consistente com o que o client recebeu.
        kickAudit.record(
          userId,
          reason as "revoke" | "session_expired",
          s.id,
          new Date().toISOString(),
        )
        console.log(`[realtime] revoke-orphans: closing ${s.id} for user:${userId} (${reason})`)
      }

      // Telemetria do TTL sweep: os sockets fechados por TTL expirado nesta
      // varredura manual também entram na MESMA janela do /health (spike
      // reflete o volume real de expirações, não só o sweep periódico).
      bumpMinuteWindow(expiredCounters, expired.length, MINUTE_WINDOW_MAX)

      console.log(
        `[realtime] revoke-orphans: ${toRevoke.length} sockets revogados (${expired.length} TTL expirado, ${missingUser.length} usuário inexistente; ${userIdsToCheck.length} userIds checados)`,
      )
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(
        JSON.stringify({
          ok: true,
          revoked: toRevoke.length,
          expired: expired.length,
          missingUser: missingUser.length,
          checkedUsers: userIdsToCheck.length,
        }),
      )
    })().catch((err) => {
      console.error("[realtime] /revoke-orphans error:", err)
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: "internal" }))
    })
    return
  }

  if (url.pathname === "/metrics" && req.method === "GET") {
    if (!verifyEmitToken(req.headers.authorization, EMIT_TOKEN)) {
      res.writeHead(401, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: false, error: "UNAUTHORIZED" }))
      return
    }
    const rawMinutes = Number(url.searchParams.get("minutes") ?? DEFAULT_METRICS_MINUTES)
    ;(async () => {
      const client = await telemetryLoadClient()
      if (!client) {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: false, available: false }))
        return
      }
      const window = await readTelemetryWindow(client, rawMinutes, Date.now())
      if (!window) {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ ok: false, available: false }))
        return
      }
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ok: true, ...window }))
    })().catch((err) => {
      console.error("[realtime] /metrics error:", err)
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
          case "session:renew":
            handleSessionRenew(data as { userId?: string; expiresAt?: number })
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
