/**
 * Tests for PATCH/DELETE /api/admin/users/[id].
 *
 * Travam o CONTRATO de desativação/deleção: além de invalidar o cache do
 * usuário (bloqueia novas requests), a rota DEVE revogar os sockets realtime
 * (revokeUserSessions → session:revoke) IMEDIATAMENTE — o usuário desativado
 * não pode ficar conectado esperando o próximo logout.
 *
 * Cobre:
 *   - PATCH active:false → invalidateUserCache + revokeUserSessions(id)
 *   - PATCH active:true (reativação) → invalida cache, NÃO revoga sockets
 *   - PATCH sem campo active → invalida cache, NÃO revoga sockets
 *   - PATCH sem active e sem mudança real → idem
 *   - DELETE → invalidateUserCache + revokeUserSessions(id)
 *   - Não-autenticado → 401 e NENHUM revoke/invalidate
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock("@/lib/db", () => ({ db: mockDb }))

let _mockRole: string | null = null
const mockInvalidateUserCache = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockRevokeUserSessions = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockImplementation(async (role: string) => {
    if (_mockRole == null) throw new Error("UNAUTHORIZED")
    if (_mockRole !== role) throw new Error("FORBIDDEN")
    return { userId: "admin-1", role: "ADMIN" }
  }),
  invalidateUserCache: mockInvalidateUserCache,
  revokeUserSessions: mockRevokeUserSessions,
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { PATCH, DELETE } from "../admin/users/[id]/route"
import { POST as POST_REVOKE } from "../admin/users/[id]/revoke-sessions/route"

// ── Helpers ────────────────────────────────────────────────────────────────

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/users/user-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const USER_ROW = { id: "user-1", role: "CLIENT" }

beforeEach(() => {
  vi.clearAllMocks()
  _mockRole = "ADMIN"
  mockDb.user.findUnique.mockResolvedValue(USER_ROW)
  mockDb.user.update.mockResolvedValue({ ...USER_ROW, active: false })
})

describe("PATCH /api/admin/users/[id] — desativação", () => {
  it("desativa usuário: invalida cache E revoga sockets realtime (active:false)", async () => {
    const res = await PATCH(jsonRequest({ active: false }), {
      params: Promise.resolve({ id: "user-1" }),
    })

    expect(res.status).toBe(200)
    expect(mockInvalidateUserCache).toHaveBeenCalledWith("user-1")
    expect(mockRevokeUserSessions).toHaveBeenCalledTimes(1)
    expect(mockRevokeUserSessions).toHaveBeenCalledWith("user-1")
  })

  it("reativação (active:true) invalida cache mas NÃO revoga sockets", async () => {
    await PATCH(jsonRequest({ active: true }), { params: Promise.resolve({ id: "user-1" }) })

    expect(mockInvalidateUserCache).toHaveBeenCalledWith("user-1")
    expect(mockRevokeUserSessions).not.toHaveBeenCalled()
  })

  it("update sem campo active (ex.: name) invalida cache mas NÃO revoga sockets", async () => {
    await PATCH(jsonRequest({ name: "Novo Nome" }), { params: Promise.resolve({ id: "user-1" }) })

    expect(mockInvalidateUserCache).toHaveBeenCalledWith("user-1")
    expect(mockRevokeUserSessions).not.toHaveBeenCalled()
  })

  it("revoga sockets apenas quando active é explicitamente false", async () => {
    // body.active === "false" (string) NÃO é desativação real (Boolean("false") === true)
    await PATCH(jsonRequest({ active: "false" }), { params: Promise.resolve({ id: "user-1" }) })

    expect(mockInvalidateUserCache).toHaveBeenCalledWith("user-1")
    expect(mockRevokeUserSessions).not.toHaveBeenCalled()
  })

  it("revoga sockets quando active: 0 desativa no DB (coerção Boolean espelhada)", async () => {
    // O DB escreve Boolean(body.active) — 0 → false (desativação real)
    await PATCH(jsonRequest({ active: 0 }), { params: Promise.resolve({ id: "user-1" }) })

    expect(mockInvalidateUserCache).toHaveBeenCalledWith("user-1")
    expect(mockRevokeUserSessions).toHaveBeenCalledWith("user-1")
  })

  it("revoga sockets quando active: null desativa no DB (coerção Boolean espelhada)", async () => {
    // Boolean(null) → false (desativação real)
    await PATCH(jsonRequest({ active: null }), { params: Promise.resolve({ id: "user-1" }) })

    expect(mockInvalidateUserCache).toHaveBeenCalledWith("user-1")
    expect(mockRevokeUserSessions).toHaveBeenCalledWith("user-1")
  })

  it("não-autenticado → 401 e NENHUM invalidate/revoke", async () => {
    _mockRole = null
    const res = await PATCH(jsonRequest({ active: false }), {
      params: Promise.resolve({ id: "user-1" }),
    })

    expect(res.status).toBe(401)
    expect(mockInvalidateUserCache).not.toHaveBeenCalled()
    expect(mockRevokeUserSessions).not.toHaveBeenCalled()
  })

  it("usuário inexistente → 404 e NENHUM invalidate/revoke", async () => {
    mockDb.user.findUnique.mockResolvedValue(null)
    const res = await PATCH(jsonRequest({ active: false }), {
      params: Promise.resolve({ id: "missing" }),
    })

    expect(res.status).toBe(404)
    expect(mockInvalidateUserCache).not.toHaveBeenCalled()
    expect(mockRevokeUserSessions).not.toHaveBeenCalled()
  })
})

describe("POST /api/admin/users/[id]/revoke-sessions — revogar sem desativar", () => {
  it("revoga sockets realtime SEM desativar (não toca user.update)", async () => {
    const res = await POST_REVOKE(
      new Request("http://localhost/api/admin/users/user-1/revoke-sessions"),
      {
        params: Promise.resolve({ id: "user-1" }),
      },
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok?: boolean; revoked?: boolean }
    expect(body).toEqual({ ok: true, revoked: true })
    // Sem desativar: NENHUM update no banco — só revogação de sockets.
    expect(mockDb.user.update).not.toHaveBeenCalled()
    expect(mockRevokeUserSessions).toHaveBeenCalledWith("user-1")
  })

  it("não-autenticado → 401 e NENHUM revoke", async () => {
    _mockRole = null
    const res = await POST_REVOKE(
      new Request("http://localhost/api/admin/users/user-1/revoke-sessions"),
      {
        params: Promise.resolve({ id: "user-1" }),
      },
    )

    expect(res.status).toBe(401)
    expect(mockRevokeUserSessions).not.toHaveBeenCalled()
  })

  it("usuário inexistente → 404 e NENHUM revoke", async () => {
    mockDb.user.findUnique.mockResolvedValue(null)
    const res = await POST_REVOKE(
      new Request("http://localhost/api/admin/users/user-1/revoke-sessions"),
      {
        params: Promise.resolve({ id: "user-1" }),
      },
    )

    expect(res.status).toBe(404)
    expect(mockRevokeUserSessions).not.toHaveBeenCalled()
  })
})

describe("DELETE /api/admin/users/[id] — deleção", () => {
  it("deleta usuário: invalida cache E revoga sockets realtime", async () => {
    mockDb.user.update.mockResolvedValue({ ...USER_ROW, deletedAt: new Date() })
    const res = await DELETE(new Request("http://localhost/api/admin/users/user-1"), {
      params: Promise.resolve({ id: "user-1" }),
    })

    expect(res.status).toBe(200)
    expect(mockDb.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { deletedAt: expect.any(Date) } }),
    )
    expect(mockInvalidateUserCache).toHaveBeenCalledWith("user-1")
    expect(mockRevokeUserSessions).toHaveBeenCalledWith("user-1")
  })

  it("não-autenticado → 401 e NENHUM invalidate/revoke", async () => {
    _mockRole = null
    const res = await DELETE(new Request("http://localhost/api/admin/users/user-1"), {
      params: Promise.resolve({ id: "user-1" }),
    })

    expect(res.status).toBe(401)
    expect(mockInvalidateUserCache).not.toHaveBeenCalled()
    expect(mockRevokeUserSessions).not.toHaveBeenCalled()
  })
})
