import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"

/**
 * ADMIN: active realtime sessions (who is online) — sockets per user with
 * age + session conflicts/orphans for real-time visualization.
 *
 * Proxies the realtime mini-service GET /sessions (Bearer-protected) and
 * aggregates it into a userId → session list map so the admin users table
 * can render an "Online" indicator without knowing socket internals.
 *
 * Response: `sessions[userId]` (each socket with `connectedAt` + `ageMs` —
 * age since handshake), `totalSockets`, `onlineUsers`, `kicks` (last kick
 * reason: session_limit/revoke/session_expired), `conflicts[]` (users with
 * >1 simultaneous socket — the orphan signal: HMR leak, stale session,
 * multi-tab; sorted by severity with `oldestAgeMs` + the user's last kick
 * as context) and `usersWithMultipleSockets` (count).
 *
 * The mini-service derives presence from the sockets' verified handshake
 * session (socket.data.session) — no separate registry to keep in sync.
 * A down/unreachable realtime service degrades gracefully (sessions: {}),
 * so the admin table never breaks because realtime is offline.
 */

// Porta do mini-service (fallback 3003) — derivada na URL default do proxy
// (isolation: REALTIME_PORT=3199 reflete aqui sem tocar em código).
const REALTIME_PORT = process.env.REALTIME_PORT ?? "3003"
const REALTIME_URL = process.env.REALTIME_URL ?? `http://localhost:${REALTIME_PORT}`
// Timeout (ms) do fetch para o mini-service. Um realtime que aceita o TCP
// mas nunca responde deixaria o request pendurado — AbortSignal.timeout()
// aborta após o prazo (o catch devolve sessions vazio, degradação graciosa).
const REALTIME_SESSIONS_TIMEOUT_MS = Math.max(
  1,
  Number(process.env.REALTIME_SESSIONS_TIMEOUT_MS) || 3_000,
)

type RealtimeSession = {
  userId: string
  role: string
  socketId: string
  connectedAt: string
  joinedAt: string | null
  /** Idade do socket em ms desde o handshake (ex.: "há 3 min"). */
  ageMs?: number
}

/** Último kick por usuário (session_limit vs revoke vs session_expired),
 *  persistido no Redis do realtime (sobrevive a restart) — inclui o
 *  HISTÓRICO recente (oldest → newest) que o tooltip do painel lista. `max`
 *  é o limite de sessões por role aplicado no kick (session_limit) — o mesmo
 *  valor do payload session:limit emitido ao socket derrubado. */
export type RealtimeKickInfo = {
  reason: "session_limit" | "session_expired" | "revoke"
  at: string
  count: number
  /** Limite de sessões por role aplicado no último kick (session_limit). */
  max?: number
  /** Histórico recente de kicks do usuário (bounded, oldest → newest). */
  history?: Array<{
    reason: "session_limit" | "session_expired" | "revoke"
    at: string
    socketId: string
    max?: number
  }>
}

/** Conflito de sessão/órfão: um usuário com >1 socket ativo em paralelo. */
export type SessionConflict = {
  userId: string
  role: string
  /** Nº de sockets simultâneos (1 socket = ok; >1 = conflito/órfão). */
  socketCount: number
  /** Idade do socket mais antigo — quanto tempo a duplicata persiste. */
  oldestAgeMs: number
  /** Motivo do último kick do usuário (se houve) — contexto do conflito. */
  lastKick: RealtimeKickInfo | null
}

/** Config atual de limites de sessões por role E por plano (GET /sessions do
 *  realtime): o default global + o max resolvido por role (override por role
 *  quando presente, senão o fallback global) + o override por PLANO/tenant
 *  (REALTIME_MAX_SESSIONS_PER_PLAN — ex.: FREE=1, PREMIUM=5; vazio quando
 *  não configurado). Espelho do SESSION_LIMITS_CONFIG do mini-service — o
 *  card de status do dashboard reflete sem conhecer envs. */
export type RealtimeLimitsConfig = {
  default: number
  perRole: Record<string, number>
  /** Override por plano/tenant (vazio quando REALTIME_MAX_SESSIONS_PER_PLAN
   *  não está configurado — usuários caem no per-role). */
  perPlan?: Record<string, number>
}

export type AdminRealtimeSessionsResponse = {
  ok: boolean
  /** userId → sockets ativos (sessões revogáveis, cada um com ageMs). */
  sessions: Record<string, RealtimeSession[]>
  /** Usuários online resolvidos (name/email/avatar) — a página dedicada de
   *  sessões busca por e-mail e exibe nome; o realtime só devolve userId/role.
   *  Vazio (fail-open) se o lookup no banco falhar ou não houver online. */
  users?: Record<string, { name: string; email: string; avatarUrl: string | null }>
  /** Soma de sockets ativos (presença única de usuários online). */
  totalSockets: number
  onlineUsers: number
  /** Motivo do último kick por usuário (ex.: conflito de sessão). */
  kicks: Record<string, RealtimeKickInfo>
  /** Conflitos de sessão/órfãos: usuários com >1 socket, do maior pro menor. */
  conflicts: SessionConflict[]
  /** Total de usuários em conflito (len(conflicts)) — para cards/badges. */
  usersWithMultipleSockets: number
  /** Config atual de limites por role (default + perRole) — card de status. */
  limits?: RealtimeLimitsConfig
}

