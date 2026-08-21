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

vi.mock("@/lib/queue", () => ({
  getHealth: vi.fn().mockReturnValue({
    status: "ok",
    connected: true,
    connectionStatus: "connected",
    lastConnectedAt: Date.now(),
    reconnectAttempts: 0,
    totalReconnectAttempts: 0,
    heartbeat: 60,
    uptimeSeconds: 100,
  }),
}))

// ── Mock geo-settings (kill-switches) — controlado por teste ───────────────
const mockGetGeoSettings = vi.fn()

vi.mock("@/lib/geo-settings", () => ({
  getGeoSettings: (...args: any[]) => mockGetGeoSettings(...args),
  resetGeoSettingsCache: () => {},
}))

const ENABLED_SETTINGS = {
  nominatimEnabled: true,
  viacepEnabled: true,
  nominatimBaseUrl: "https://nominatim.openstreetmap.org",
  viacepBaseUrl: "https://viacep.com.br",
  userAgent: "SeverinnoMarketplace/1.0 (admin@severinno.com)",
}

// URLs acessadas pelo fetch em cada teste (para provar que o kill-switch
// não faz chamada de rede).
let fetchUrls: string[] = []

beforeAll(() => {
  // Mock global fetch for Nominatim status check + ViaCEP
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : ""
    fetchUrls.push(href)
    // Nominatim status check — return OK (qualquer base URL)
    if (href.includes("status.php")) {
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

import { GET, resetHealthCache } from "@/app/api/health/route"

describe("GET /api/health", () => {
  beforeEach(() => {
    // Isola o cache in-memory da rota entre testes + settings default (enabled)
    resetHealthCache()
    fetchUrls = []
    mockGetGeoSettings.mockResolvedValue({ ...ENABLED_SETTINGS })
  })

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

  // ---- Kill-switches (kill-switch não é degradação) ---------------------

  it("reporta nominatim como 'disabled' SEM rede quando nominatim_enabled=false", async () => {
    mockGetGeoSettings.mockResolvedValue({ ...ENABLED_SETTINGS, nominatimEnabled: false })

    const response = await GET()
    const body = await response.json()

    expect(body.checks.nominatim).toBe("disabled")
    expect(body.geo.nominatim).toContain("kill-switch")
    // Nenhuma chamada ao status.php (kill-switch corta a rede)
    expect(fetchUrls.some((u) => u.includes("status.php"))).toBe(false)
    // Desabilitar é intencional — status geral continua ok / HTTP 200
    expect(body.status).toBe("ok")
    expect(response.status).toBe(200)
  })

  it("reporta viacep como 'disabled' SEM rede quando viacep_enabled=false", async () => {
    mockGetGeoSettings.mockResolvedValue({ ...ENABLED_SETTINGS, viacepEnabled: false })

    const response = await GET()
    const body = await response.json()

    expect(body.checks.viacep).toBe("disabled")
    expect(body.geo.viacep).toContain("kill-switch")
    expect(fetchUrls.some((u) => u.includes("viacep.com.br"))).toBe(false)
    expect(body.status).toBe("ok")
    expect(response.status).toBe(200)
  })

  it("usa a NOMINATIM_BASE_URL das settings no probe", async () => {
    mockGetGeoSettings.mockResolvedValue({
      ...ENABLED_SETTINGS,
      nominatimBaseUrl: "https://nominatim.example.org",
    })

    const response = await GET()
    const body = await response.json()

    expect(body.checks.nominatim).toBe("ok")
    expect(fetchUrls.some((u) => u.includes("nominatim.example.org/status.php"))).toBe(true)
  })
})
