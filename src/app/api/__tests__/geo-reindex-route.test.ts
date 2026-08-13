/* eslint-disable @typescript-eslint/no-explicit-any */
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

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockImplementation(async (role: string) => {
    // null = unauthenticated → 401; wrong role → 403
    if (_mockRole == null) throw new Error("UNAUTHORIZED")
    if (_mockRole !== role) throw new Error("FORBIDDEN")
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
  })

  it("reindexes all 3 spatial indexes successfully", async () => {
    vi.mocked(db.$executeRawUnsafe).mockResolvedValue([{ result: "OK" }] as any)

    const res = await POST()
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

    const res = await POST()
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

    const res = await POST()
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(403)
    expect(parsed.body).toHaveProperty("error", "Acesso proibido")
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled()
  })

  it("returns 401 when user is not authenticated", async () => {
    _mockRole = null

    const res = await POST()
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(401)
    expect(parsed.body).toHaveProperty("error", "Não autorizado")
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled()
  })

  it("includes durationMs for each reindexed index", async () => {
    vi.mocked(db.$executeRawUnsafe).mockImplementation((async () => {
      await new Promise((r) => setTimeout(r, 1))
      return [{ result: "OK" }] as any
    }) as any)

    const res = await POST()
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
