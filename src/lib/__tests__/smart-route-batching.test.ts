import { describe, it, expect } from "vitest"
import {
  calculateRouteBatchOpportunity,
  rankProvidersWithBatching,
  type ProviderScheduleSlot,
  type RouteBatchRequest,
} from "@/lib/smart-route-batching"

describe("smart-route-batching", () => {
  const existingSlotIlha: ProviderScheduleSlot = {
    id: "slot-1",
    providerId: "p-carlos",
    providerName: "Carlos Eletricista",
    scheduledAt: "2026-10-16T14:00:00Z",
    durationMinutes: 60,
    location: {
      lat: -18.8546,
      lng: -41.9443,
      neighborhood: "Ilha dos Araújos",
      city: "Governador Valadares",
    },
  }

  it("identifica oportunidade de agrupamento para atendimentos no mesmo bairro com intervalo compatível", () => {
    const requestIlha: RouteBatchRequest = {
      requestedAt: "2026-10-16T15:30:00Z", // 90 min depois
      estimatedDurationMinutes: 45,
      location: {
        lat: -18.855,
        lng: -41.945, // ~150 metros
        neighborhood: "Ilha dos Araújos",
        city: "Governador Valadares",
      },
    }

    const opp = calculateRouteBatchOpportunity(existingSlotIlha, requestIlha)

    expect(opp.isBatchable).toBe(true)
    expect(opp.sameNeighborhood).toBe(true)
    expect(opp.distanceKm).toBeLessThan(1.0)
    expect(opp.clientDiscountAmount).toBeGreaterThanOrEqual(10)
    expect(opp.providerBonusScore).toBeGreaterThan(20)
    expect(opp.badgeLabel).toContain("Prestador já no seu Bairro")
  })

  it("rejeita quando a distância excede 3.5 km ou tempo excede 3 horas", () => {
    const farRequest: RouteBatchRequest = {
      requestedAt: "2026-10-16T19:00:00Z", // 5 horas depois
      estimatedDurationMinutes: 45,
      location: {
        lat: -18.91,
        lng: -42.02, // ~10 km
        neighborhood: "Distrito Industrial",
        city: "Governador Valadares",
      },
    }

    const opp = calculateRouteBatchOpportunity(existingSlotIlha, farRequest)

    expect(opp.isBatchable).toBe(false)
    expect(opp.clientDiscountAmount).toBe(0)
    expect(opp.providerBonusScore).toBe(0)
  })

  it("reordena ranking priorizando o prestador com carona de rota viável", () => {
    const newRequest: RouteBatchRequest = {
      requestedAt: "2026-10-16T15:00:00Z",
      estimatedDurationMinutes: 60,
      location: {
        lat: -18.8548,
        lng: -41.9445,
        neighborhood: "Ilha dos Araújos",
      },
    }

    const candidates = [
      {
        providerId: "p-distante",
        providerName: "Marcos Encanador (Mais bem avaliado mas longe)",
        baseScore: 85,
        scheduleSlots: [], // Sem agendamento perto
      },
      {
        providerId: "p-carlos",
        providerName: "Carlos Eletricista (Já na Ilha dos Araújos)",
        baseScore: 70, // Base menor
        scheduleSlots: [existingSlotIlha], // Tem compromisso adjacente!
      },
    ]

    const ranked = rankProvidersWithBatching(candidates, newRequest)

    // Carlos deve ultrapassar Marcos por conta do bônus de rota (~ +25 pontos: 70 + 25 = 95 > 85)
    expect(ranked[0].providerId).toBe("p-carlos")
    expect(ranked[0].totalScore).toBeGreaterThan(ranked[1].totalScore)
    expect(ranked[0].batchOpportunity?.isBatchable).toBe(true)
  })
})
