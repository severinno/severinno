/**
 * Tests for POST /api/admin/settings.
 *
 * Travam o CONTRATO de invalidação de cache: qualquer write de settings de
 * geolocalização (kill-switches, base URLs) DEVE invalidar o cache in-memory
 * de 30s do geo-settings (resetGeoSettingsCache) e o de 15s do /api/health
 * (resetHealthCache) — senão a mudança demora TTLs inteiros para valer e o
 * painel admin mostra config que o runtime ainda não lê.
 *
 * Cobre:
 *   - Write real → resets chamados APÓS o upsert (ordem travada)
 *   - Body inválido/vazio → 400 e NENHUM reset
 *   - Não-autenticado → 401 e NENHUM reset
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

let _mockRole: string | null = null

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

vi.mock("@/lib/db", () => ({
  db: {
    setting: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation(async (ops: Promise<unknown>[]) => {
      const results = []
      for (const op of ops) {
        results.push(await op)
      }
      return results
    }),
  },
}))

// geo-settings: o spy do reset é a âncora do contrato (export direto, igual
// ao padrão do resetHealthCache). getGeoSettings também é exportado porque
// /api/health (importado pela rota de settings) o usa.
vi.mock("@/lib/geo-settings", () => ({
  getGeoSettings: vi.fn(),
  resetGeoSettingsCache: vi.fn(),
}))

// health route (importada pela rota de settings para resetHealthCache) usa db,
// redis e logger — mocka o redis como as demais suítes de health.
vi.mock("@/lib/redis", () => ({
  getCacheStats: vi.fn().mockReturnValue({ hits: 0, misses: 0, total: 0, hitRatio: null }),
  getClient: vi.fn().mockReturnValue({ ping: vi.fn().mockResolvedValue("PONG") }),
}))

vi.mock("@/lib/api-server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, handleError: vi.fn((e: unknown) => (actual as any).handleError(e)) }
})

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { admin: { prefix: "admin", max: 30, windowMs: 60000 } },
}))

// health route: tudo real, mas resetHealthCache vira spy (o contrato testado).
vi.mock("@/app/api/health/route", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, resetHealthCache: vi.fn() }
})

// ── Imports ────────────────────────────────────────────────────────────────

import { POST } from "../admin/settings/route"
import { resetGeoSettingsCache } from "@/lib/geo-settings"
import { resetHealthCache } from "@/app/api/health/route"
import { db } from "@/lib/db"
import { parseResponse } from "@/lib/__tests__/helpers/api-test-utils"
import { assertRateLimit } from "@/lib/rate-limit"

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/admin/settings", () => {
  beforeEach(() => {
    _mockRole = "ADMIN"
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  const upsertRow = (key: string, value: string) => ({
    key,
    value,
    updatedAt: new Date().toISOString(),
  })

  it("invoca resetGeoSettingsCache e resetHealthCache APÓS o write", async () => {
    ;(db.setting.upsert as any).mockImplementation(async ({ where }: any) =>
      upsertRow(where.key, "false"),
    )

    const request = new Request("http://localhost/api/admin/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ key: "nominatim_enabled", value: "false" }]),
    })

    const res = await POST(request)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).not.toBeNull()

    // Upsert aconteceu (o write real)
    expect(db.setting.upsert).toHaveBeenCalledTimes(1)
    // Os dois resets de cache foram chamados…
    expect(resetGeoSettingsCache).toHaveBeenCalledTimes(1)
    expect(resetHealthCache).toHaveBeenCalledTimes(1)
    // …e APÓS o write (ordem travada: upsert → resets)
    const upsertOrder = vi.mocked(db.setting.upsert).mock.invocationCallOrder[0]!
    const geoResetOrder = vi.mocked(resetGeoSettingsCache).mock.invocationCallOrder[0]!
    const healthResetOrder = vi.mocked(resetHealthCache).mock.invocationCallOrder[0]!
    expect(geoResetOrder).toBeGreaterThan(upsertOrder)
    expect(healthResetOrder).toBeGreaterThan(upsertOrder)
  })

  it("upsert múltiplos pares ainda dispara exatamente UMA invalidação por write", async () => {
    ;(db.setting.upsert as any).mockImplementation(async ({ where }: any) =>
      upsertRow(where.key, "1"),
    )

    const request = new Request("http://localhost/api/admin/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
        { key: "nominatim_enabled", value: "true" },
        { key: "viacep_enabled", value: "false" },
      ]),
    })

    const res = await POST(request)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(db.setting.upsert).toHaveBeenCalledTimes(2)
    expect(resetGeoSettingsCache).toHaveBeenCalledTimes(1)
    expect(resetHealthCache).toHaveBeenCalledTimes(1)
  })

  it("body inválido → 400 e NENHUM reset (invalidação só após write real)", async () => {
    const request = new Request("http://localhost/api/admin/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })

    const res = await POST(request)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect(db.setting.upsert).not.toHaveBeenCalled()
    expect(resetGeoSettingsCache).not.toHaveBeenCalled()
    expect(resetHealthCache).not.toHaveBeenCalled()
  })

  it("não-autenticado → 401 e NENHUM reset", async () => {
    _mockRole = null

    const request = new Request("http://localhost/api/admin/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ key: "nominatim_enabled", value: "false" }]),
    })

    const res = await POST(request)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(401)
    expect(db.setting.upsert).not.toHaveBeenCalled()
    expect(resetGeoSettingsCache).not.toHaveBeenCalled()
    expect(resetHealthCache).not.toHaveBeenCalled()
  })

  it("write falho → 500 e NENHUM reset (invalidação só após write bem-sucedido)", async () => {
    ;(db.setting.upsert as any).mockRejectedValue(new Error("db down"))

    const request = new Request("http://localhost/api/admin/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ key: "nominatim_enabled", value: "false" }]),
    })

    const res = await POST(request)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(500)
    expect(db.setting.upsert).toHaveBeenCalledTimes(1)
    // Resets ficam DEPOIS do await — write falhou, nada deve ser invalidado
    expect(resetGeoSettingsCache).not.toHaveBeenCalled()
    expect(resetHealthCache).not.toHaveBeenCalled()
  })
})
