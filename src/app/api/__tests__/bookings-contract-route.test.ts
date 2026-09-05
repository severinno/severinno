import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: new Proxy({}, { get: () => ({ prefix: "test", max: 1000, windowMs: 60_000 }) }),
}))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: "u1", role: "CLIENT" }),
}))

vi.mock("@/lib/db", () => ({ db: {} }))

const mockGenerateServiceContract = vi.hoisted(() => vi.fn())

vi.mock("@/lib/contract-generator", () => ({
  generateServiceContract: mockGenerateServiceContract,
}))

import { POST, GET } from "../bookings/contract/route"
import { requireUser } from "@/lib/auth"
import { HttpError } from "@/lib/api-server"

const VALID_BODY = {
  bookingId: "b1",
  client: { name: "João", document: "123.456.789-00", email: "joao@test.com" },
  provider: { name: "Maria", document: "987.654.321-00", email: "maria@test.com" },
  serviceTitle: "Reparo hidráulico",
  totalAmount: 150,
  paymentMethod: "pix",
  scheduledDate: "2026-01-15",
  locationAddress: "Rua Teste, 123",
}

function postReq(body: unknown) {
  return createMockRequest({ method: "POST", body }) as any
}

function getReq(searchParams?: Record<string, string>) {
  return createMockRequest({ method: "GET", searchParams }) as any
}

describe("POST /api/bookings/contract", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 400 for invalid body", async () => {
    const res = await POST(postReq({ bookingId: "b1" }))
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(400)
  })

  it("generates contract on valid body", async () => {
    mockGenerateServiceContract.mockReturnValue({ contractId: "c1", html: "<html>" })
    const res = await POST(postReq(VALID_BODY))
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(200)
    expect((parsed.body as any).success).toBe(true)
    expect((parsed.body as any).data.contractId).toBe("c1")
  })

  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireUser).mockRejectedValueOnce(new HttpError(401, "Não autorizado"))
    const res = await POST(postReq(VALID_BODY))
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(401)
  })
})

describe("GET /api/bookings/contract", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 400 when id param missing", async () => {
    const res = await GET(getReq())
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(400)
  })
})
