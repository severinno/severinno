import { describe, it, expect } from "vitest"
import { evaluateBestSlotFit } from "@/lib/smart-slot-fit"
import type { RouteStop } from "@/lib/tsp-route-optimizer"

describe("Smart Slot Fit & Detour Optimization", () => {
  const baseLocation = { lat: -23.5505, lng: -46.6333 } // Centro de SP

  const existingStops: RouteStop[] = [
    {
      id: "stop-1",
      title: "Conserto Hidráulico",
      address: "Av. Paulista, 1000",
      lat: -23.5615,
      lng: -46.6559,
    },
    {
      id: "stop-2",
      title: "Instalação Elétrica",
      address: "R. Augusta, 500",
      lat: -23.5535,
      lng: -46.6521,
    },
  ]

  it("avalia o melhor slot de inserção com menor desvio geográfico", () => {
    // Candidato muito próximo à Parada 2 (R. Augusta)
    const candidate = {
      title: "Troca de Tomadas",
      address: "R. Frei Caneca, 600",
      lat: -23.554,
      lng: -46.653,
      durationMinutes: 45,
    }

    const result = evaluateBestSlotFit(baseLocation, existingStops, candidate)

    expect(result.bestSlot).toBeDefined()
    expect(result.bestSlot.addedDetourKm).toBeGreaterThan(0)
    expect(result.allEvaluations.length).toBe(3) // 3 posições possíveis (início, meio, fim)
    expect(result.optimizedRoute).toBeDefined()
    expect(result.optimizedRoute.orderedStops.length).toBe(3)
  })

  it("insere no início de forma perfeita quando a lista de agendamentos está vazia", () => {
    const candidate = {
      title: "Primeiro Serviço",
      lat: -23.56,
      lng: -46.65,
    }

    const result = evaluateBestSlotFit(baseLocation, [], candidate)

    expect(result.bestSlot.slotIndex).toBe(0)
    expect(result.bestSlot.fitQuality).toBe("PERFECT")
    expect(result.optimizedRoute.orderedStops.length).toBe(1)
  })
})
