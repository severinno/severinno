import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { GET, PUT } from "../transport/route"

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockResolvedValue({ userId: "prov-1", role: "PROVIDER" }),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { general: {} },
}))

let currentMode = "CAR"

vi.mock("@/lib/provider-transport-preferences", () => ({
  getProviderTransportProfile: vi.fn(async () => ({
    mode: currentMode,
    urbanRoadFactor: currentMode === "MOTO" ? 1.25 : 1.38,
    avgSpeedKmh: currentMode === "MOTO" ? 36.0 : 28.0,
    label: currentMode === "MOTO" ? "Motocicleta / Scooter" : "Carro / Veículo",
  })),
  setProviderTransportMode: vi.fn(async (_, mode) => {
    currentMode = mode
    return {
      mode,
      urbanRoadFactor: mode === "MOTO" ? 1.25 : 1.38,
      avgSpeedKmh: mode === "MOTO" ? 36.0 : 28.0,
      label: mode === "MOTO" ? "Motocicleta / Scooter" : "Carro / Veículo",
    }
  }),
}))

describe("Provider Transport Preferences API", () => {
  beforeEach(() => {
    currentMode = "CAR"
    vi.clearAllMocks()
  })

  it("GET returns current transport profile", async () => {
    const req = new NextRequest("http://localhost:3000/api/provider/preferences/transport")
    const res = await GET(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.mode).toBe("CAR")
    expect(json.profile.avgSpeedKmh).toBe(28.0)
  })

  it("PUT updates transport mode to MOTO", async () => {
    const req = new NextRequest("http://localhost:3000/api/provider/preferences/transport", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "MOTO" }),
    })
    const res = await PUT(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.mode).toBe("MOTO")
    expect(json.profile.urbanRoadFactor).toBe(1.25)
  })

  it("PUT rejects invalid transport mode", async () => {
    const req = new NextRequest("http://localhost:3000/api/provider/preferences/transport", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "HELICOPTER" }),
    })
    const res = await PUT(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(400)
  })
})
