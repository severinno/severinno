// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET, POST } from "../quotes/route"
import { GET as GET_DETAIL, PATCH } from "../quotes/[id]/route"
import { PATCH as PATCH_ITEM } from "../quotes/[id]/items/[itemId]/route"
import { createMockRequest } from "@/lib/__tests__/helpers/api-test-utils"

const { mockQuoteDetail, mockQuoteItem } = vi.hoisted(() => ({
  mockQuoteDetail: {
    id: "qt-1",
    clientId: "client-1",
    providerId: "prov-1",
    status: "PENDING",
    expiresAt: new Date(Date.now() + 7 * 86400000),
    createdAt: new Date(),
    notes: "Preciso de limpeza",
    items: [
      { id: "qi-1", quoteRequestId: "qt-1", providerId: "prov-1", serviceId: "svc-1", description: "Limpeza", quantity: 1, unit: "un", photos: [], status: "PENDING", providerNote: null, service: { id: "svc-1", title: "Limpeza" }, provider: { id: "prov-1", name: "Maria Souza", avatarUrl: null } },
    ],
    client: { id: "client-1", name: "João", avatarUrl: null },
    provider: { id: "prov-1", name: "Maria Souza", avatarUrl: null },
  },
  mockQuoteItem: {
    id: "qi-1",
    requestId: "qt-1",
    providerId: "prov-1",
    serviceId: "svc-1",
    description: "Limpeza",
    quantity: 1,
    price: null,
    status: "PENDING",
    providerNote: null,
    request: { id: "qt-1", status: "PENDING" },
  },
}))

const mockDb = vi.hoisted(() => ({
  quoteRequest: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), count: vi.fn(), update: vi.fn() },
  quoteItem: { findUnique: vi.fn(), update: vi.fn() },
  user: { findFirst: vi.fn() },
  service: { findMany: vi.fn() },
}))

vi.mock("@/lib/db", () => ({ default: mockDb, db: mockDb }))
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }))
vi.mock("@/lib/validators", () => ({ quoteSchema: { parse: vi.fn() }, quoteItemResponseSchema: { parse: vi.fn() } }))
vi.mock("@/lib/logger", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() } }))

import { requireUser } from "@/lib/auth"
import { quoteSchema, quoteItemResponseSchema } from "@/lib/validators"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireUser).mockResolvedValue({ userId: "client-1", role: "CLIENT" })
})

describe("GET /api/quotes (list)", () => {
  beforeEach(() => {
    mockDb.quoteRequest.findMany.mockResolvedValue([mockQuoteDetail])
    mockDb.quoteRequest.count.mockResolvedValue(1)
  })

  it("returns paginated quotes list", async () => {
    const response = await GET(createMockRequest())
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.items).toHaveLength(1)
    expect(data).toHaveProperty("total")
    expect(data).toHaveProperty("page")
    expect(data).toHaveProperty("limit")
  })

  it("filters by status", async () => {
    await GET(createMockRequest({ searchParams: { status: "PENDING" } }))
    expect(mockDb.quoteRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: "PENDING" }) }),
    )
  })
})

describe("POST /api/quotes (create)", () => {
  const validQuoteInput = {
    providerId: "prov-1",
    items: [
      { serviceId: "svc-1", description: "Limpeza", quantity: 1, unit: "un" },
      { serviceId: "svc-2", description: "Pintura", quantity: 1, unit: "m2" },
    ],
    notes: "Preciso de orçamento",
  }

  beforeEach(() => {
    (vi.mocked(quoteSchema.parse) as any).mockReturnValue(validQuoteInput)
    // Route uses user.findFirst, not findUnique
    mockDb.user.findFirst.mockResolvedValue({ id: "prov-1", verified: true })
    mockDb.service.findMany.mockResolvedValue([
      { id: "svc-1", providerId: "prov-1" },
      { id: "svc-2", providerId: "prov-1" },
    ])
    mockDb.quoteRequest.create.mockResolvedValue(mockQuoteDetail)
  })

  it("creates a quote request as CLIENT", async () => {
    const response = await POST(createMockRequest({ method: "POST", body: validQuoteInput }))
    expect(response.status).toBe(201)
    expect(mockDb.quoteRequest.create).toHaveBeenCalled()
  })

  it("throws 403 when user is not CLIENT", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "prov-1", role: "PROVIDER" })
    const response = await POST(createMockRequest({ method: "POST", body: validQuoteInput }))
    expect(response.status).toBe(403)
  })

  it("throws 404 when provider not found/inactive", async () => {
    mockDb.user.findFirst.mockResolvedValue(null)
    const response = await POST(createMockRequest({ method: "POST", body: validQuoteInput }))
    expect(response.status).toBe(404)
  })

  it("throws 400 when provider is not verified", async () => {
    mockDb.user.findFirst.mockResolvedValue({ id: "prov-1", verified: false })
    const response = await POST(createMockRequest({ method: "POST", body: validQuoteInput }))
    expect(response.status).toBe(400)
  })

  it("throws 400 when service does not belong to provider", async () => {
    mockDb.service.findMany.mockResolvedValue([
      { id: "svc-1", providerId: "prov-1" },
    ])
    const response = await POST(createMockRequest({ method: "POST", body: validQuoteInput }))
    expect(response.status).toBe(400)
  })
})

