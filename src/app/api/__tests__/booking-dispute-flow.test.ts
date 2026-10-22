import { describe, it, expect, vi, beforeEach } from "vitest"
import { POST } from "../bookings/[id]/dispute/route"

// Mock dependencies
const mockBookingFindUnique = vi.fn()
const mockDisputeCreate = vi.fn()
const mockBookingUpdate = vi.fn()
const mockTransaction = vi.fn()

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findUnique: (...args: any[]) => mockBookingFindUnique(...args),
      update: (...args: any[]) => mockBookingUpdate(...args),
    },
    dispute: {
      create: (...args: any[]) => mockDisputeCreate(...args),
    },
    $transaction: (ops: any[]) => mockTransaction(ops),
  },
}))

let mockUser: any = { userId: "client-1", role: "CLIENT" }

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => mockUser),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn(),
  RATE_LIMITS: { bookings: {} },
}))

vi.mock("@/lib/notifications", () => ({
  notifyBookingStatus: vi.fn().mockResolvedValue(undefined),
}))

function createRequest(body: any): Request {
  return new Request("http://localhost:3000/api/bookings/b-123/dispute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/bookings/[id]/dispute with Evidence Photos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUser = { userId: "client-1", role: "CLIENT" }
    mockTransaction.mockImplementation(async (_ops) => {
      // Return mocked array of results
      return [{ id: "disp-1", status: "OPEN" }, { id: "b-123" }]
    })
  })

  it("fails with 400 if reason has less than 10 characters", async () => {
    const req = createRequest({ reason: "Curto" })
    const res = await POST(req, { params: Promise.resolve({ id: "b-123" }) })
    expect(res.status).toBe(400)
  })

  it("fails with 403 if user is not the booking client or admin", async () => {
    mockBookingFindUnique.mockResolvedValue({
      id: "b-123",
      clientId: "other-client",
      providerId: "prov-1",
      disputes: [],
    })

    const req = createRequest({
      reason: "O prestador não compareceu no horário combinado.",
      category: "NOT_DELIVERED",
    })
    const res = await POST(req, { params: Promise.resolve({ id: "b-123" }) })
    expect(res.status).toBe(403)
  })

  it("fails with 400 if an open dispute already exists", async () => {
    mockBookingFindUnique.mockResolvedValue({
      id: "b-123",
      clientId: "client-1",
      providerId: "prov-1",
      disputes: [{ id: "existing-disp", status: "OPEN" }],
    })

    const req = createRequest({
      reason: "O prestador não compareceu no horário combinado.",
      category: "NOT_DELIVERED",
    })
    const res = await POST(req, { params: Promise.resolve({ id: "b-123" }) })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain("Já existe uma disputa aberta")
  })

  it("successfully creates dispute with category and evidencePhotos", async () => {
    mockBookingFindUnique.mockResolvedValue({
      id: "b-123",
      clientId: "client-1",
      providerId: "prov-1",
      afterPhotos: ["https://minio.severinno.com/photos/job-done.jpg"],
      disputes: [],
    })

    const req = createRequest({
      reason: "O serviço foi entregue com vazamento e cano quebrado.",
      category: "DAMAGED",
      evidencePhotos: [
        "https://minio.severinno.com/photos/leak-proof.jpg",
        "data:image/jpeg;base64,evidence2",
      ],
    })

    const res = await POST(req, { params: Promise.resolve({ id: "b-123" }) })
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.evidenceCount).toBe(2)
    expect(mockTransaction).toHaveBeenCalled()
  })
})
