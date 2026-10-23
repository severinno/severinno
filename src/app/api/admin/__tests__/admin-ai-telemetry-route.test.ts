import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "../metrics/ai-telemetry/route"
import { requireRole } from "@/lib/auth"
import { checkLocalAiHealth, getCloudAiConfig } from "@/lib/ai-client"
import { getAICacheMetrics } from "@/lib/ai-cache"

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockImplementation(async (role: string) => {
    if (role !== "ADMIN") {
      const err = new Error("Acesso proibido")
      ;(err as any).name = "AuthError"
      ;(err as any).code = "FORBIDDEN"
      ;(err as any).status = 403
      throw err
    }
  }),
  requireAuth: vi.fn().mockResolvedValue({ id: "admin-1", role: "ADMIN" }),
  getSession: vi.fn().mockResolvedValue({ id: "admin-1", role: "ADMIN" }),
}))

vi.mock("@/lib/ai-client", () => ({
  checkLocalAiHealth: vi.fn(),
  getCloudAiConfig: vi.fn(),
}))

vi.mock("@/lib/ai-cache", () => ({
  getAICacheMetrics: vi.fn(),
}))

describe("GET /api/admin/metrics/ai-telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("retorna telemetria completa de IA com status 200 para admin", async () => {
    vi.mocked(checkLocalAiHealth).mockResolvedValue({
      status: "UP",
      latencyMs: 42,
      details: "Ollama online com 2 modelos carregados",
      models: ["llama3.2:3b", "nomic-embed-text"],
      engine: "ollama",
    })

    vi.mocked(getCloudAiConfig).mockReturnValue({
      apiUrl: "https://api.groq.com/openai/v1",
      apiKey: "gsk_test12345",
      defaultModel: "llama-3.3-70b-versatile",
    })

    vi.mocked(getAICacheMetrics).mockReturnValue({
      hits: 150,
      misses: 50,
      total: 200,
      hitRatio: 0.75,
    })

    const req = new Request("http://localhost:3000/api/admin/metrics/ai-telemetry")
    const res = await GET(req as any)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.data).toBeDefined()
    expect(json.data.localAi.status).toBe("UP")
    expect(json.data.localAi.engine).toBe("ollama")
    expect(json.data.cloudAi.status).toBe("CONFIGURED")
    expect(json.data.cloudAi.provider).toBe("Groq Cloud LPU")
    expect(json.data.semanticCache.hits).toBe(150)
    expect(json.data.semanticCache.hitRatioPercent).toBe(75)
    // 150 hits * 450 tokens = 67,500 tokens
    expect(json.data.semanticCache.estimatedTokensSaved).toBe(67500)
    // (67500 / 1,000,000) * 0.79 = 0.053325 -> 0.0533
    expect(json.data.semanticCache.estimatedCostSavedUsd).toBe(0.0533)
    expect(json.data.semanticSearch.vectorDimension).toBe(128)
    expect(json.data.semanticSearch.status).toBe("ONLINE")
  })

  it("bloqueia acesso se usuário não for ADMIN", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(
      Object.assign(new Error("Acesso proibido"), {
        name: "AuthError",
        code: "FORBIDDEN",
        status: 403,
      }),
    )

    const req = new Request("http://localhost:3000/api/admin/metrics/ai-telemetry")
    const res = await GET(req as any)
    expect(res.status).toBe(403)
  })
})