describe("GET /api/quotes/[id] (detail)", () => {
  beforeEach(() => {
    mockDb.quoteRequest.findUnique.mockResolvedValue(mockQuoteDetail)
  })

  it("returns quote detail with items", async () => {
    const response = await GET_DETAIL(createMockRequest(), { params: Promise.resolve({ id: "qt-1" }) })
    const data = await response.json()
    expect(response.status).toBe(200)
    // Route returns { quote } wrapper
    expect(data.quote.id).toBe("qt-1")
    expect(data.quote.items).toHaveLength(1)
  })

  it("returns 404 for non-existent quote", async () => {
    mockDb.quoteRequest.findUnique.mockResolvedValue(null)
    const response = await GET_DETAIL(createMockRequest(), { params: Promise.resolve({ id: "not-found" }) })
    expect(response.status).toBe(404)
  })

  it("allows client to view own quote", async () => {
    const response = await GET_DETAIL(createMockRequest(), { params: Promise.resolve({ id: "qt-1" }) })
    expect(response.status).toBe(200)
  })

  it("allows provider to view assigned quote", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "prov-1", role: "PROVIDER" })
    const response = await GET_DETAIL(createMockRequest(), { params: Promise.resolve({ id: "qt-1" }) })
    expect(response.status).toBe(200)
  })

  it("denies access to unrelated user", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "other-user", role: "CLIENT" })
    const response = await GET_DETAIL(createMockRequest(), { params: Promise.resolve({ id: "qt-1" }) })
    expect(response.status).toBe(403)
  })
})

describe("PATCH /api/quotes/[id] (update status)", () => {
  beforeEach(() => {
    mockDb.quoteRequest.findUnique.mockResolvedValue({ id: "qt-1", clientId: "client-1", status: "PENDING" })
    mockDb.quoteRequest.update.mockResolvedValue({ ...mockQuoteDetail, status: "APPROVED" })
  })

  it("allows client to approve quote", async () => {
    const response = await PATCH(createMockRequest({ method: "PATCH", body: { status: "APPROVED" } }), { params: Promise.resolve({ id: "qt-1" }) })
    expect(response.status).toBe(200)
  })

  it("allows client to reject quote", async () => {
    const response = await PATCH(createMockRequest({ method: "PATCH", body: { status: "REJECTED" } }), { params: Promise.resolve({ id: "qt-1" }) })
    expect(response.status).toBe(200)
  })

  it("rejects invalid status", async () => {
    const response = await PATCH(createMockRequest({ method: "PATCH", body: { status: "INVALID" } }), { params: Promise.resolve({ id: "qt-1" }) })
    expect(response.status).toBe(400)
  })

  it("denies status update by non-client/non-admin", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "prov-1", role: "PROVIDER" })
    const response = await PATCH(createMockRequest({ method: "PATCH", body: { status: "APPROVED" } }), { params: Promise.resolve({ id: "qt-1" }) })
    expect(response.status).toBe(403)
  })
})

describe("PATCH /api/quotes/[id]/items/[itemId] (provider response)", () => {
  const validResponse = { price: 15000, providerNote: "Posso fazer sim!", status: "RESPONDED" }

  beforeEach(() => {
    (vi.mocked(quoteItemResponseSchema.parse) as any).mockReturnValue(validResponse)
    mockDb.quoteItem.findUnique.mockResolvedValue(mockQuoteItem)
    mockDb.quoteItem.update.mockResolvedValue({ ...mockQuoteItem, ...validResponse })
    vi.mocked(requireUser).mockResolvedValue({ userId: "prov-1", role: "PROVIDER" })
  })

  it("allows provider to respond to a quote item", async () => {
    const response = await PATCH_ITEM(createMockRequest({ method: "PATCH", body: validResponse }), { params: Promise.resolve({ id: "qt-1", itemId: "qi-1" }) })
    expect(response.status).toBe(200)
    expect(mockDb.quoteItem.update).toHaveBeenCalled()
  })

  it("updates parent quote status to RESPONDED", async () => {
    await PATCH_ITEM(createMockRequest({ method: "PATCH", body: validResponse }), { params: Promise.resolve({ id: "qt-1", itemId: "qi-1" }) })
    expect(mockDb.quoteRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "RESPONDED" } }),
    )
  })

  it("returns 404 when item not found", async () => {
    mockDb.quoteItem.findUnique.mockResolvedValue(null)
    const response = await PATCH_ITEM(createMockRequest({ method: "PATCH", body: validResponse }), { params: Promise.resolve({ id: "qt-1", itemId: "not-found" }) })
    expect(response.status).toBe(404)
  })

  it("denies response by non-provider user", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "client-1", role: "CLIENT" })
    const response = await PATCH_ITEM(createMockRequest({ method: "PATCH", body: validResponse }), { params: Promise.resolve({ id: "qt-1", itemId: "qi-1" }) })
    expect(response.status).toBe(403)
  })
})
