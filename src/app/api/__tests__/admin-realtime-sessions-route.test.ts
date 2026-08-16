/**
 * Tests for GET /api/admin/realtime/sessions.
 *
 * A rota proxy o GET /sessions do realtime (Bearer-protected) e agrega por
 * userId. Este teste trava o CONTRATO do delta SESSION-CONFLICT-ADMIN:
 * o campo `kicks` (motivo do último kick por usuário — session_limit vs
 * revoke vs session_expired) é passado através do mini-service para o
 * painel admin, e a degradação graciosa (realtime fora do ar / sem token)
 * continua devolvendo sessões vazias SEM erro 500.
 *
 * NOTA sobre env: a rota lê REALTIME_EMIT_TOKEN/REALTIME_URL em escopo de
 * módulo (constantes avaliadas no import) — por isso o módulo é importado
 * DINAMICAMENTE (vi.resetModules + import) em cada teste, DEPOIS do stub
 * do env. Um import estático no topo congelaria o env do primeiro teste.
 *
 * Cobre:
 *   - 200: sessions agregadas por userId + totalSockets + onlineUsers + kicks
 *   - kicks ausentes no mini-service → {} (retrocompatível)
 *   - Sem REALTIME_EMIT_TOKEN → degradação graciosa (sem fetch)
 *   - Realtime fora do ar (fetch !ok) → degradação graciosa
 *   - Timeout (AbortSignal) → degradação graciosa
 *   - Não-autenticado → 401 (requireRole)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextResponse } from "next/server"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

let _mockRole: string | null = "ADMIN"

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockImplementation(async (role: string) => {
    if (_mockRole == null) throw new Error("UNAUTHORIZED")
    if (_mockRole !== role) throw new Error("FORBIDDEN")
    return { userId: "admin-1", role: "ADMIN" }
  }),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ── Helpers ────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  // `ok` é derivado do status pelo fetch (200-299 → ok) — não é uma
  // propriedade de ResponseInit; use o status para controlar res.ok.
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

type SessionsRoute = {
  GET: () => Promise<NextResponse>
}

/** Importa a rota DINAMICAMENTE para que o env seja lido no momento do teste. */
async function loadRoute(): Promise<SessionsRoute> {
  vi.resetModules()
  return (await import("../admin/realtime/sessions/route")) as unknown as SessionsRoute
}

const REALTIME_URL_TEST = "http://localhost:3999"

// ── Suite ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  _mockRole = "ADMIN"
})

afterEach(() => {
  _mockRole = "ADMIN"
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("GET /api/admin/realtime/sessions", () => {
  it("200: agrega sessions por userId e passa o campo kicks do mini-service", async () => {
    vi.stubEnv("REALTIME_EMIT_TOKEN", "emit-token-test")
    vi.stubEnv("REALTIME_URL", REALTIME_URL_TEST)
    const mockFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        total: 3,
        sessions: [
          {
            userId: "u1",
            role: "PROVIDER",
            socketId: "s1",
            connectedAt: "2026-08-16T10:00:00Z",
            joinedAt: "2026-08-16T10:00:01Z",
          },
          {
            userId: "u1",
            role: "PROVIDER",
            socketId: "s2",
            connectedAt: "2026-08-16T10:00:02Z",
            joinedAt: "2026-08-16T10:00:03Z",
          },
          {
            userId: "u2",
            role: "CLIENT",
            socketId: "s3",
            connectedAt: "2026-08-16T10:00:04Z",
            joinedAt: "2026-08-16T10:00:05Z",
          },
        ],
        kicks: {
          u1: { reason: "session_limit", at: "2026-08-16T10:05:00Z", count: 3 },
          u2: { reason: "revoke", at: "2026-08-16T09:00:00Z", count: 1 },
        },
      }),
    )
    vi.stubGlobal("fetch", mockFetch)

    const { GET } = await loadRoute()
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      sessions: Record<string, unknown[]>
      totalSockets: number
      onlineUsers: number
      kicks: Record<string, { reason: string; at: string; count: number }>
    }

    // Conflito de sessão: u1 tem 2 sockets ativos (limite do realtime é 1).
    expect(body.ok).toBe(true)
    expect(body.sessions.u1?.length).toBe(2)
    expect(body.sessions.u2?.length).toBe(1)
    expect(body.totalSockets).toBe(3)
    expect(body.onlineUsers).toBe(2)
    // Kick audit passado através.
    expect(body.kicks.u1).toEqual({ reason: "session_limit", at: "2026-08-16T10:05:00Z", count: 3 })
    expect(body.kicks.u2?.reason).toBe("revoke")

    // O fetch foi chamado com Bearer e timeout (AbortSignal.timeout).
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0] as [
      string,
      { headers: Record<string, string>; signal: AbortSignal },
    ]
    expect(url).toBe(`${REALTIME_URL_TEST}/sessions`)
    expect(init.headers.Authorization).toBe("Bearer emit-token-test")
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it("200: kicks ausentes no mini-service → {} (retrocompatível)", async () => {
    vi.stubEnv("REALTIME_EMIT_TOKEN", "emit-token-test")
    vi.stubEnv("REALTIME_URL", REALTIME_URL_TEST)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          ok: true,
          total: 0,
          sessions: [],
        }),
      ),
    )

    const { GET } = await loadRoute()
    const res = await GET()
    const body = (await res.json()) as { kicks: unknown; ok: boolean }
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.kicks).toEqual({})
  })

  it("degrada graciosamente sem REALTIME_EMIT_TOKEN (sem fetch, sem 500)", async () => {
    vi.stubEnv("REALTIME_EMIT_TOKEN", "")
    const mockFetch = vi.fn()
    vi.stubGlobal("fetch", mockFetch)

    const { GET } = await loadRoute()
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; sessions: unknown; kicks: unknown }
    expect(body.ok).toBe(false)
    expect(body.sessions).toEqual({})
    expect(body.kicks).toEqual({})
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("degrada graciosamente quando o realtime responde !ok", async () => {
    vi.stubEnv("REALTIME_EMIT_TOKEN", "emit-token-test")
    vi.stubEnv("REALTIME_URL", REALTIME_URL_TEST)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ ok: false }, 500)))

    const { GET } = await loadRoute()
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; sessions: unknown; kicks: unknown }
    expect(body.ok).toBe(false)
    expect(body.sessions).toEqual({})
    expect(body.kicks).toEqual({})
  })

  it("degrada graciosamente em timeout do AbortSignal", async () => {
    vi.stubEnv("REALTIME_EMIT_TOKEN", "emit-token-test")
    vi.stubEnv("REALTIME_URL", REALTIME_URL_TEST)
    const timeoutError = new Error("The operation was aborted due to timeout")
    timeoutError.name = "TimeoutError"
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeoutError))

    const { GET } = await loadRoute()
    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; sessions: unknown; kicks: unknown }
    expect(body.ok).toBe(false)
    expect(body.sessions).toEqual({})
    expect(body.kicks).toEqual({})
  })

  it("401 quando não autenticado — sem fetch ao mini-service", async () => {
    _mockRole = null
    vi.stubEnv("REALTIME_EMIT_TOKEN", "emit-token-test")
    vi.stubEnv("REALTIME_URL", REALTIME_URL_TEST)
    const mockFetch = vi.fn()
    vi.stubGlobal("fetch", mockFetch)

    const { GET } = await loadRoute()
    const res = await GET()
    expect(res.status).toBe(401)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
