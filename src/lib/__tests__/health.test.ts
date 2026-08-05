import { describe, it, expect, vi, beforeAll } from "vitest"

// Mock $queryRaw — inline factory (vi.mock is hoisted, so no outer vars allowed)
vi.mock("@/lib/db", () => {
  const raw = vi.fn().mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = Array.isArray(strings) ? strings.join("") : ""
    // Handle PostGIS extension check query
    if (sql.includes("pg_extension")) {
      return [{ available: true }]
    }
    return [{ 1: 1 }]
  })
  return { db: { $queryRaw: raw } }
})

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  getCacheStats: vi.fn().mockReturnValue({ size: 0, hitRate: 0, keys: 0 }),
  getClient: vi.fn().mockReturnValue({
    ping: vi.fn().mockResolvedValue("PONG"),
  }),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

beforeAll(() => {
  // Mock global fetch for Nominatim status check + ViaCEP
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : ""
    // Nominatim status check — return OK
    if (href.includes("nominatim.openstreetmap.org/status.php")) {
      return new Response(JSON.stringify({ status: 0, message: "OK" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    // ViaCEP check — return OK
    if (href.includes("viacep.com.br/ws/01310100")) {
      return new Response(
        JSON.stringify({
          cep: "01310100",
          logradouro: "Rua Augusta",
          localidade: "São Paulo",
          uf: "SP",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }
    // Default: return empty JSON
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  })
})

import { GET } from "@/app/api/health/route"

describe("GET /api/health", () => {
  it("retorna status 200 no formato esperado", async () => {
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveProperty("status")
    expect(body).toHaveProperty("checks")
    expect(body).toHaveProperty("geo")
    expect(body).toHaveProperty("timestamp")
    expect(body).toHaveProperty("version")
  })

  it("campos checks têm todos os serviços geo", async () => {
    const response = await GET()
    const body = await response.json()

    expect(body.checks).toHaveProperty("database")
    expect(body.checks).toHaveProperty("redis")
    expect(body.checks).toHaveProperty("nominatim")
    expect(body.checks).toHaveProperty("viacep")
    expect(body.checks).toHaveProperty("postgis")
    expect(typeof body.status).toBe("string")
    expect(typeof body.timestamp).toBe("string")
    expect(typeof body.version).toBe("string")
  })

  it("usa cache em memória em chamadas subsequentes", async () => {
    const first = await GET()
    expect(first.status).toBe(200)

    const second = await GET()
    expect(second.status).toBe(200)
  })
})
