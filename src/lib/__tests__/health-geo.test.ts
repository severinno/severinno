/**
 * health-geo.test.ts
 *
 * Geo-focused coverage for GET /api/health — complements health.test.ts
 * (happy path + kill-switches).
 *
 * Coverage:
 *   ✅ geo.* details report "online"/"available" when all services are ok
 *   ✅ Nominatim HTTP error → checks.nominatim = "error" + degraded (503)
 *   ✅ Nominatim status=2 (down) → error
 *   ✅ ViaCEP erro:true response → error
 *   ✅ ViaCEP HTTP error → error
 *   ✅ PostGIS extension missing → error ("extension not found")
 *   ✅ PostGIS query failure → error
 *   ✅ Any geo error → status "degraded" + HTTP 503
 *   ✅ Both kill-switches disabled → still ok (200), no network calls
 *   ✅ ViaCEP base URL from settings is used in the probe
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"

// ── Mock db — controlado por teste ----------------------------------------
const mockQueryRaw = vi.fn()

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
  },
}))

vi.mock("@/lib/redis", () => ({
  getCacheStats: vi
    .fn()
    .mockReturnValue({ size: 0, hitRate: 0, keys: 0, hits: 0, misses: 0, total: 0 }),
  getClient: vi.fn().mockReturnValue({
    ping: vi.fn().mockResolvedValue("PONG"),
  }),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ── Mock geo-settings (kill-switches) ─────────────────────────────────────
const mockGetGeoSettings = vi.fn()

vi.mock("@/lib/geo-settings", () => ({
  getGeoSettings: (...args: unknown[]) => mockGetGeoSettings(...args),
  resetGeoSettingsCache: () => {},
}))

const ENABLED_SETTINGS = {
  nominatimEnabled: true,
  viacepEnabled: true,
  nominatimBaseUrl: "https://nominatim.openstreetmap.org",
  viacepBaseUrl: "https://viacep.com.br",
  userAgent: "SeverinnoMarketplace/1.0 (admin@severinno.com)",
}

// URLs acessadas pelo fetch em cada teste (para provar ausência de rede nos kill-switches)
let fetchUrls: string[] = []

// ── Configuração do fetch global ──────────────────────────────────────────
let nominatimResponse: Response | null = null // null → usa o default OK
let viacepResponse: Response | null = null

beforeAll(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url: RequestInfo | URL) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : ""
    fetchUrls.push(href)
    if (href.includes("status.php")) {
      return (
        nominatimResponse ??
        new Response(JSON.stringify({ status: 0, message: "OK" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    }
    if (href.includes("viacep.com.br")) {
      return (
        viacepResponse ??
        new Response(
          JSON.stringify({
            cep: "01310100",
            logradouro: "Rua Augusta",
            localidade: "São Paulo",
            uf: "SP",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      )
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  })
})

// ── Import após os mocks ──────────────────────────────────────────────────
import { GET, resetHealthCache } from "@/app/api/health/route"

describe("GET /api/health — geo checks (degradation & details)", () => {
  beforeEach(() => {
    resetHealthCache()
    fetchUrls = []
    nominatimResponse = null
    viacepResponse = null
    mockGetGeoSettings.mockResolvedValue({ ...ENABLED_SETTINGS })
    // Default: DB ok (SELECT 1) + PostGIS available
    mockQueryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join("") : ""
      if (sql.includes("pg_extension")) {
        return [{ available: true }]
      }
      return [{ 1: 1 }]
    })
  })

  it("reports geo details as online/available when all checks pass", async () => {
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe("ok")
    expect(body.geo.nominatim).toBe("online")
    expect(body.geo.viacep).toBe("online")
    expect(body.geo.postgis).toBe("available")
  })

  it("reports degraded + 503 when Nominatim returns an HTTP error", async () => {
    nominatimResponse = new Response(JSON.stringify({}), { status: 500 })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.status).toBe("degraded")
    expect(body.checks.nominatim).toBe("error")
    expect(body.geo.nominatim).toContain("HTTP 500")
    // Os demais geo checks seguem ok
    expect(body.checks.viacep).toBe("ok")
    expect(body.checks.postgis).toBe("ok")
  })

  it("reports Nominatim down (status=2) as error", async () => {
    nominatimResponse = new Response(JSON.stringify({ status: 2, message: "Maintenance" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.checks.nominatim).toBe("error")
    expect(body.geo.nominatim).toContain("Maintenance")
  })

  it("reports ViaCEP erro:true as error", async () => {
    viacepResponse = new Response(JSON.stringify({ erro: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.checks.viacep).toBe("error")
    expect(body.geo.viacep).toContain("unexpected error response")
  })

  it("reports degraded + 503 when ViaCEP returns an HTTP error", async () => {
    viacepResponse = new Response(JSON.stringify({}), { status: 502 })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.status).toBe("degraded")
    expect(body.checks.viacep).toBe("error")
    expect(body.geo.viacep).toContain("HTTP 502")
  })

  it("reports PostGIS as error when the extension is missing", async () => {
    mockQueryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join("") : ""
      if (sql.includes("pg_extension")) return [] // extensão não instalada
      return [{ 1: 1 }]
    })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.checks.postgis).toBe("error")
    expect(body.geo.postgis).toBe("extension not found")
  })

  it("reports PostGIS as error when the query throws", async () => {
    mockQueryRaw.mockImplementation(async () => {
      throw new Error("connection refused")
    })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.checks.postgis).toBe("error")
    expect(body.geo.postgis).toContain("connection refused")
    expect(body.checks.database).toBe("error")
  })

  it("keeps status ok (200) when both geo kill-switches are off — no network", async () => {
    mockGetGeoSettings.mockResolvedValue({
      ...ENABLED_SETTINGS,
      nominatimEnabled: false,
      viacepEnabled: false,
    })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe("ok")
    expect(body.checks.nominatim).toBe("disabled")
    expect(body.checks.viacep).toBe("disabled")
    expect(body.geo.nominatim).toContain("kill-switch")
    expect(body.geo.viacep).toContain("kill-switch")
    // Nenhuma chamada de rede aos providers geo
    expect(fetchUrls.some((u) => u.includes("status.php"))).toBe(false)
    expect(fetchUrls.some((u) => u.includes("viacep.com.br"))).toBe(false)
  })

  it("uses the ViaCEP base URL from settings in the probe", async () => {
    mockGetGeoSettings.mockResolvedValue({
      ...ENABLED_SETTINGS,
      viacepBaseUrl: "https://viacep.example.org",
    })

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.checks.viacep).toBe("ok")
    expect(fetchUrls.some((u) => u.includes("viacep.example.org/ws/01310100"))).toBe(true)
  })
})
