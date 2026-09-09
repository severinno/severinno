import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { isRushHour, calculateTravelFee } from "../travel-fee"

// Mock calculateRouteAndEta from osrm
vi.mock("@/lib/osrm", () => ({
  calculateRouteAndEta: vi.fn(async () => ({
    distanceKm: 15,
    durationMin: 20,
    origin: { lat: -23.5505, lng: -46.6333 },
    destination: { lat: -23.6042, lng: -46.6669 },
    source: "osrm" as const,
  })),
}))

describe("travel-fee.ts — Rush Hour and Travel Fee Calculation", () => {
  // calculateTravelFee chama isRushHour() com o RELÓGIO REAL para aplicar o
  // multiplicador de pico (1.25) — sem congelar, o fee varia com o horário em
  // que a suíte roda (mesma bomba-relógio do geo-innovations). isRushHour nos
  // testes abaixo recebe datas explícitas, mas o guard exige clock control
  // para QUALQUER uso de isRushHour (proteção contra edição futura).
  // Congela SÓ Date (toFake: ["Date"]) num horário neutro (12:00 BRT — fora
  // dos picos 07:30–09:30 e 17:30–19:30).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-01-05T15:00:00.000Z")) // segunda 12:00 BRT
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("detects morning rush hour on a weekday (08:15 BRT)", () => {
    // 2026-09-08 is a Tuesday. 08:15 BRT = 11:15 UTC
    const date = new Date("2026-09-08T11:15:00Z")
    expect(isRushHour(date)).toBe(true)
  })

  it("detects evening rush hour on a weekday (18:30 BRT)", () => {
    // 18:30 BRT = 21:30 UTC
    const date = new Date("2026-09-08T21:30:00Z")
    expect(isRushHour(date)).toBe(true)
  })

  it("detects off-peak on a weekday (14:00 BRT)", () => {
    // 14:00 BRT = 17:00 UTC
    const date = new Date("2026-09-08T17:00:00Z")
    expect(isRushHour(date)).toBe(false)
  })

  it("returns false on weekends even during peak hours (Sunday 08:30 BRT)", () => {
    // 2026-09-06 is Sunday
    const date = new Date("2026-09-06T11:30:00Z")
    expect(isRushHour(date)).toBe(false)
  })

  it("calculates travel fee with breakdown correctly", async () => {
    const fee = await calculateTravelFee(-23.5505, -46.6333, -23.6042, -46.6669, {
      freeKmThreshold: 5,
      pricePerKm: 2.5,
    })

    expect(fee.distanceKm).toBe(15)
    expect(fee.freeKm).toBe(5)
    expect(fee.billableKm).toBe(10)
    expect(fee.travelFee).toBeGreaterThanOrEqual(25)
    expect(fee.formattedFee).toMatch(/R\$/)
    expect(fee.trafficMultiplier).toBeGreaterThanOrEqual(1.0)
  })
})
