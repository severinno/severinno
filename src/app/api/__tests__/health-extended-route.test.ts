import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "../health/extended/route"

vi.mock("@/lib/db", () => ({
  db: {
    user: { count: vi.fn().mockResolvedValue(42) },
    $queryRaw: vi.fn().mockResolvedValue([{ extname: "postgis", extversion: "3.4.0" }]),
  },
}))

vi.mock("@/lib/redis-geo", () => ({
  RedisGeoCache: {
    getStats: vi.fn().mockResolvedValue({ cachedLocations: 120, engine: "redis" }),
  },
}))

vi.mock("@/lib/evolution", () => ({
  checkWhatsAppSessionHeartbeat: vi.fn().mockResolvedValue({
    connected: true,
    instanceName: "severinno-prod",
    status: "open",
    latencyMs: 15,
  }),
}))

vi.mock("@/lib/ai-client", () => ({
  checkLocalAiHealth: vi.fn().mockResolvedValue({
    status: "UP",
    latencyMs: 45,
    details: "Ollama ativo com 1 modelo(s): llama3.2:3b",
    models: ["llama3.2:3b"],
    engine: "ollama",
  }),
}))

describe("GET /api/health/extended", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ routes: [{ distance: 1000 }] }),
    }) as any
  })

  it("retorna 200 com status HEALTHY e inclui probe de IA local", async () => {
    const res = await GET()
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.status).toBe("HEALTHY")
    expect(data.services.database.status).toBe("UP")
    expect(data.services.localAi).toBeDefined()
    expect(data.services.localAi.status).toBe("UP")
    expect(data.services.localAi.details).toContain("Ollama ativo")
    expect(data.system.memory).toBeDefined()
  })
})
