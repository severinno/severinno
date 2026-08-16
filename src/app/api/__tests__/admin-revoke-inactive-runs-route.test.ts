/**
 * Tests for GET /api/admin/cron/revoke-inactive/runs — audit trail das
 * execuções do cron de revogação de sessões inativas.
 *
 * Covers:
 *   - 200 com a lista de runs do audit trail
 *   - 401 quando o usuário não é ADMIN (requireRole lança)
 *   - degrada para { runs: [] } quando não há runs persistidos
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockRequireRole, mockListRevokeRuns } = vi.hoisted(() => ({
  mockRequireRole: vi.fn().mockResolvedValue({ userId: "admin-1", role: "ADMIN" }),
  mockListRevokeRuns: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/auth", () => ({
  requireRole: mockRequireRole,
}))

vi.mock("@/lib/revoke-run-audit", () => ({
  listRevokeRuns: mockListRevokeRuns,
}))

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { GET } from "../admin/cron/revoke-inactive/runs/route"

const RUNS = [
  {
    id: "run-2",
    ranAt: "2026-08-16T12:05:00.000Z",
    source: "admin",
    status: "completed",
    dryRun: true,
    scanned: 12,
    revoked: 4,
    failed: 0,
    elapsedMs: 51,
    threshold: {
      inactiveSince: "2026-08-09T00:00:00.000Z",
      deletedSince: "2026-08-09T00:00:00.000Z",
      passwordChangedSince: "2026-07-17T00:00:00.000Z",
    },
  },
  {
    id: "run-1",
    ranAt: "2026-08-16T11:00:00.000Z",
    source: "cron",
    status: "completed",
    dryRun: false,
    scanned: 30,
    revoked: 12,
    failed: 1,
    elapsedMs: 420,
    threshold: {
      inactiveSince: "2026-08-09T00:00:00.000Z",
      deletedSince: "2026-08-09T00:00:00.000Z",
      passwordChangedSince: "2026-07-17T00:00:00.000Z",
    },
  },
]

describe("GET /api/admin/cron/revoke-inactive/runs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireRole.mockResolvedValue({ userId: "admin-1", role: "ADMIN" })
  })

  it("retorna 200 com os runs do audit trail", async () => {
    mockListRevokeRuns.mockResolvedValue(RUNS)

    const res = await GET()
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.runs).toHaveLength(2)
    expect(data.runs[0]?.source).toBe("admin")
    expect(data.runs[1]?.source).toBe("cron")
    expect(mockRequireRole).toHaveBeenCalledWith("ADMIN")
    expect(mockListRevokeRuns).toHaveBeenCalledWith(50)
  })

  it("retorna { runs: [] } quando não há runs persistidos", async () => {
    mockListRevokeRuns.mockResolvedValue([])

    const res = await GET()
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.runs).toEqual([])
  })

  it("retorna 401 quando o usuário não é ADMIN", async () => {
    mockRequireRole.mockRejectedValue(new Error("UNAUTHORIZED"))

    const res = await GET()
    const data = await res.json()

    expect(res.status).toBe(401)
    expect(data.error).toBe("Não autorizado")
    expect(mockListRevokeRuns).not.toHaveBeenCalled()
  })

  it("retorna 403 quando o usuário tem role insuficiente", async () => {
    mockRequireRole.mockRejectedValue(new Error("FORBIDDEN"))

    const res = await GET()
    const data = await res.json()

    expect(res.status).toBe(403)
    expect(data.error).toBe("Acesso proibido")
  })
})
