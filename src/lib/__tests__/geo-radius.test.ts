/**
 * geo-radius.test.ts
 *
 * Tests suggestRadiusFromAccuracy — raio inicial sugerido a partir da
 * precisão (accuracy, em metros) reportada pelo GPS.
 *
 * Coverage:
 *   ✅ Tiers de accuracy → raio sugerido
 *   ✅ Fallback 15 km sem accuracy válida (null/undefined/NaN/≤0/Infinity)
 *   ✅ Fronteiras exatas de cada tier
 *   ✅ radiusBounds — bounds simétricas do círculo para fitBounds
 *   ✅ refineRadiusWithDensity — refino pela densidade do marketplace
 *   ✅ nearbyPhrase — frase pt-BR singular/plural
 */

import { describe, it, expect } from "vitest"

import {
  suggestRadiusFromAccuracy,
  refineRadiusWithDensity,
  nearbyPhrase,
  radiusBounds,
  DEFAULT_RADIUS_KM,
  MAX_RADIUS_KM,
  DENSITY_TARGET_PROVIDERS,
} from "../geo-radius"

describe("suggestRadiusFromAccuracy", () => {
  it("usa 15 km (default) quando a accuracy é ausente ou inválida", () => {
    expect(suggestRadiusFromAccuracy(null)).toBe(DEFAULT_RADIUS_KM)
    expect(suggestRadiusFromAccuracy(undefined)).toBe(DEFAULT_RADIUS_KM)
    expect(suggestRadiusFromAccuracy(Number.NaN)).toBe(DEFAULT_RADIUS_KM)
    expect(suggestRadiusFromAccuracy(0)).toBe(DEFAULT_RADIUS_KM)
    expect(suggestRadiusFromAccuracy(-5)).toBe(DEFAULT_RADIUS_KM)
    expect(suggestRadiusFromAccuracy(Number.POSITIVE_INFINITY)).toBe(DEFAULT_RADIUS_KM)
  })

  it("GPS excelente (≤ 30 m) sugere 5 km", () => {
    expect(suggestRadiusFromAccuracy(5)).toBe(5)
    expect(suggestRadiusFromAccuracy(12)).toBe(5)
    expect(suggestRadiusFromAccuracy(30)).toBe(5)
  })

  it("GPS bom (31–100 m) sugere 8 km", () => {
    expect(suggestRadiusFromAccuracy(31)).toBe(8)
    expect(suggestRadiusFromAccuracy(100)).toBe(8)
  })

  it("Wi-Fi/triangulação (101–1000 m) sugere 15 km", () => {
    expect(suggestRadiusFromAccuracy(101)).toBe(15)
    expect(suggestRadiusFromAccuracy(500)).toBe(15)
    expect(suggestRadiusFromAccuracy(1_000)).toBe(15)
  })

  it("torre celular (1001–5000 m) sugere 30 km", () => {
    expect(suggestRadiusFromAccuracy(1_001)).toBe(30)
    expect(suggestRadiusFromAccuracy(5_000)).toBe(30)
  })

  it("fix muito grosseira (> 5000 m) sugere 50 km", () => {
    expect(suggestRadiusFromAccuracy(5_001)).toBe(50)
    expect(suggestRadiusFromAccuracy(12_000)).toBe(50)
  })

  it("nunca passa do limite máximo do slider", () => {
    for (const acc of [50_000, 500_000, 1e9]) {
      expect(suggestRadiusFromAccuracy(acc)).toBeLessThanOrEqual(MAX_RADIUS_KM)
    }
  })
})

describe("radiusBounds", () => {
  it("gera bounds simétricas em torno do centro", () => {
    const [[w, s], [e, n]] = radiusBounds(-18.8517, -41.9469, 15)
    expect(s).toBeCloseTo(-18.8517 - 15 / 111.32, 6)
    expect(n).toBeCloseTo(-18.8517 + 15 / 111.32, 6)
    expect(w).toBeLessThan(-41.9469)
    expect(e).toBeGreaterThan(-41.9469)
    expect((w + e) / 2).toBeCloseTo(-41.9469, 6)
    expect((s + n) / 2).toBeCloseTo(-18.8517, 6)
  })

  it("raio inválido cai no mínimo sem quebrar (bounds finitas)", () => {
    const [[w, s], [e, n]] = radiusBounds(-23.55, -46.63, 0)
    expect(Number.isFinite(w)).toBe(true)
    expect(Number.isFinite(s)).toBe(true)
    expect(Number.isFinite(e)).toBe(true)
    expect(Number.isFinite(n)).toBe(true)
  })
})

// ===========================================================================
// Refino pela densidade do marketplace (prestadores por bairro/anel)
// ===========================================================================

