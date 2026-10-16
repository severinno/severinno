import { describe, it, expect } from "vitest"
import {
  findRouteBatchOpportunities,
  calculateDistanceMeters,
  ScheduledStop,
  CandidateJob,
} from "../provider-route-batcher"

describe("provider-route-batcher", () => {
  it("calcula distância Haversine em metros entre dois pontos com precisão", () => {
    // Centro GV (-18.851, -41.945) até Ilha dos Araújos (-18.858, -41.939) ~1.0 km
    const dist = calculateDistanceMeters(-18.851, -41.945, -18.858, -41.939)
    expect(dist).toBeGreaterThan(800)
    expect(dist).toBeLessThan(1400)
  })

  it("identifica oportunidade de encaixe de rota próxima e calcula economia de combustível", () => {
    const schedule: ScheduledStop[] = [
      {
        id: "stop-1",
        bookingId: "bk-100",
        title: "Instalação de Chuveiro",
        scheduledTime: "14:00",
        lat: -18.858,
        lng: -41.939,
        neighborhood: "Ilha dos Araújos",
        estimatedDurationMinutes: 60,
      },
    ]

    const candidates: CandidateJob[] = [
      {
        id: "cand-close",
        clientName: "Mariana Costa",
        serviceTitle: "Troca de Tomadas",
        lat: -18.857, // ~300m de distância
        lng: -41.94,
        neighborhood: "Ilha dos Araújos",
        requestedWindow: "15:30 - 17:00",
        estimatedPrice: 90.0,
      },
      {
        id: "cand-far",
        clientName: "Pedro Longe",
        serviceTitle: "Pintura Externa",
        lat: -18.95, // ~12km de distância
        lng: -42.05,
        neighborhood: "Zona Rural",
        requestedWindow: "15:00 - 16:00",
        estimatedPrice: 200.0,
      },
    ]

    const opportunities = findRouteBatchOpportunities(schedule, candidates, {
      maxDetourKm: 2.0,
    })

    // cand-far deve ser ignorado por estar a 12km
    expect(opportunities).toHaveLength(1)

    const match = opportunities[0]
    expect(match.candidateId).toBe("cand-close")
    expect(match.clientName).toBe("Mariana Costa")
    expect(match.distanceMeters).toBeLessThan(500)
    expect(match.efficiencyScore).toBeGreaterThanOrEqual(90)
    expect(match.fuelSavedKm).toBeGreaterThan(10)
    expect(match.proximityBonusAmount).toBe(15.0)
    expect(match.dispatchPitch).toContain("Mariana Costa")
    expect(match.dispatchPitch).toContain("Ilha dos Araújos")
  })

  it("retorna lista vazia se agenda ou candidatos estiverem vazios", () => {
    expect(findRouteBatchOpportunities([], [])).toEqual([])
  })
})
