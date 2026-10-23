import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  createEmergencyDispatch,
  claimEmergencyDispatch,
  broadcastEmergencyDispatchToWhatsApp,
  EmergencyRequest,
} from "../emergency-matchmaking"
import { db } from "@/lib/db"
import { sendText } from "@/lib/evolution"
import { getClient } from "@/lib/redis"

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/evolution", () => ({
  sendText: vi.fn(),
}))

vi.mock("@/lib/redis", () => ({
  getClient: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

describe("emergency-matchmaking & smart dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockRequest: EmergencyRequest = {
    id: "emg-req-1",
    clientId: "client-1",
    clientName: "Ana Paula",
    lat: -18.8545,
    lng: -41.956,
    category: "Encanador / Vazamento",
    description: "Cano estourou na cozinha, água vazando sem parar",
    severity: "EMERGENCY",
    maxRadiusKm: 8,
  }

  const mockProviders = [
    {
      id: "prov-1",
      name: "João Encanador",
      lat: -18.856,
      lng: -41.957,
      rating: 4.9,
      activeBookings: 0,
    },
    {
      id: "prov-2",
      name: "Pedro Reparos",
      lat: -18.86,
      lng: -41.96,
      rating: 4.7,
      activeBookings: 1,
    },
  ]

  it("calcula ranking de candidatos e taxa de urgência no despacho emergencial", async () => {
    const result = await createEmergencyDispatch(mockRequest, mockProviders)

    expect(result.requestId).toBe("emg-req-1")
    expect(result.broadcastCount).toBeGreaterThanOrEqual(1)
    expect(result.surgeRate).toBeGreaterThan(1.0)
    expect(result.estimatedBaseFee).toBeGreaterThanOrEqual(80)
    expect(result.candidates[0].matchScore).toBeGreaterThan(0)
  })

  describe("claimEmergencyDispatch", () => {
    it("permite que o primeiro prestador garanta a chamada de emergência", async () => {
      vi.mocked(getClient).mockReturnValue(null) // Testa fallback em memória

      const claim1 = await claimEmergencyDispatch({
        requestId: "emg-atomic-test",
        providerId: "prov-fast",
      })

      expect(claim1.success).toBe(true)
      expect(claim1.providerId).toBe("prov-fast")
      expect(claim1.claimedAt).toBeDefined()
    })

    it("rejeita com ALREADY_CLAIMED quando um segundo prestador tenta aceitar", async () => {
      vi.mocked(getClient).mockReturnValue(null)

      // Primeiro aceitou
      await claimEmergencyDispatch({
        requestId: "emg-race-test",
        providerId: "prov-winner",
      })

      // Segundo tenta aceitar a mesma chamada
      const claim2 = await claimEmergencyDispatch({
        requestId: "emg-race-test",
        providerId: "prov-loser",
      })

      expect(claim2.success).toBe(false)
      expect(claim2.reason).toBe("ALREADY_CLAIMED")
      expect(claim2.message).toContain("já foi aceita")
    })
  })

  describe("broadcastEmergencyDispatchToWhatsApp", () => {
    it("envia alerta WhatsApp com link de 1-clique para os candidatos com telefone", async () => {
      vi.mocked(db.user.findMany).mockResolvedValue([
        {
          id: mockProviders[0].id,
          whatsapp: "33999998888",
          phone: null,
        },
      ] as any)
      vi.mocked(sendText).mockResolvedValue({ key: { id: "msg-1" } } as any)

      const dispatchResult = await createEmergencyDispatch(mockRequest, [mockProviders[0]])
      const { sentCount } = await broadcastEmergencyDispatchToWhatsApp(dispatchResult, mockRequest)

      expect(sentCount).toBe(1)
      expect(sendText).toHaveBeenCalledWith(
        "5533999998888",
        expect.stringContaining("NOVA CHAMADA DE EMERGÊNCIA"),
      )
      expect(sendText).toHaveBeenCalledWith(
        "5533999998888",
        expect.stringContaining("/api/bookings/emergency-dispatch/claim"),
      )
    })
  })
})
