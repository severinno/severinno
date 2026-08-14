import { describe, it, expect, vi, beforeEach } from "vitest"
import { findBestProviders } from "@/lib/smart-match"
import { categorizeServiceRequest } from "@/lib/ai-categorizer"
import { isLocalAiOnline } from "@/lib/ai-client"

// Mock dependencies
vi.mock("@/lib/db", () => ({
  db: {
    category: {
      findMany: vi.fn().mockResolvedValue([
        { id: "cat-1", name: "Encanador", slug: "encanador" },
        { id: "cat-2", name: "Eletricista", slug: "eletricista" },
        { id: "cat-3", name: "Pintor", slug: "pintor" },
      ]),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "prov-1",
          name: "João Silva",
          avatarUrl: null,
          verified: true,
          avgRating: 4.9,
          reviewCount: 42,
          lat: -23.5505,
          lng: -46.6333,
          services: [{ id: "svc-1", title: "Conserto de Vazamento", basePrice: 120 }],
        },
        {
          id: "prov-2",
          name: "Carlos Reparos",
          avatarUrl: null,
          verified: false,
          avgRating: 4.2,
          reviewCount: 8,
          lat: -23.56,
          lng: -46.64,
          services: [{ id: "svc-2", title: "Encanamento Geral", basePrice: 150 }],
        },
      ]),
    },
  },
}))

vi.mock("@/lib/postgis", () => ({
  findProvidersWithinRadius: vi.fn().mockResolvedValue([
    { id: "prov-1", distanceKm: 2.5 },
    { id: "prov-2", distanceKm: 5.0 },
  ]),
}))

describe("High-Value Features Unit & Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("1. Smart Match Engine (@/lib/smart-match)", () => {
    it("should rank providers by distance, rating and verified badge", async () => {
      const candidates = await findBestProviders({
        categoryId: "cat-1",
        lat: -23.55,
        lng: -46.63,
        limit: 5,
      })

      expect(candidates).toHaveLength(2)
      // João Silva should be first (verified, 4.9 rating, closer)
      expect(candidates[0].name).toBe("João Silva")
      expect(candidates[0].verified).toBe(true)
      expect(candidates[0].matchScore).toBeGreaterThan(candidates[1].matchScore)
    })
  })

  describe("2. AI Categorizer & Fallback (@/lib/ai-categorizer)", () => {
    it("should categorize plumbing problem with keyword fallback when LocalAI is offline", async () => {
      const result = await categorizeServiceRequest(
        "Estou com um vazamento na pia da cozinha urgente",
      )

      expect(result.problemSeverity).toBe("HIGH")
      expect(result.estimatedPriceRange.min).toBeGreaterThanOrEqual(80)
      expect(result.estimatedPriceRange.max).toBeGreaterThan(result.estimatedPriceRange.min)
      expect(result.source).toBe("keyword-fallback")
    })

    it("should detect electrical category correctly", async () => {
      const result = await categorizeServiceRequest(
        "Preciso de um eletricista para trocar a fiação do chuveiro",
      )

      expect(result.categoryName).toBe("Eletricista")
      expect(result.categoryId).toBe("cat-2")
    })
  })

  describe("3. LocalAI Client Health (@/lib/ai-client)", () => {
    it("should handle offline LocalAI gracefully", async () => {
      const online = await isLocalAiOnline()
      expect(typeof online).toBe("boolean")
    })
  })
})
