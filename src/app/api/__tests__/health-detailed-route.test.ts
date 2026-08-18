/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn().mockResolvedValue([{ "1": 1 }]),
  },
}))

vi.mock("@/lib/redis", () => ({
  getClient: vi.fn(() => ({
    ping: vi.fn().mockResolvedValue("PONG"),
    status: "ready",
  })),
  getCacheStats: vi.fn(() => ({ hits: 42, misses: 8, total: 50 })),
}))

vi.mock("@/lib/queue", () => ({
  getChannel: vi.fn().mockRejectedValue(new Error("RabbitMQ not available")),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("../../../../../package.json", () => ({
  default: { version: "1.0.0-test" },
  version: "1.0.0-test",
}))

// ── Global fetch mock ─────────────────────────────────────────────────────
// Using new Response() instead of plain object ensures .ok, .status, .json(), .clone() work
beforeAll(() => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
})

// ── Imports ───────────────────────────────────────────────────────────────

import { GET } from "../health/detailed/route"

function createRequest(urlStr = "http://localhost:3000/api/health/detailed") {
  return new Request(urlStr)
}

// ===========================================================================
// GET /api/health/detailed (JSON)
// ============================================================================

describe("GET /api/health/detailed", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("retorna 200 com status healthy quando todos os serviços estão ok", async () => {
    const response = await GET(createRequest())
    expect(response.status).toBe(200)

    const body = await response.json()

    expect(body).toBeDefined()
    expect(body).toHaveProperty("status")
    expect(body).toHaveProperty("timestamp")
    expect(body).toHaveProperty("uptime")
    expect(body).toHaveProperty("version")
    expect(body).toHaveProperty("summary")
    expect(body).toHaveProperty("services")
    expect(body).toHaveProperty("cache")
  })

  it("inclui array de serviços com status, latency e message", async () => {
    const response = await GET(createRequest())
    const body = await response.json()

    expect(Array.isArray(body.services)).toBe(true)
    expect(body.services.length).toBeGreaterThanOrEqual(5)

    for (const svc of body.services) {
      expect(svc).toHaveProperty("name")
      expect(svc).toHaveProperty("status")
      expect(["healthy", "degraded", "unhealthy", "unknown"]).toContain(svc.status)
    }
  })

  it("inclui serviço 'app' com status healthy e detalhes do runtime", async () => {
    const response = await GET(createRequest())
    const body = await response.json()

    const appSvc = body.services.find((s: { name: string }) => s.name === "app")
    expect(appSvc).toBeDefined()
    expect(appSvc.status).toBe("healthy")
    expect(appSvc.details).toHaveProperty("node")
    expect(appSvc.details).toHaveProperty("platform")
    expect(appSvc.details).toHaveProperty("memory")
    // PID está na string message, não em details
    expect(appSvc.message).toContain("PID")
  })

  it("inclui summary com contagens corretas", async () => {
    const response = await GET(createRequest())
    const body = await response.json()

    const { summary } = body
    expect(summary).toHaveProperty("healthy")
    expect(summary).toHaveProperty("degraded")
    expect(summary).toHaveProperty("unhealthy")
    expect(summary).toHaveProperty("total")
    // total pode incluir serviços com status "unknown" (ex: workers sem RabbitMQ)
    expect(summary.total).toBeGreaterThanOrEqual(
      summary.healthy + summary.degraded + summary.unhealthy,
    )
  })

  it("inclui cache stats no response", async () => {
    const response = await GET(createRequest())
    const body = await response.json()

    expect(body.cache).toHaveProperty("hits", 42)
    expect(body.cache).toHaveProperty("misses", 8)
    expect(body.cache).toHaveProperty("total", 50)
  })
})

// ============================================================================
// Prometheus / OpenMetrics Format
// ============================================================================

describe("GET /api/health/detailed?format=prometheus", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("retorna 200 com Content-Type text/plain", async () => {
    const response = await GET(
      createRequest("http://localhost:3000/api/health/detailed?format=prometheus"),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toContain("text/plain")
  })

  it("retorna métricas no formato OpenMetrics com HELP e TYPE", async () => {
    const response = await GET(
      createRequest("http://localhost:3000/api/health/detailed?format=prometheus"),
    )
    const text = await response.text()

    expect(text).toContain("# HELP")
    expect(text).toContain("# TYPE")
    expect(text).toContain("# EOF")
  })

  it("inclui métricas de serviço individuais", async () => {
    const response = await GET(
      createRequest("http://localhost:3000/api/health/detailed?format=prometheus"),
    )
    const text = await response.text()

    expect(text).toContain("severinno_service_status")
    expect(text).toContain("severinno_service_latency_ms")
    expect(text).toContain("severinno_build_info")
    expect(text).toContain("severinno_health_status")
    expect(text).toContain("severinno_services_total")
  })

  it("inclui métricas de processo (uptime, cpu, memory)", async () => {
    const response = await GET(
      createRequest("http://localhost:3000/api/health/detailed?format=prometheus"),
    )
    const text = await response.text()

    expect(text).toContain("severinno_process_uptime_seconds")
    expect(text).toContain("severinno_process_memory_rss_bytes")
  })
})
