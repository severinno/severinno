/**
 * Tests for POST /api/admin/cron/revoke-inactive/run — disparo manual da
 * varredura de revogação pelo painel admin.
 *
 * Covers:
 *   - dryRun DEFAULT true quando o query param não é passado (seguro)
 *   - dryRun=false quando ?dryRun=0 é passado explicitamente (ação real)
 *   - bypassCooldown=true sempre (admin pediu, não respeita cooldown do cron)
 *   - source="admin" repassado ao motor
 *   - 401 quando o usuário não é ADMIN
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockRequireRole, mockRunRevokeInactiveScan } = vi.hoisted(() => ({
  mockRequireRole: vi.fn().mockResolvedValue({ userId: "admin-1", role: "ADMIN" }),
  mockRunRevokeInactiveScan: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/auth", () => ({
  requireRole: mockRequireRole,
}))

vi.mock("@/lib/revoke-run-audit", () => ({
  recordRevokeRun: vi.fn(),
  listRevokeRuns: vi.fn(),
}))

vi.mock("@/lib/revoke-inactive-scan", () => ({
  runRevokeInactiveScan: mockRunRevokeInactiveScan,
}))

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { POST } from "../admin/cron/revoke-inactive/run/route"

describe("POST /api/admin/cron/revoke-inactive/run", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireRole.mockResolvedValue({ userId: "admin-1", role: "ADMIN" })
    mockRunRevokeInactiveScan.mockResolvedValue({
      ok: true,
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
    })
  })

  it("roda com dryRun DEFAULT true (sem query param) e bypassCooldown", async () => {
    const res = await POST(new Request("http://localhost/api/admin/cron/revoke-inactive/run"))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.dryRun).toBe(true)
    expect(mockRequireRole).toHaveBeenCalledWith("ADMIN")
    expect(mockRunRevokeInactiveScan).toHaveBeenCalledWith({
      dryRun: true,
      source: "admin",
      bypassCooldown: true,
    })
  })

  it("roda dryRun=true com ?dryRun=1 explícito", async () => {
    await POST(new Request("http://localhost/api/admin/cron/revoke-inactive/run?dryRun=1"))

    expect(mockRunRevokeInactiveScan).toHaveBeenCalledWith({
      dryRun: true,
      source: "admin",
      bypassCooldown: true,
    })
  })

  it("roda a revogação REAL com ?dryRun=0", async () => {
    mockRunRevokeInactiveScan.mockResolvedValue({
      ok: true,
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
    })

    const res = await POST(
      new Request("http://localhost/api/admin/cron/revoke-inactive/run?dryRun=0"),
    )
    const data = await res.json()

    expect(data.dryRun).toBe(false)
    expect(data.revoked).toBe(12)
    expect(mockRunRevokeInactiveScan).toHaveBeenCalledWith({
      dryRun: false,
      source: "admin",
      bypassCooldown: true,
    })
  })

  it("repassa o skip de cooldown quando o motor retorna skipped", async () => {
    mockRunRevokeInactiveScan.mockResolvedValue({ ok: true, status: "skipped", reason: "cooldown" })

    const res = await POST(new Request("http://localhost/api/admin/cron/revoke-inactive/run"))
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.status).toBe("skipped")
    expect(data.reason).toBe("cooldown")
  })

  it("retorna 401 quando o usuário não é ADMIN", async () => {
    mockRequireRole.mockRejectedValue(new Error("UNAUTHORIZED"))

    const res = await POST(new Request("http://localhost/api/admin/cron/revoke-inactive/run"))

    expect(res.status).toBe(401)
    expect(mockRunRevokeInactiveScan).not.toHaveBeenCalled()
  })
})
