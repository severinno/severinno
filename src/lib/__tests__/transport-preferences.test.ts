import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  getProviderTransportMode,
  setProviderTransportMode,
  getProviderTransportProfile,
} from "@/lib/provider-transport-preferences"
import { optimizeDailyRoute2Opt } from "@/lib/tsp-route-optimizer"
import { evaluateBestSlotFit } from "@/lib/smart-slot-fit"

const { mockCache } = vi.hoisted(() => ({
  mockCache: new Map<string, any>(),
}))

vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn(async (key: string) => mockCache.get(key) ?? null),
  cacheSet: vi.fn(async (key: string, val: any) => {
    mockCache.set(key, val)
    return true
  }),
  cacheInvalidate: vi.fn().mockResolvedValue(true),
}))

describe("Provider Transport Preferences & Routing Calibration", () => {
  beforeEach(() => {
    mockCache.clear()
    vi.clearAllMocks()
  })

  it("defaults to CAR when no preference is configured", async () => {
    const mode = await getProviderTransportMode("prov-1")
    expect(mode).toBe("CAR")

    const profile = await getProviderTransportProfile("prov-1")
    expect(profile.mode).toBe("CAR")
    expect(profile.avgSpeedKmh).toBe(28.0)
    expect(profile.urbanRoadFactor).toBe(1.38)
  })

  it("persists and returns MOTO locomotion mode", async () => {
    const profile = await setProviderTransportMode("prov-1", "MOTO")
    expect(profile.mode).toBe("MOTO")
    expect(profile.avgSpeedKmh).toBe(36.0)
    expect(profile.urbanRoadFactor).toBe(1.25)

    const saved = await getProviderTransportMode("prov-1")
    expect(saved).toBe("MOTO")
  })

  it("calibrates travel time and distance savings dynamically based on mode", () => {
    const base = { lat: -23.5505, lng: -46.6333 }
    const stops = [
      { id: "1", title: "Stop A", address: "A", lat: -23.5605, lng: -46.6433 },
      { id: "2", title: "Stop B", address: "B", lat: -23.5705, lng: -46.6533 },
    ]

    const carPlan = optimizeDailyRoute2Opt(base, stops, "CAR")
    const motoPlan = optimizeDailyRoute2Opt(base, stops, "MOTO")
    const bikePlan = optimizeDailyRoute2Opt(base, stops, "BICYCLE")

    expect(carPlan.transportMode).toBe("CAR")
    expect(motoPlan.transportMode).toBe("MOTO")
    expect(bikePlan.transportMode).toBe("BICYCLE")

    // Bike has lowest detour road factor (1.15) -> lowest distance
    expect(bikePlan.optimizedDistanceKm).toBeLessThan(carPlan.optimizedDistanceKm)
  })

  it("evaluates slot fit using selected transport mode", () => {
    const base = { lat: -23.5505, lng: -46.6333 }
    const existing = [{ id: "1", title: "Stop A", address: "A", lat: -23.5605, lng: -46.6433 }]
    const candidate = {
      title: "New Job",
      lat: -23.5615,
      lng: -46.6443,
    }

    const carFit = evaluateBestSlotFit(base, existing, candidate, "CAR")
    const motoFit = evaluateBestSlotFit(base, existing, candidate, "MOTO")

    expect(carFit.bestSlot.addedDetourKm).toBeGreaterThanOrEqual(motoFit.bestSlot.addedDetourKm)
  })
})
