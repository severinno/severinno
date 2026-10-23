import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "../route"
import * as semanticSearch from "@/lib/ai-semantic-search"

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { general: {} },
}))

vi.mock("@/lib/ai-semantic-search", () => ({
  searchSemanticCatalog: vi.fn(),
}))

describe("GET /api/search/semantic", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("retorna resultados semânticos para uma consulta válida", async () => {
    vi.mocked(semanticSearch.searchSemanticCatalog).mockResolvedValue([
      {
        serviceId: "svc-1",
        title: "Reparo Hidráulico",
        categoryName: "Encanador",
        description: "Conserto de vazamento de água",
        basePrice: 150,
        similarityScore: 0.88,
        matchType: "sparse_semantic",
        providerId: "prov-1",
        providerName: "Marcos",
      },
    ])

    const req = new Request("http://localhost:3000/api/search/semantic?q=pia%20vazando")
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.query).toBe("pia vazando")
    expect(json.count).toBe(1)
    expect(json.results[0].title).toBe("Reparo Hidráulico")
  })

  it("retorna 400 se a consulta for muito curta (< 2 caracteres)", async () => {
    const req = new Request("http://localhost:3000/api/search/semantic?q=a")
    const res = await GET(req)
    expect(res.status).toBe(400)
  })
})
