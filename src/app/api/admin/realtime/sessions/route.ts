import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"

/**
 * ADMIN: active realtime sessions (who is online).
 *
 * Proxies the realtime mini-service GET /sessions (Bearer-protected) and
 * aggregates it into a userId → session list map so the admin users table
 * can render an "Online" indicator without knowing socket internals.
 *
 * The mini-service derives presence from the sockets' verified handshake
 * session (socket.data.session) — no separate registry to keep in sync.
 * A down/unreachable realtime service degrades gracefully (sessions: {}),
 * so the admin table never breaks because realtime is offline.
 */

const REALTIME_URL = process.env.REALTIME_URL ?? "http://localhost:3003"
const EMIT_TOKEN = process.env.REALTIME_EMIT_TOKEN
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
}

/** Último kick por usuário (session_limit vs revoke vs session_expired). */
export type RealtimeKickInfo = {
  reason: "session_limit" | "session_expired" | "revoke"
  at: string
  count: number
}

export type AdminRealtimeSessionsResponse = {
  ok: boolean
  /** userId → sockets ativos (sessões revogáveis). */
  sessions: Record<string, RealtimeSession[]>
  /** Soma de sockets ativos (presença única de usuários online). */
  totalSockets: number
  onlineUsers: number
  /** Motivo do último kick por usuário (ex.: conflito de sessão). */
  kicks: Record<string, RealtimeKickInfo>
}

/** Resposta vazia de degradação graciosa (realtime fora do ar / sem token). */
const EMPTY: AdminRealtimeSessionsResponse = {
  ok: false,
  sessions: {},
  totalSockets: 0,
  onlineUsers: 0,
  kicks: {},
}

export async function GET(): Promise<NextResponse<AdminRealtimeSessionsResponse>> {
  try {
    await requireRole("ADMIN")

    if (!EMIT_TOKEN) {
      // Fail-closed no mini-service: sem token não há como consultar. A tabela
      // admin segue sem indicador (degradação graciosa), nunca quebra.
      return NextResponse.json(EMPTY)
    }

    const res = await fetch(`${REALTIME_URL}/sessions`, {
      method: "GET",
      headers: { Authorization: `Bearer ${EMIT_TOKEN}` },
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
    }
    const list = data.sessions ?? []

    const sessions: Record<string, RealtimeSession[]> = {}
    for (const s of list) {
      if (!s?.userId) continue
      ;(sessions[s.userId] ??= []).push(s)
    }
    const onlineUsers = Object.keys(sessions).length

    return NextResponse.json({
      ok: true,
      sessions,
      totalSockets: list.length,
      onlineUsers,
      kicks: data.kicks ?? {},
    })
  } catch (e) {
    // Degradação graciosa: realtime fora do ar → sem indicador, sem erro 500.
    if (e instanceof Error && e.name === "TimeoutError") {
      return NextResponse.json(EMPTY)
    }
    const err = handleError(e) as NextResponse<unknown>
    return err as NextResponse<AdminRealtimeSessionsResponse>
  }
}
