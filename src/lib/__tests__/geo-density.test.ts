/**
 * geo-density.test.ts
 *
 * Tests src/lib/geo-density.ts — densidade de prestadores do marketplace
 * (métricas de busca por bairro/anel) usada para refinar a sugestão de raio.
 *
 * Coverage:
 *   ✅ fetchProviderDensity — busca, cache por célula (~1,1 km) e chave
 *   ✅ Coordenada inválida → null sem rede
 *   ✅ Falha de rede / payload malformado → null (degradação suave)
 *   ✅ refineSuggestedRadius — compõe anel + bairro mais denso
 *   ✅ clearDensityCache — isolação entre chamadas de teste
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

import { clearDensityCache, fetchProviderDensity, refineSuggestedRadius } from "../geo-density"
import { apiGet } from "@/lib/api"

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
}))

const DENSITY = {
  rings: [
    { radiusKm: 1, count: 40 },
    { radiusKm: 2, count: 75 },
    { radiusKm: 5, count: 120 },
    { radiusKm: 10, count: 150 },
    { radiusKm: 15, count: 160 },
    { radiusKm: 25, count: 170 },
    { radiusKm: 50, count: 180 },
  ],
  districts: [
    { district: "Centro", city: "Governador Valadares", count: 42, minDistanceKm: 0.8 },
    { district: "Cidade Nova", city: "Governador Valadares", count: 12, minDistanceKm: 3.1 },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  clearDensityCache()
})

describe("fetchProviderDensity", () => {
  it("busca e cacheia por célula de ~1,1 km (2 decimais)", async () => {
    vi.mocked(apiGet).mockResolvedValue(DENSITY)

    const first = await fetchProviderDensity(-18.8517, -41.9469)
    expect(first?.rings[0]).toEqual({ radiusKm: 1, count: 40 })

    // Mesma célula de cache (arredondamento a 2 decimais) → sem segunda chamada.
    const second = await fetchProviderDensity(-18.85169, -41.94691)
    expect(second).toBe(first)
    expect(apiGet).toHaveBeenCalledTimes(1)
    expect(apiGet).toHaveBeenCalledWith("/api/providers/density", {
      lat: "-18.85",
      lng: "-41.95",
    })
  })

  it("célula vizinha (2 decimais diferentes) faz nova chamada", async () => {
    vi.mocked(apiGet).mockResolvedValue(DENSITY)
    await fetchProviderDensity(-18.8517, -41.9469)
    await fetchProviderDensity(-18.86, -41.95)
    expect(apiGet).toHaveBeenCalledTimes(2)
  })

  it("coordenada inválida → null sem rede", async () => {
    expect(await fetchProviderDensity(Number.NaN, -41.95)).toBeNull()
    expect(await fetchProviderDensity(-18.85, Number.POSITIVE_INFINITY)).toBeNull()
    expect(apiGet).not.toHaveBeenCalled()
  })

  it("falha de rede → null (degradação suave)", async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error("redis down"))
    expect(await fetchProviderDensity(-23.55, -46.63)).toBeNull()
  })

  it("payload malformado → null", async () => {
    vi.mocked(apiGet).mockResolvedValue({})
    expect(await fetchProviderDensity(-23.55, -46.63)).toBeNull()
  })
})

describe("refineSuggestedRadius", () => {
  it("compõe o anel escolhido + bairro mais denso", async () => {
    vi.mocked(apiGet).mockResolvedValue(DENSITY)
    const refined = await refineSuggestedRadius({
      accuracyM: 12,
      baseRadiusKm: 5,
      lat: -18.85,
      lng: -41.95,
    })
    // Anel de 1 km tem 40 ≥ 12 prestadores → raio encolhe; bairro = [0] (mais denso).
    expect(refined).toEqual({ radiusKm: 1, nearbyCount: 40, dense: true, district: "Centro" })
  })

  it("sem densidade (API falhou) → null", async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error("down"))
    const refined = await refineSuggestedRadius({
      accuracyM: 12,
      baseRadiusKm: 5,
      lat: -23.55,
      lng: -46.63,
    })
    expect(refined).toBeNull()
  })

  it("anel escolhido = base → null (nada a mudar)", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      rings: [
        { radiusKm: 1, count: 3 },
        { radiusKm: 5, count: 30 },
      ],
      districts: [],
    })
    const refined = await refineSuggestedRadius({
      accuracyM: 12,
      baseRadiusKm: 5,
      lat: -23.55,
      lng: -46.63,
    })
    expect(refined).toBeNull()
  })

  it("sem bairros na resposta → district null", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      rings: [
        { radiusKm: 1, count: 0 },
        { radiusKm: 50, count: 3 },
      ],
      districts: [],
    })
    const refined = await refineSuggestedRadius({
      accuracyM: 12,
      baseRadiusKm: 5,
      lat: -23.55,
      lng: -46.63,
    })
    expect(refined).toEqual({ radiusKm: 50, nearbyCount: 3, dense: false, district: null })
  })

  it("respeita target customizado", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      rings: [
        { radiusKm: 1, count: 5 },
        { radiusKm: 2, count: 9 },
      ],
      districts: [],
    })
    const refined = await refineSuggestedRadius({
      accuracyM: 12,
      baseRadiusKm: 5,
      lat: -23.55,
      lng: -46.63,
      target: 5,
    })
    expect(refined?.radiusKm).toBe(1)
  })
})