describe("refineRadiusWithDensity", () => {
  // Bairro denso (centro): 40 prestadores já a 1 km.
  const denseRings = [
    { radiusKm: 1, count: 40 },
    { radiusKm: 2, count: 75 },
    { radiusKm: 5, count: 120 },
    { radiusKm: 10, count: 150 },
    { radiusKm: 15, count: 160 },
    { radiusKm: 25, count: 170 },
    { radiusKm: 50, count: 180 },
  ]
  // Zona rural: 9 prestadores mesmo a 50 km.
  const sparseRings = [
    { radiusKm: 1, count: 0 },
    { radiusKm: 2, count: 0 },
    { radiusKm: 5, count: 2 },
    { radiusKm: 10, count: 3 },
    { radiusKm: 15, count: 4 },
    { radiusKm: 25, count: 6 },
    { radiusKm: 50, count: 9 },
  ]

  it("sem anéis (API indisponível) → null: mantém a sugestão por accuracy", () => {
    expect(refineRadiusWithDensity({ accuracyM: 12, baseRadiusKm: 5, rings: [] })).toBeNull()
    expect(
      refineRadiusWithDensity({ accuracyM: 12, baseRadiusKm: 5, rings: undefined as never }),
    ).toBeNull()
  })

  it("baseRadiusKm inválido → null", () => {
    expect(
      refineRadiusWithDensity({ accuracyM: 12, baseRadiusKm: 0, rings: denseRings }),
    ).toBeNull()
    expect(
      refineRadiusWithDensity({ accuracyM: 12, baseRadiusKm: Number.NaN, rings: denseRings }),
    ).toBeNull()
  })

  it("descarta anéis inválidos antes de decidir", () => {
    const refined = refineRadiusWithDensity({
      accuracyM: 12,
      baseRadiusKm: 5,
      rings: [
        { radiusKm: Number.NaN, count: 100 },
        { radiusKm: 2, count: -1 },
        { radiusKm: 3, count: 30 },
      ],
    })
    expect(refined).toEqual({ radiusKm: 3, nearbyCount: 30, dense: true })
  })

  it("área densa encolhe o raio até o menor anel com oferta saudável", () => {
    const refined = refineRadiusWithDensity({ accuracyM: 12, baseRadiusKm: 5, rings: denseRings })
    expect(refined).toEqual({ radiusKm: 1, nearbyCount: 40, dense: true })
  })

  it("piso da accuracy: fix grosseira (5 km) não vira raio minúsculo", () => {
    // floor = 3×5 km = 15 → cap de 10 km vence; mesmo com o anel de 1 km denso.
    const refined = refineRadiusWithDensity({
      accuracyM: 5_000,
      baseRadiusKm: 30,
      rings: denseRings,
    })
    expect(refined).toEqual({ radiusKm: 10, nearbyCount: 40, dense: true })
  })

  it("área esparsa cresce até o anel mais largo", () => {
    const refined = refineRadiusWithDensity({ accuracyM: 12, baseRadiusKm: 5, rings: sparseRings })
    expect(refined).toEqual({ radiusKm: 50, nearbyCount: 9, dense: false })
  })

  it("anel escolhido coincide com a base → null (nada a mudar)", () => {
    const rings = [
      { radiusKm: 1, count: 3 },
      { radiusKm: 2, count: 5 },
      { radiusKm: 5, count: 30 },
      { radiusKm: 10, count: 60 },
    ]
    expect(refineRadiusWithDensity({ accuracyM: 12, baseRadiusKm: 5, rings })).toBeNull()
  })

  it("usa DENSITY_TARGET_PROVIDERS como alvo default", () => {
    const rings = [
      { radiusKm: 1, count: DENSITY_TARGET_PROVIDERS - 1 },
      { radiusKm: 2, count: DENSITY_TARGET_PROVIDERS },
    ]
    const refined = refineRadiusWithDensity({ accuracyM: 12, baseRadiusKm: 8, rings })
    expect(refined).toEqual({ radiusKm: 2, nearbyCount: DENSITY_TARGET_PROVIDERS, dense: true })
  })

  it("target customizado muda o anel escolhido", () => {
    const rings = [
      { radiusKm: 1, count: 5 },
      { radiusKm: 2, count: 9 },
    ]
    expect(refineRadiusWithDensity({ accuracyM: 12, baseRadiusKm: 5, rings, target: 5 })).toEqual({
      radiusKm: 1,
      nearbyCount: 5,
      dense: true,
    })
    expect(refineRadiusWithDensity({ accuracyM: 12, baseRadiusKm: 5, rings, target: 20 })).toEqual({
      radiusKm: 2,
      nearbyCount: 9,
      dense: true,
    })
  })

  it("nunca passa do teto do slider", () => {
    const refined = refineRadiusWithDensity({
      accuracyM: 12,
      baseRadiusKm: 5,
      rings: [{ radiusKm: 500, count: 999 }],
    })
    expect(refined?.radiusKm).toBe(MAX_RADIUS_KM)
  })

  it("accuracy inválida usa piso mínimo (1 km)", () => {
    const refined = refineRadiusWithDensity({
      accuracyM: null,
      baseRadiusKm: 15,
      rings: [{ radiusKm: 1, count: 50 }],
    })
    expect(refined).toEqual({ radiusKm: 1, nearbyCount: 50, dense: true })
  })
})

describe("nearbyPhrase", () => {
  it("singular/plural em pt-BR e casos nulos", () => {
    expect(nearbyPhrase(1)).toBe("1 prestador por perto")
    expect(nearbyPhrase(18)).toBe("18 prestadores por perto")
    expect(nearbyPhrase(0)).toBe("nenhum prestador por perto")
    expect(nearbyPhrase(Number.NaN)).toBe("nenhum prestador por perto")
  })
})
