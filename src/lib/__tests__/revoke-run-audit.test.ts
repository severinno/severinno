/**
 * Tests for revoke-run-audit.ts — audit trail Redis dos runs do cron de
 * revogação de sessões inativas.
 *
 * Covers:
 *   - recordRevokeRun persiste mais recente primeiro (bounded em 50)
 *   - listRevokeRuns retorna na ordem e respeita o limite
 *   - degrada graciosamente para [] quando o Redis falha
 *   - nunca lança (best-effort) mesmo com cache indisponível
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted in-memory store (backed do mock de redis) ──────────────────────

const { store, mockCacheGet, mockCacheSet } = vi.hoisted(() => {
  const map = new Map<string, unknown>()
  return {
    store: map,
    mockCacheGet: vi.fn(async (key: string) => (map.has(key) ? map.get(key) : null)),
    mockCacheSet: vi.fn(async (key: string, value: unknown) => {
      map.set(key, value)
    }),
  }
})

vi.mock("@/lib/redis", () => ({
  cacheGet: mockCacheGet,
  cacheSet: mockCacheSet,
}))

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { recordRevokeRun, listRevokeRuns } from "../revoke-run-audit"

function makeEntry(id: string, overrides: Partial<Parameters<typeof recordRevokeRun>[0]> = {}) {
  return {
    id,
    ranAt: `2026-08-16T12:00:${String(Number(id.replace("run-", "")) % 60).padStart(2, "0")}.000Z`,
    source: "cron" as const,
    status: "completed" as const,
    dryRun: true,
    scanned: 10,
    revoked: 3,
    failed: 0,
    elapsedMs: 42,
    threshold: {
      inactiveSince: "2026-08-09T00:00:00.000Z",
      deletedSince: "2026-08-09T00:00:00.000Z",
      passwordChangedSince: "2026-07-17T00:00:00.000Z",
    },
    ...overrides,
  }
}

describe("revoke-run-audit", () => {
  beforeEach(() => {
    store.clear()
    vi.clearAllMocks()
  })

  it("registra runs com o mais recente primeiro", async () => {
    await recordRevokeRun(makeEntry("run-1"))
    await recordRevokeRun(makeEntry("run-2"))

    const runs = await listRevokeRuns()
    expect(runs.map((r) => r.id)).toEqual(["run-2", "run-1"])
    expect(runs[0]?.source).toBe("cron")
    expect(runs[0]?.status).toBe("completed")
  })

  it("respeita o limite ao listar", async () => {
    for (let i = 1; i <= 10; i++) {
      await recordRevokeRun(makeEntry(`run-${i}`))
    }

    const runs = await listRevokeRuns(3)
    expect(runs).toHaveLength(3)
    expect(runs[0]?.id).toBe("run-10")
    expect(runs[2]?.id).toBe("run-8")
  })

  it("mantém o audit bounded em 50 entradas (FIFO pelos mais antigos)", async () => {
    for (let i = 1; i <= 60; i++) {
      await recordRevokeRun(makeEntry(`run-${String(i).padStart(2, "0")}`))
    }

    const runs = await listRevokeRuns()
    expect(runs).toHaveLength(50)
    expect(runs[0]?.id).toBe("run-60")
    expect(runs[49]?.id).toBe("run-11") // run-1..run-10 foram descartados
  })

  it("retorna [] quando não há runs registrados", async () => {
    const runs = await listRevokeRuns()
    expect(runs).toEqual([])
  })

  it("degrada graciosamente para [] quando o cache falha ao ler", async () => {
    mockCacheGet.mockRejectedValueOnce(new Error("redis down"))

    const runs = await listRevokeRuns()
    expect(runs).toEqual([])
  })

  it("nunca lança quando o cache falha ao gravar (best-effort)", async () => {
    mockCacheSet.mockRejectedValueOnce(new Error("redis down"))

    await expect(recordRevokeRun(makeEntry("run-1"))).resolves.toBeUndefined()
    // Sem registro persistido (falha ao gravar) — leitura retorna []
    expect(await listRevokeRuns()).toEqual([])
  })
})
