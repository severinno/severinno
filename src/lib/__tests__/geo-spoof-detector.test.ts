import { describe, it, expect } from "vitest"
import { evaluateGeoTelemetry } from "../geo-spoof-detector"

describe("geo-spoof-detector", () => {
  const baseTime = 1700000000000

  it("aprova como GENUINE telemetria legítima com deslocamento urbano normal", () => {
    const prev = {
      latitude: -18.851,
      longitude: -41.949,
      accuracy: 8,
      timestamp: baseTime,
    }

    const current = {
      latitude: -18.8515,
      longitude: -41.9492,
      accuracy: 6,
      timestamp: baseTime + 30000, // 30 segundos depois (~60 metros de distância)
    }

    const verdict = evaluateGeoTelemetry(current, prev)

    expect(verdict.verdict).toBe("GENUINE")
    expect(verdict.score).toBeLessThan(30)
    expect(verdict.allowCheckin).toBe(true)
    expect(verdict.allowEscrowRelease).toBe(true)
    expect(verdict.requiresPhotoProof).toBe(false)
  })

  it("detecta SPOOF_DETECTED imediatamente se flag isMock/mocked for verdadeira", () => {
    const current = {
      latitude: -18.851,
      longitude: -41.949,
      accuracy: 10,
      isMock: true,
      timestamp: baseTime,
    }

    const verdict = evaluateGeoTelemetry(current)

    expect(verdict.verdict).toBe("SPOOF_DETECTED")
    expect(verdict.score).toBe(100)
    expect(verdict.allowEscrowRelease).toBe(false)
    expect(verdict.allowCheckin).toBe(false)
    expect(verdict.reasons[0]).toContain("Mock Provider")
  })

  it("detecta teletransporte cinemático (salto de 5 km em 2 segundos)", () => {
    const prev = {
      latitude: -18.851,
      longitude: -41.949,
      accuracy: 5,
      timestamp: baseTime,
    }

    const current = {
      latitude: -18.895, // ~5 km ao sul
      longitude: -41.949,
      accuracy: 5,
      timestamp: baseTime + 2000, // 2 segundos depois!
    }

    const verdict = evaluateGeoTelemetry(current, prev)

    expect(verdict.verdict).toBe("SPOOF_DETECTED")
    expect(verdict.score).toBeGreaterThanOrEqual(70)
    expect(verdict.allowEscrowRelease).toBe(false)
    expect(verdict.reasons.some((r) => r.includes("Salto quântico"))).toBe(true)
  })

  it("marca como SUSPICIOUS precisão artificial de emulador (< 0.5m)", () => {
    const current = {
      latitude: -18.851,
      longitude: -41.949,
      accuracy: 0.1, // Artificial
      timestamp: baseTime,
    }

    const verdict = evaluateGeoTelemetry(current)

    expect(verdict.verdict).toBe("SUSPICIOUS")
    expect(verdict.allowEscrowRelease).toBe(false)
    expect(verdict.requiresPhotoProof).toBe(true)
    expect(verdict.reasons[0]).toContain("Acurácia excessivamente precisa")
  })

  it("rejeita coordenadas inválidas ou fora dos limites terrestres", () => {
    const current = {
      latitude: 195.0, // Impossível
      longitude: -41.949,
      timestamp: baseTime,
    }

    const verdict = evaluateGeoTelemetry(current)

    expect(verdict.verdict).toBe("SPOOF_DETECTED")
    expect(verdict.score).toBe(100)
    expect(verdict.allowCheckin).toBe(false)
  })
})
