/**
 * Tests for POST /api/admin/geo-reindex — REINDEX INDEX on PostGIS spatial
 * indexes when GiST degradation is detected.
 *
 * Covers:
 *   - Full success (3/3 indexes reindexed)
 *   - Partial failure (first index fails, remaining are skipped)
 *   - Auth required (non-ADMIN role returns 403)
 *   - Duration tracking per index
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

let _mockRole: string | null = null

import { makeAuthError } from "@/lib/__tests__/helpers/auth-mock"

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockImplementation(async (role: string) => {
    // null = unauthenticated → 401; wrong role → 403
    if (_mockRole == null) throw makeAuthError("UNAUTHORIZED")
    if (_mockRole !== role) throw makeAuthError("FORBIDDEN")
  }),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/lib/db", () => ({
  db: {
    $executeRawUnsafe: vi.fn(),
  },
}))

vi.mock("@/lib/api-server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, handleError: vi.fn((e: unknown) => (actual as any).handleError(e)) }
})

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn(),
  RATE_LIMITS: { admin: 100, general: 100 },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST } from "../admin/geo-reindex/route"
import { db } from "@/lib/db"
import { parseResponse } from "@/lib/__tests__/helpers/api-test-utils"
import type { GeoReindexResponse } from "../admin/geo-reindex/route"

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/admin/geo-reindex", () => {
  beforeEach(() => {
    _mockRole = "ADMIN"
    vi.clearAllMocks()
    // Defesa contra vazamento de fake timers de OUTRAS suítes: o pool do
    // vitest.config.unit.ts roda todas as suítes num ÚNICO worker (singleFork)
    // e o estado global de timers cruza a fronteira entre arquivos. Uma suíte
    // que esquece de restaurar `vi.useFakeTimers()` congelaria o
    // performance.now() (que a rota usa para medir durationMs) aqui — este
    // beforeEach garante timers REAIS antes de cada teste, isolando a suíte.
    vi.useRealTimers()
  })

  it("reindexes all 3 spatial indexes successfully", async () => {
    vi.mocked(db.$executeRawUnsafe).mockResolvedValue([{ result: "OK" }] as any)

    const res = await POST(new Request("http://localhost/api/admin/geo-reindex"))
    const parsed = await parseResponse<GeoReindexResponse>(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).not.toBeNull()
    expect(parsed.body!.success).toBe(true)
    expect(parsed.body!.indexes).toHaveLength(3)

    for (const idx of parsed.body!.indexes) {
      expect(idx.ok).toBe(true)
      expect(idx.durationMs).toBeGreaterThanOrEqual(0)
    }

    const names = parsed.body!.indexes.map((i) => i.name)
    expect(names).toEqual([
      "idx_user_location_gist",
      "idx_booking_location_gist",
      "idx_quoterequest_location_gist",
    ])

    expect(parsed.body!.message).toBe("3/3 índices reindexados com sucesso.")
    expect(parsed.body!.totalDurationMs).toBeGreaterThanOrEqual(0)

    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(3)
    for (const call of vi.mocked(db.$executeRawUnsafe).mock.calls) {
      expect(call[0]).toContain("REINDEX INDEX CONCURRENTLY")
    }
  })

  it("returns partial failure when first index fails and skips remaining", async () => {
    vi.mocked(db.$executeRawUnsafe)
      .mockRejectedValueOnce(new Error("deadlock detected"))
      .mockResolvedValue([{ result: "OK" }] as any)

    const res = await POST(new Request("http://localhost/api/admin/geo-reindex"))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(500)
    expect(parsed.body).toHaveProperty("error")
    expect((parsed.body as any).error).toContain("Falha ao reindexar")
    expect((parsed.body as any).error).toContain("idx_user_location_gist")
    expect((parsed.body as any).error).toContain("deadlock detected")

    expect((parsed.body as any).failedIndex).toBe("idx_user_location_gist")
    expect((parsed.body as any).completedIndexes).toHaveLength(1)
    expect((parsed.body as any).completedIndexes[0].ok).toBe(false)

    // Only called once — stop on first failure
    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(1)
  })

  it("returns 403 when user is not ADMIN", async () => {
    _mockRole = "PROVIDER"

    const res = await POST(new Request("http://localhost/api/admin/geo-reindex"))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(403)
    expect(parsed.body).toHaveProperty("error", "Acesso proibido")
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled()
  })

  it("returns 401 when user is not authenticated", async () => {
    _mockRole = null

    const res = await POST(new Request("http://localhost/api/admin/geo-reindex"))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(401)
    expect(parsed.body).toHaveProperty("error", "Não autorizado")
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled()
  })

  it("includes durationMs for each reindexed index", async () => {
    vi.mocked(db.$executeRawUnsafe).mockImplementation((async () => {
      // Garante elapsed REAL >= 2ms medido pelo MESMO clock que a rota usa
      // (performance.now). O setTimeout(1) original era flaky no worker
      // quente/isolado: podia disparar sem avançar o relógio (durationMs 0),
      // quebrando `toBeGreaterThan(0)` só no run completo — busy-wait é
      // determinístico e imune à velocidade do worker.
      const t0 = performance.now()
      while (performance.now() - t0 < 2) {
        /* busy-wait: simula um REINDEX que leva tempo mensurável */
      }
      return [{ result: "OK" }] as any
    }) as any)

    const res = await POST(new Request("http://localhost/api/admin/geo-reindex"))
    const parsed = await parseResponse<GeoReindexResponse>(res)

    expect(parsed.status).toBe(200)

    for (const idx of parsed.body!.indexes) {
      expect(idx.durationMs).toBeGreaterThan(0)
    }

    // Allow 1ms tolerance for timer precision
    const sumDurations = parsed.body!.indexes.reduce((a, i) => a + i.durationMs, 0)
    expect(parsed.body!.totalDurationMs).toBeGreaterThanOrEqual(sumDurations - 1)
  })
})
