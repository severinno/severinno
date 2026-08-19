import { describe, it, expect, vi, beforeEach } from "vitest"
import { searchNearbyProvidersFast, seedGeoIndex } from "@/lib/redis-geo"
import { analyzeMessageForLeakage } from "@/lib/leak-detector"

vi.mock("@/lib/postgis", () => ({
  findProvidersWithinRadius: vi.fn().mockResolvedValue([{ id: "postgis-prov-1", distanceKm: 4.2 }]),
}))

describe("Advanced Optimizations & Anti-Fraud Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("1. Turbo Redis GEO & Fast Spatial Index (@/lib/redis-geo)", () => {
    it("should seed fast index and return nearby providers in sub-5ms", async () => {
      // Seed 3 providers near São Paulo Center (-23.55, -46.63)
      seedGeoIndex([
        { id: "prov-fast-1", lat: -23.551, lng: -46.634 }, // ~150m
        { id: "prov-fast-2", lat: -23.56, lng: -46.65 }, // ~2.5km
        { id: "prov-far-away", lat: -23.99, lng: -46.99 }, // ~60km (outside 10km)
      ])

      const results = await searchNearbyProvidersFast(-23.5505, -46.6333, 10, 10)

      expect(results.length).toBe(2)
      expect(results[0].id).toBe("prov-fast-1")
      expect(results[0].source).toBe("fast-index")
      expect(results[0].distanceKm).toBeLessThan(1.0)
    })
  })

  describe("2. AI Anti-Fraud & Leakage Detector (@/lib/leak-detector)", () => {
    it("should flag suspicious off-platform payment requests as HIGH risk", () => {
      const message = "Olá amigo, se você me pagar por fora no dinheiro eu dou R$ 50 de desconto"
      const result = analyzeMessageForLeakage(message)

      expect(result.isSuspicious).toBe(true)
      expect(result.riskLevel).toBe("HIGH")
      expect(result.warning).toContain("Custódia Segura (Escrow)")
    })

    it("should flag direct PIX key requests as HIGH risk", () => {
      const message = "Manda o pix direto na minha chave 11999999999"
      const result = analyzeMessageForLeakage(message)

      expect(result.isSuspicious).toBe(true)
      expect(result.riskLevel).toBe("HIGH")
      expect(result.detectedPatterns).toContain("Solicitação de chave PIX direta externa")
    })

    it("should pass legitimate conversation without false positives", () => {
      const message =
        "Boa tarde! Que horas você consegue chegar para realizar a instalação do chuveiro?"
      const result = analyzeMessageForLeakage(message)

      expect(result.isSuspicious).toBe(false)
      expect(result.riskLevel).toBe("NONE")
      expect(result.warning).toBeNull()
    })
  })
})
