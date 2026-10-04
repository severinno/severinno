/**
 * route.test.ts — GET /api/providers/density
 *
 * Métricas de busca do marketplace (densidade de prestadores por bairro/anel)
 * usadas pelo refino da sugestão de raio (src/lib/geo-radius.ts).
 *
 * Coverage:
 *   ✅ 400 sem lat/lng e com coordenadas fora do range
 *   ✅ 200 com rings (7 raios canônicos) + districts agregados
 *   ✅ PostGIS: ponto é (lng, lat) e os raios entram em metros
 *   ✅ Cache com célula arredondada a 2 decimais
 *   ✅ Erro do banco → 500 via handleError
 *   ✅ Agregados apenas — nenhum campo de usuário/PII no payload
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

import { GET } from "@/app/api/providers/density/route"
import { db } from "@/lib/db"
import { withCache } from "@/lib/redis"

vi.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: vi.fn(),
  },
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { providers: {} },
}))

vi.mock("@/lib/redis", () => ({
  withCache: vi.fn((_key: string, fn: () => unknown) => fn()),
}))

const RINGS_ROW = { r1: 3, r2: 8, r5: 20, r10: 30, r15: 40, r25: 45, r50: 47 }
const DISTRICTS_ROWS = [
  { district: "Centro", city: "Governador Valadares", count: 12, minDistanceKm: 0.8 },
  { district: "Cidade Nova", city: "Governador Valadares", count: 5, minDistanceKm: 3.14 },
]

function densityRequest(lat?: string, lng?: string): Request {
  const url = new URL("http://localhost:3000/api/providers/density")
  if (lat != null) url.searchParams.set("lat", lat)
  if (lng != null) url.searchParams.set("lng", lng)
  return new Request(url)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/providers/density — validação", () => {
  it("400 sem coordenadas", async () => {
    const res = await GET(densityRequest())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "Coordenadas 'lat' e 'lng' inválidas" })
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it("400 com coordenadas fora do range", async () => {
    const res = await GET(densityRequest("999", "-41.95"))
    expect(res.status).toBe(400)
    expect(db.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it("400 com coordenadas não numéricas", async () => {
    const res = await GET(densityRequest("abc", "def"))
    expect(res.status).toBe(400)
  })
})

describe("GET /api/providers/density — resposta", () => {
  it("200 com rings canônicos + districts agregados", async () => {
    vi.mocked(db.$queryRawUnsafe)
      .mockResolvedValueOnce([RINGS_ROW])
      .mockResolvedValueOnce(DISTRICTS_ROWS)

    const res = await GET(densityRequest("-18.8517", "-41.9469"))

    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.rings).toEqual([
      { radiusKm: 1, count: 3 },
      { radiusKm: 2, count: 8 },
      { radiusKm: 5, count: 20 },
      { radiusKm: 10, count: 30 },
      { radiusKm: 15, count: 40 },
      { radiusKm: 25, count: 45 },
      { radiusKm: 50, count: 47 },
    ])
    expect(body.districts).toEqual([
      { district: "Centro", city: "Governador Valadares", count: 12, minDistanceKm: 0.8 },
      { district: "Cidade Nova", city: "Governador Valadares", count: 5, minDistanceKm: 3.14 },
    ])
  })

  it("consulta PostGIS com ponto (lng, lat) e raios em metros", async () => {
    vi.mocked(db.$queryRawUnsafe)
      .mockResolvedValueOnce([RINGS_ROW])
      .mockResolvedValueOnce(DISTRICTS_ROWS)

    await GET(densityRequest("-18.8517", "-41.9469"))

    const ringsCall = vi.mocked(db.$queryRawUnsafe).mock.calls[0]
    expect(ringsCall[1]).toBe(-41.9469) // lng antes de lat (ST_MakePoint)
    expect(ringsCall[2]).toBe(-18.8517)
    expect(ringsCall.slice(3)).toEqual([1000, 2000, 5000, 10000, 15000, 25000, 50000])

    const districtsCall = vi.mocked(db.$queryRawUnsafe).mock.calls[1]
    expect(districtsCall[1]).toBe(-41.9469)
    expect(districtsCall[2]).toBe(-18.8517)
    expect(districtsCall[3]).toBe(25_000) // janela de bairros
    expect(districtsCall[4]).toBe(8) // limite de bairros
  })

  it("cache usa célula arredondada a 2 decimais (TTL no servidor)", async () => {
    vi.mocked(db.$queryRawUnsafe)
      .mockResolvedValueOnce([RINGS_ROW])
      .mockResolvedValueOnce(DISTRICTS_ROWS)

    await GET(densityRequest("-18.8517", "-41.9469"))

    expect(withCache).toHaveBeenCalledWith(
      "providers:density:-18.85:-41.95",
      expect.any(Function),
      300,
    )
  })

  it("payload contém apenas agregados (sem PII de usuários)", async () => {
    vi.mocked(db.$queryRawUnsafe)
      .mockResolvedValueOnce([RINGS_ROW])
      .mockResolvedValueOnce(DISTRICTS_ROWS)

    const res = await GET(densityRequest("-18.8517", "-41.9469"))
    const body = (await res.json()) as Record<string, unknown>
    const serialized = JSON.stringify(body)

    expect(Object.keys(body).sort()).toEqual(["districts", "rings"])
    for (const key of ["id", "email", "name", "whatsapp", "phone", "lat", "lng"]) {
      expect(serialized).not.toContain(`"${key}"`)
    }
  })
})

describe("GET /api/providers/density — erros", () => {
  it("500 quando o banco falha (handleError)", async () => {
    vi.mocked(db.$queryRawUnsafe).mockRejectedValue(new Error("connection refused"))

    const res = await GET(densityRequest("-18.8517", "-41.9469"))
    expect(res.status).toBe(500)
  })
})
