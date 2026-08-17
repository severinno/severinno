/**
 * Tests for GET /api/admin/realtime/sessions — active realtime sessions per
 * user with socket age + conflicts/orphans view.
 *
 * Coverage:
 *   1. 401/403 when requireRole rejects (admin only)
 *   2. Degradation: no EMIT_TOKEN or realtime down → EMPTY (never 500)
 *   3. Groups by userId, passes through ageMs/kicks, derives conflicts
 *      (users with >1 socket, sorted by severity, merged with last kick)
 *   4. buildSessionConflicts unit cases (pure)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

const { mockRequireRole, mockHandleError } = vi.hoisted(() => ({
  mockRequireRole: vi.fn(),
  mockHandleError: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  requireRole: mockRequireRole,
}))
vi.mock("@/lib/api-server", () => ({
  handleError: mockHandleError,
}))

import { GET, buildSessionConflicts, type RealtimeKickInfo } from "../sessions/route"

const ADMIN = { userId: "admin-1", role: "ADMIN" }

const KICK: RealtimeKickInfo = { reason: "session_limit", at: "2026-08-16T12:00:00.000Z", count: 2 }

function fakeSessionsResponse() {
  return {
    ok: true,
    sessions: [
      // u1: 2 sockets (conflito/órfão), socket antigo 5min
      {
        userId: "u1",
        role: "PROVIDER",
        socketId: "s1",
        connectedAt: "2026-08-16T11:55:00.000Z",
        joinedAt: "2026-08-16T11:55:01.000Z",
        ageMs: 300_000,
      },
      {
        userId: "u1",
        role: "PROVIDER",
        socketId: "s2",
        connectedAt: "2026-08-16T12:00:00.000Z",
        joinedAt: "2026-08-16T12:00:01.000Z",
        ageMs: 0,
      },
      // u2: 1 socket (ok)
      {
        userId: "u2",
        role: "CLIENT",
        socketId: "s3",
        connectedAt: "2026-08-16T11:50:00.000Z",
        joinedAt: "2026-08-16T11:50:01.000Z",
        ageMs: 600_000,
      },
    ],
    total: 3,
    kicks: { u1: KICK },
  }
}

function mockFetchOk(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })),
  )
}

function mockFetchFail() {
  // Rejeita com um objeto SEM prototype de Error — em Bun, o DOMException do
  // AbortSignal.timeout NÃO é instanceof Error, então o check por nome é o
  // único caminho que chega ao EMPTY. Um `instanceof` antigo falharia aqui
  // (cairia no handleError) — o teste trava o contrato do caso Bun.
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue({ name: "TimeoutError", message: "timed out" }))
}

beforeEach(() => {
  // resetAllMocks (não clearAllMocks): também zera IMPLEMENTAÇÕES setadas
  // com mockReturnValue — sem isso, o mockHandleError(401) do 1º teste
  // vazaria para os demais (clear só limpa chamadas, não a implementação).
  vi.resetAllMocks()
  vi.unstubAllGlobals()
  // Ambiente determinístico: nenhum teste pode vazar REALTIME_EMIT_TOKEN
  // para o próximo (o teste "sem token" exige ausência; os demais setam).
  delete process.env.REALTIME_EMIT_TOKEN
})

describe("GET /api/admin/realtime/sessions", () => {
  it("rejeita sem role ADMIN (requireRole lança → handleError)", async () => {
    mockRequireRole.mockRejectedValue(new Error("UNAUTHORIZED"))
    mockHandleError.mockReturnValue(NextResponse.json({ error: "Não autorizado" }, { status: 401 }))

    const res = await GET()
    expect(res.status).toBe(401)
    expect(mockHandleError).toHaveBeenCalled()
  })

  it("degradação: sem REALTIME_EMIT_TOKEN → EMPTY (fail-closed no mini-service)", async () => {
    mockRequireRole.mockResolvedValue(ADMIN)
    const orig = process.env.REALTIME_EMIT_TOKEN
    delete process.env.REALTIME_EMIT_TOKEN
    try {
      const res = await GET()
      const body = (await res.json()) as { ok: boolean; sessions: unknown; conflicts: unknown[] }
      expect(body).toMatchObject({
        ok: false,
        sessions: {},
        conflicts: [],
        usersWithMultipleSockets: 0,
      })
    } finally {
      if (orig !== undefined) process.env.REALTIME_EMIT_TOKEN = orig
    }
  })

  it("degradação: realtime fora do ar (fetch TimeoutError) → EMPTY, nunca 500", async () => {
    mockRequireRole.mockResolvedValue(ADMIN)
    process.env.REALTIME_EMIT_TOKEN = "test-token"
    mockFetchFail()

    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; totalSockets: number; conflicts: unknown[] }
    expect(body).toMatchObject({ ok: false, totalSockets: 0, conflicts: [] })
  })

  it("agrupa por usuário + passa ageMs/kicks + deriva conflitos ordenados por gravidade", async () => {
    mockRequireRole.mockResolvedValue(ADMIN)
    process.env.REALTIME_EMIT_TOKEN = "test-token"
    mockFetchOk(fakeSessionsResponse())

    const res = await GET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      totalSockets: number
      onlineUsers: number
      sessions: Record<string, Array<{ socketId: string; ageMs: number }>>
      kicks: Record<string, RealtimeKickInfo>
      conflicts: Array<{
        userId: string
        socketCount: number
        oldestAgeMs: number
        lastKick: RealtimeKickInfo | null
      }>
      usersWithMultipleSockets: number
    }

    expect(body.ok).toBe(true)
    expect(body.totalSockets).toBe(3)
    expect(body.onlineUsers).toBe(2)
    // ageMs pass-through por socket
    expect(body.sessions["u1"]).toHaveLength(2)
    expect(body.sessions["u1"]![0]!.ageMs).toBe(300_000)
    expect(body.sessions["u2"]![0]!.ageMs).toBe(600_000)
    expect(body.kicks["u1"]).toEqual(KICK)
    // conflito: só u1 (2 sockets), com o socket mais antigo + último kick
    expect(body.usersWithMultipleSockets).toBe(1)
    expect(body.conflicts).toHaveLength(1)
    expect(body.conflicts[0]!).toMatchObject({
      userId: "u1",
      role: "PROVIDER",
      socketCount: 2,
      oldestAgeMs: 300_000,
    })
    expect(body.conflicts[0]!.lastKick).toEqual(KICK)
  })
})

describe("buildSessionConflicts (pura)", () => {
  const sess = (userId: string, ageMs: number, role = "CLIENT") => ({
    userId,
    role,
    socketId: `${userId}-${ageMs}`,
    connectedAt: "",
    joinedAt: "",
    ageMs,
  })

  it("ignora usuários com 1 socket (sem conflito)", () => {
    const c = buildSessionConflicts({ u1: [sess("u1", 1000)], u2: [sess("u2", 500)] }, {})
    expect(c).toEqual([])
  })

  it("lista usuários com >1 socket, do maior count pro menor (desempate: mais antigo)", () => {
    const c = buildSessionConflicts(
      {
        low: [sess("low", 1000), sess("low", 500)],
        high: [sess("high", 900), sess("high", 800), sess("high", 700)],
      },
      {},
    )
    expect(c.map((x) => x.userId)).toEqual(["high", "low"])
    expect(c[0]!).toMatchObject({ socketCount: 3, oldestAgeMs: 900 })
    expect(c[1]!).toMatchObject({ socketCount: 2, oldestAgeMs: 1000 })
  })

  it("desempate por antiguidade quando socketCount é igual", () => {
    // Mesmo count (2), mas o socket mais antigo decide a ordem.
    const c = buildSessionConflicts(
      {
        newer: [sess("newer", 100), sess("newer", 0)],
        older: [sess("older", 900), sess("older", 0)],
      },
      {},
    )
    expect(c.map((x) => x.userId)).toEqual(["older", "newer"])
  })

  it("junta o último kick como contexto (null quando não houve)", () => {
    const c = buildSessionConflicts({ u1: [sess("u1", 100), sess("u1", 0)] }, { u1: KICK })
    expect(c[0]!.lastKick).toEqual(KICK)

    const c2 = buildSessionConflicts({ u2: [sess("u2", 100), sess("u2", 0)] }, {})
    expect(c2[0]!.lastKick).toBeNull()
  })

  it("lista vazia → []", () => {
    expect(buildSessionConflicts({}, {})).toEqual([])
  })
})
