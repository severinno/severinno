import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET as getDisputes } from "@/app/api/admin/disputes/route"
import { POST as resolveDispute } from "@/app/api/admin/disputes/[id]/resolve/route"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
  requireUser: vi.fn(),
}))

vi.mock("@/lib/whatsapp-queue", () => ({
  enqueueWhatsApp: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/db", () => {
  const mockTx = {
    dispute: {
      update: vi.fn().mockResolvedValue({ id: "disp-1", status: "RESOLVED" }),
    },
    booking: {
      update: vi.fn().mockResolvedValue({ id: "book-1" }),
    },
    notification: {
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
  }

  return {
    db: {
      dispute: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation(async (cb) => {
        if (typeof cb === "function") {
          return cb(mockTx)
        }
        return Promise.all(cb)
      }),
      __mockTx: mockTx,
    },
  }
})

describe("Admin Disputes Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireRole).mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any)
  })

  describe("GET /api/admin/disputes", () => {
    it("lista disputas em aberto e computa métricas corretamente", async () => {
      vi.mocked(db.dispute.count)
        .mockResolvedValueOnce(5) // total
        .mockResolvedValueOnce(2) // open

      vi.mocked(db.dispute.findMany).mockResolvedValue([
        {
          id: "disp-1",
          bookingId: "book-1",
          reason: "Serviço incompleto",
          status: "OPEN",
          resolution: null,
          createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 dia atrás
          resolvedAt: null,
          booking: {
            id: "book-1",
            amount: 250.0,
            status: "IN_PROGRESS",
            paymentStatus: "HELD",
            scheduledAt: new Date(),
            createdAt: new Date(),
            beforePhotos: [],
            afterPhotos: [],
            completionNote: null,
            escrowDisputeReason: "Serviço incompleto",
            escrowReleasedAt: null,
            client: {
              id: "c-1",
              name: "Cliente Teste",
              email: "c@test.com",
              whatsapp: "5511999999999",
            },
            provider: {
              id: "p-1",
              name: "Prestador Teste",
              email: "p@test.com",
              whatsapp: "5511888888888",
            },
            service: { id: "s-1", title: "Reparo Hidráulico" },
          },
        } as any,
      ])

      const req = new Request("http://localhost:3000/api/admin/disputes?status=OPEN", {
        method: "GET",
      })
      const res = await getDisputes(req)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.items).toHaveLength(1)
      expect(json.items[0].id).toBe("disp-1")
      expect(json.items[0].booking.amount).toBe(250)
      expect(json.meta.open).toBe(2)
      expect(json.meta.total).toBe(5)
      expect(json.meta.totalAmountInDispute).toBe(250)
    })
  })

  describe("POST /api/admin/disputes/[id]/resolve", () => {
    const mockOpenDispute = {
      id: "disp-1",
      bookingId: "book-1",
      reason: "Trabalho não concluído",
      status: "OPEN",
      booking: {
        id: "book-1",
        clientId: "c-1",
        providerId: "p-1",
        amount: 300.0,
        client: { id: "c-1", name: "Cliente", phone: "11999999999", whatsapp: "11999999999" },
        provider: { id: "p-1", name: "Prestador", phone: "11888888888", whatsapp: "11888888888" },
        service: { title: "Pintura" },
      },
    }

    it("aplica estorno integral (FULL_REFUND) com cancelamento e estorno de custódia", async () => {
      vi.mocked(db.dispute.findUnique).mockResolvedValue(mockOpenDispute as any)

      const req = new Request("http://localhost:3000/api/admin/disputes/disp-1/resolve", {
        method: "POST",
        body: JSON.stringify({
          decision: "FULL_REFUND",
          resolutionNotes: "Estorno integral deferido por ausência do prestador.",
        }),
      })

      const res = await resolveDispute(req, { params: Promise.resolve({ id: "disp-1" }) })
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.decision).toBe("FULL_REFUND")
      expect(json.clientRefund).toBe(300)
      expect(json.providerPayout).toBe(0)

      const { __mockTx } = db as any
      expect(__mockTx.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "book-1" },
          data: { paymentStatus: "REFUNDED", status: "CANCELLED" },
        }),
      )
    })

    it("aplica liberação integral ao prestador (RELEASE_TO_PROVIDER)", async () => {
      vi.mocked(db.dispute.findUnique).mockResolvedValue(mockOpenDispute as any)

      const req = new Request("http://localhost:3000/api/admin/disputes/disp-1/resolve", {
        method: "POST",
        body: JSON.stringify({
          decision: "RELEASE_TO_PROVIDER",
          resolutionNotes: "Serviço verificado conforme fotos anexadas.",
        }),
      })

      const res = await resolveDispute(req, { params: Promise.resolve({ id: "disp-1" }) })
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.decision).toBe("RELEASE_TO_PROVIDER")
      expect(json.clientRefund).toBe(0)
      expect(json.providerPayout).toBe(300)

      const { __mockTx } = db as any
      expect(__mockTx.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "book-1" },
          data: expect.objectContaining({ paymentStatus: "PAID" }),
        }),
      )
    })

    it("aplica divisão de custódia proporcional (SPLIT)", async () => {
      vi.mocked(db.dispute.findUnique).mockResolvedValue(mockOpenDispute as any)

      const req = new Request("http://localhost:3000/api/admin/disputes/disp-1/resolve", {
        method: "POST",
        body: JSON.stringify({
          decision: "SPLIT",
          refundPercentage: 40,
          resolutionNotes: "Acordo parcial com desconto de 40% para o cliente.",
        }),
      })

      const res = await resolveDispute(req, { params: Promise.resolve({ id: "disp-1" }) })
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.decision).toBe("SPLIT")
      expect(json.clientRefund).toBe(120) // 40% de 300
      expect(json.providerPayout).toBe(180) // 60% de 300
    })

    it("rejeita resolver uma disputa já previamente resolvida (fail-closed)", async () => {
      vi.mocked(db.dispute.findUnique).mockResolvedValue({
        ...mockOpenDispute,
        status: "RESOLVED",
      } as any)

      const req = new Request("http://localhost:3000/api/admin/disputes/disp-1/resolve", {
        method: "POST",
        body: JSON.stringify({
          decision: "FULL_REFUND",
          resolutionNotes: "Tentativa de re-resolução",
        }),
      })

      const res = await resolveDispute(req, { params: Promise.resolve({ id: "disp-1" }) })
      expect(res.status).toBe(400)
    })
  })
})
