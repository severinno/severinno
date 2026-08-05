import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET, POST } from "../availability/route"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// Use vi.hoisted to avoid hoisting issues with vi.mock()
const { mockDb } = vi.hoisted(() => {
  const _mockDb = {
    providerAvailability: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  }
  return { mockDb: _mockDb }
})

// Mock auth
const mockSession = { userId: "prov-1", role: "PROVIDER" as const }

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  default: mockDb,
  db: mockDb,
}))

vi.mock("@/lib/validators", () => ({
  availabilitySchema: {
    parse: vi.fn((it: unknown) => it),
  },
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { requireUser } from "@/lib/auth"

const mockAvailability = [
  {
    id: "av-1",
    providerId: "prov-1",
    dayOfWeek: 1,
    startTime: "08:00",
    endTime: "12:00",
    active: true,
  },
  {
    id: "av-2",
    providerId: "prov-1",
    dayOfWeek: 1,
    startTime: "13:00",
    endTime: "18:00",
    active: true,
  },
  {
    id: "av-3",
    providerId: "prov-1",
    dayOfWeek: 3,
    startTime: "08:00",
    endTime: "12:00",
    active: true,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireUser).mockResolvedValue(mockSession)
  mockDb.providerAvailability.findMany.mockResolvedValue(mockAvailability)
})

describe("GET /api/availability", () => {
  it("returns provider's availability", async () => {
    const response = await GET()
    const parsed = await parseResponse(response)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toHaveProperty("items")
    expect(parsed.body!.items).toHaveLength(3)
  })

  it("throws 403 for non-provider roles", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "client-1", role: "CLIENT" })

    const response = await GET()
    const parsed = await parseResponse(response)

    expect(parsed.status).toBe(403)
  })

  it("allows ADMIN to view any provider's availability", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "admin-1", role: "ADMIN" })

    const response = await GET()
    const parsed = await parseResponse(response)

    expect(parsed.status).toBe(200)
  })

  it("orders results by dayOfWeek and startTime", async () => {
    const response = await GET()
    await parseResponse(response)

    expect(mockDb.providerAvailability.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
      }),
    )
  })
})

describe("POST /api/availability", () => {
  const validItems = [
    { dayOfWeek: 1, startTime: "08:00", endTime: "12:00", active: true },
    { dayOfWeek: 2, startTime: "09:00", endTime: "18:00", active: true },
  ]

  it("upserts availability for the provider", async () => {
    mockDb.$transaction.mockResolvedValue([])
    mockDb.providerAvailability.findMany.mockResolvedValue([
      {
        id: "new-1",
        providerId: "prov-1",
        dayOfWeek: 1,
        startTime: "08:00",
        endTime: "12:00",
        active: true,
      },
    ])

    const req = createMockRequest({ method: "POST", body: { items: validItems } })
    const response = await POST(req)
    const parsed = await parseResponse(response)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toHaveProperty("items")
    expect(mockDb.$transaction).toHaveBeenCalled()
  })

  it("clears all availability when items array is empty", async () => {
    mockDb.providerAvailability.findMany.mockResolvedValue([])

    const req = createMockRequest({ method: "POST", body: { items: [] } })
    const response = await POST(req)
    const parsed = await parseResponse(response)

    expect(parsed.status).toBe(200)
    expect(mockDb.providerAvailability.deleteMany).toHaveBeenCalledWith({
      where: { providerId: "prov-1" },
    })
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it("throws 403 for non-provider roles", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "client-1", role: "CLIENT" })

    const req = createMockRequest({ method: "POST", body: { items: validItems } })
    const response = await POST(req)
    const parsed = await parseResponse(response)

    expect(parsed.status).toBe(403)
  })

  it("allows ADMIN to update availability", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "admin-1", role: "ADMIN" })
    mockDb.$transaction.mockResolvedValue([])
    mockDb.providerAvailability.findMany.mockResolvedValue([])

    const req = createMockRequest({ method: "POST", body: { items: validItems } })
    const response = await POST(req)
    const parsed = await parseResponse(response)

    expect(parsed.status).toBe(200)
  })

  it("returns 400 when startTime >= endTime", async () => {
    const req = createMockRequest({
      method: "POST",
      body: { items: [{ dayOfWeek: 1, startTime: "14:00", endTime: "12:00", active: true }] },
    })
    const response = await POST(req)
    const parsed = await parseResponse(response)

    expect(parsed.status).toBe(400)
    expect(parsed.body).toHaveProperty("error")
  })

  it("handles body with no items field gracefully", async () => {
    mockDb.providerAvailability.findMany.mockResolvedValue([])

    const req = createMockRequest({ method: "POST", body: {} })
    const response = await POST(req)
    const parsed = await parseResponse(response)

    expect(parsed.status).toBe(200)
    expect(mockDb.providerAvailability.deleteMany).toHaveBeenCalled()
  })
})
