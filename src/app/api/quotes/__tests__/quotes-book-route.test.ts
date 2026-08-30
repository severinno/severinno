import { describe, it, expect, vi, beforeEach } from "vitest"
import { POST } from "@/app/api/quotes/[id]/book/route"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"

vi.mock("@/lib/db", () => {
  const mockDb: Record<string, unknown> = {
    user: {
      findUnique: vi.fn(),
    },
    quoteRequest: {
      findUnique: vi.fn(),
    },
    booking: {
      create: vi.fn(),
    },
    quoteItem: {
      updateMany: vi.fn(),
    },
  }
  // $transaction: Prisma passes array of already-started promises (PrismaPromise[])
  mockDb.$transaction = vi.fn(async (arg: unknown) => {
    if (typeof arg === "function") {
      return await arg(mockDb)
    }
    // array-style: $transaction([promise1, promise2]) — each is a Promise
    const results: unknown[] = []
    for (const item of arg as unknown[]) {
      results.push(await Promise.resolve(item))
    }
    return results
  })
  return { db: mockDb }
})

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}))

vi.mock("@/lib/notification-queue", () => ({
  saveAndQueueNotification: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/realtime-client", () => ({
  emitRealtime: vi.fn().mockResolvedValue({}),
}))

describe("POST /api/quotes/[id]/book", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue({ userId: "c-1", role: "CLIENT" } as any)
  })

  it("books a service from an approved quote", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ id: "c-1", name: "Cliente Teste" } as any)
    vi.mocked(db.quoteRequest.findUnique).mockResolvedValue({
      id: "q-1",
      clientId: "c-1",
      providerId: "p-1",
      status: "APPROVED",
      address: "Rua A, 123",
      cep: "01001-000",
      lat: -23.55,
      lng: -46.63,
      items: [{ id: "qi-1", serviceId: "s-1", price: 250, status: "ACCEPTED" }],
      provider: { id: "p-1", name: "Prestador Teste", email: "p@test.com" },
    } as any)

    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 2)

    vi.mocked(db.booking.create).mockResolvedValue({
      id: "b-from-quote-1",
      amount: 250,
      status: "PENDING",
      scheduledAt: futureDate,
    } as any)

    const req = new Request("http://localhost:3000/api/quotes/q-1/book", {
      method: "POST",
      body: JSON.stringify({
        scheduledAt: futureDate.toISOString(),
      }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: "q-1" }) })
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.booking.id).toBe("b-from-quote-1")
    expect(db.booking.create).toHaveBeenCalled()
    expect(db.quoteItem.updateMany).toHaveBeenCalledWith({
      where: { requestId: "q-1", status: "QUOTED" },
      data: { status: "ACCEPTED" },
    })
  })

  it("rejects booking if quote is not approved", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({ id: "c-1", name: "Cliente Teste" } as any)
    vi.mocked(db.quoteRequest.findUnique).mockResolvedValue({
      id: "q-1",
      clientId: "c-1",
      providerId: "p-1",
      status: "PENDING",
      items: [],
    } as any)

    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 2)

    const req = new Request("http://localhost:3000/api/quotes/q-1/book", {
      method: "POST",
      body: JSON.stringify({ scheduledAt: futureDate.toISOString() }),
    })

    const res = await POST(req, { params: Promise.resolve({ id: "q-1" }) })
    expect(res.status).toBe(400)
  })
})