/**
 * Deriva os conflitos de sessão (usuários com >1 socket ativo — o sintoma
 * do órfão: HMR leak, sessão stale que vazou, ou multi-tab legítimo) a partir
 * do agrupamento userId → sockets. Ordena do maior nº de sockets pro menor
 * (desempate: socket mais antigo) e junta o último kick do usuário como
 * contexto. Pura — unit-testada (admin route test).
 */
export function buildSessionConflicts(
  sessions: Record<string, RealtimeSession[]>,
  kicks: Record<string, RealtimeKickInfo>,
): SessionConflict[] {
  const conflicts: SessionConflict[] = []
  for (const [userId, list] of Object.entries(sessions)) {
    if (list.length < 2) continue
    const oldestAgeMs = Math.max(...list.map((s) => s.ageMs ?? 0))
    conflicts.push({
      userId,
      role: list[0]?.role ?? "unknown",
      socketCount: list.length,
      oldestAgeMs,
      lastKick: kicks[userId] ?? null,
    })
  }
  return conflicts.sort((a, b) => b.socketCount - a.socketCount || b.oldestAgeMs - a.oldestAgeMs)
}

/** Resposta vazia de degradação graciosa (realtime fora do ar / sem token). */
const EMPTY: AdminRealtimeSessionsResponse = {
  ok: false,
  sessions: {},
  users: {},
  totalSockets: 0,
  onlineUsers: 0,
  kicks: {},
  conflicts: [],
  usersWithMultipleSockets: 0,
}

export async function GET(): Promise<NextResponse<AdminRealtimeSessionsResponse>> {
  try {
    await requireRole("ADMIN")

    // Lazy (não capturado no load do módulo): permite rotação do token sem
    // restart e os unit tests controlam o env por teste.
    const emitToken = process.env.REALTIME_EMIT_TOKEN
    if (!emitToken) {
      // Fail-closed no mini-service: sem token não há como consultar. A tabela
      // admin segue sem indicador (degradação graciosa), nunca quebra.
      return NextResponse.json(EMPTY)
    }

    const res = await fetch(`${REALTIME_URL}/sessions`, {
      method: "GET",
      headers: { Authorization: `Bearer ${emitToken}` },
      signal: AbortSignal.timeout(REALTIME_SESSIONS_TIMEOUT_MS),
    })

    if (!res.ok) {
      return NextResponse.json(EMPTY)
    }

    const data = (await res.json()) as {
      ok?: boolean
      sessions?: RealtimeSession[]
      total?: number
      kicks?: Record<string, RealtimeKickInfo>
      limits?: RealtimeLimitsConfig
    }
    const list = data.sessions ?? []

    const sessions: Record<string, RealtimeSession[]> = {}
    for (const s of list) {
      if (!s?.userId) continue
      ;(sessions[s.userId] ??= []).push(s)
    }
    const onlineUsers = Object.keys(sessions).length
    // Resolve nome/e-mail/avatar dos usuários online (1 query, não N+1) para
    // a página dedicada de sessões ativas: exibir nome e buscar por e-mail.
    // O realtime só devolve userId/role — este map enriquece a resposta.
    // Fail-open: DB fora ou erro no query → users vazio; a página degrada
    // para userId (nunca 500 — mesmo contrato do resto da rota).
    const onlineIds = Object.keys(sessions)
    const users: AdminRealtimeSessionsResponse["users"] = {}
    if (onlineIds.length > 0) {
      try {
        const found = await db.user.findMany({
          where: { id: { in: onlineIds } },
          select: { id: true, name: true, email: true, avatarUrl: true },
        })
        for (const u of found) {
          users[u.id] = { name: u.name, email: u.email, avatarUrl: u.avatarUrl }
        }
      } catch (lookupErr) {
        console.error("[admin] realtime sessions user lookup failed (fail-open):", lookupErr)
      }
    }
    // Conflitos de sessão/órfãos em tempo real (usuários com >1 socket),
    // ordenados por gravidade — o admin vê quem está duplicado AGORA e há
    // quanto tempo, com o motivo do último kick como contexto.
    const conflicts = buildSessionConflicts(sessions, data.kicks ?? {})

    return NextResponse.json({
      ok: true,
      sessions,
      users,
      totalSockets: list.length,
      onlineUsers,
      kicks: data.kicks ?? {},
      conflicts,
      usersWithMultipleSockets: conflicts.length,
      // Config de limites por role (default + perRole) — o card de status do
      // dashboard reflete a config atual sem conhecer as envs do realtime.
      limits: data.limits,
    })
  } catch (e) {
    // Degradação graciosa: realtime fora do ar → sem indicador, sem erro 500.
    // Check POR NOME (não instanceof): em Bun, um DOMException de
    // AbortSignal.timeout NÃO é instanceof Error — o instanceof deixaria o
    // timeout cair no handleError (401/500) em vez de EMPTY.
    if (typeof e === "object" && e !== null && (e as { name?: unknown }).name === "TimeoutError") {
      return NextResponse.json(EMPTY)
    }
    const err = handleError(e) as NextResponse<unknown>
    return err as NextResponse<AdminRealtimeSessionsResponse>
  }
}
