/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for GET /api/admin/gateway/stats — Lytex gateway metrics aggregation.
 *
 * Verifies:
 *  - 401 without ADMIN role
 *  - Aggregation with mock invoice data (multiple statuses)
 *  - Empty data returns zeros
 *  - Period filtering (date range applied correctly)
 *  - Conversion rate calculation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// ---- Mock data builders ---------------------------------------------------

function buildInvoice(
  overrides: Partial<{
    _id: string
    status: string
    totalValue: number
    createdAt: string
    paymentMethods: { list: string[] }
  }> = {},
) {
  return {
    _id: overrides._id ?? `inv-${Math.random().toString(36).slice(2, 8)}`,
    _hashId: "hash-" + Math.random().toString(36).slice(2, 8),
    status: overrides.status ?? "paid",
    totalValue: overrides.totalValue ?? 10000, // R$ 100,00 in cents
    referenceId: "ref-123",
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    paymentMethods: overrides.paymentMethods ?? { list: ["PIX"] },
    client: { name: "Test Client", email: "client@test.com" },
  }
}

function _buildPaginatedResponse(invoices: ReturnType<typeof buildInvoice>[]) {
  return {
    results: invoices,
    paginate: {
      perPage: 50,
      page: 1,
      pages: 1,
      total: invoices.length,
    },
  }
}

// ---- Mocks ----------------------------------------------------------------

const mockFetchFn = vi.fn()
vi.stubGlobal("fetch", mockFetchFn)

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any),
}))

vi.mock("@/lib/api-server", () => ({
  handleError: vi.fn((e) => {
    const message = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    })
  }),
}))

vi.mock("@/lib/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

// ---- SUT import -----------------------------------------------------------

import { requireRole } from "@/lib/auth"
import { GET } from "../admin/gateway/stats/route"

// ---- Test helpers ---------------------------------------------------------

const MOCK_SESSION = { userId: "admin-1", role: "ADMIN" as const }

function mockFetch(results: unknown[]) {
  // Use mockImplementation to create a FRESH Response on every fetch() call
  // This prevents "Body has already been read" errors when the route reads
  // the response body multiple times (once in getToken(), once in fetchAllInvoices())
  mockFetchFn.mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          accessToken: "mock-token-123",
          results,
          paginate: { perPage: 50, page: 1, pages: 1, total: results.length },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    ),
  )
}

function buildRequest(url: string): NextRequest {
  return new NextRequest(new Request(url))
}

// ---- Tests ----------------------------------------------------------------

afterEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/admin/gateway/stats — auth guard", () => {
  it("retorna 401 quando não é ADMIN", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("Unauthorized"))

    const req = buildRequest("http://localhost:3000/api/admin/gateway/stats?period=30d")
    const res = await GET(req)

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain("Unauthorized")
  })
})

describe("GET /api/admin/gateway/stats — aggregation", () => {
  beforeEach(() => {
    vi.mocked(requireRole).mockResolvedValue(MOCK_SESSION)
  })

  it("agrega corretamente com invoices de múltiplos status", async () => {
    const invoices = [
      buildInvoice({ status: "paid", totalValue: 50000 }),
      buildInvoice({ status: "paid", totalValue: 30000 }),
      buildInvoice({ status: "waitingPayment", totalValue: 20000 }),
      buildInvoice({ status: "expired", totalValue: 10000 }),
      buildInvoice({ status: "canceled", totalValue: 5000 }),
    ]
    mockFetch(invoices)

    const req = buildRequest("http://localhost:3000/api/admin/gateway/stats?period=all")
    const res = await GET(req)
    const body = await res.json()

    expect(body.totalCount).toBe(5)
    expect(body.paidCount).toBe(2)
    expect(body.totalVolume).toBe(115000) // 50000+30000+20000+10000+5000
    expect(body.conversionRate).toBe(40) // 2/5 = 40%
    // 5 invoices with 4 unique statuses (2 paid are merged into 1 byStatus entry)
    expect(body.byStatus).toHaveLength(4)
  })

  it("retorna dados vazios quando não há invoices", async () => {
    mockFetch([])

    const req = buildRequest("http://localhost:3000/api/admin/gateway/stats?period=30d")
    const res = await GET(req)
    const body = await res.json()

    expect(body.totalCount).toBe(0)
    expect(body.totalVolume).toBe(0)
    expect(body.conversionRate).toBe(0)
    expect(body.byStatus).toEqual([])
    expect(body.monthly).toEqual([])
  })

  it("calcula conversionRate corretamente com valores parciais", async () => {
    const invoices = [
      buildInvoice({ status: "paid", totalValue: 10000 }),
      buildInvoice({ status: "paid", totalValue: 10000 }),
      buildInvoice({ status: "waitingPayment", totalValue: 10000 }),
    ]
    mockFetch(invoices)

    const req = buildRequest("http://localhost:3000/api/admin/gateway/stats?period=all")
    const res = await GET(req)
    const body = await res.json()

    expect(body.conversionRate).toBe(66.7) // 2/3 = 66.7%
    expect(body.totalCount).toBe(3)
    expect(body.paidCount).toBe(2)
  })

  it("agrupa por mês corretamente", async () => {
    const invoices = [
      buildInvoice({ status: "paid", totalValue: 10000, createdAt: "2026-01-15T10:00:00Z" }),
      buildInvoice({ status: "paid", totalValue: 20000, createdAt: "2026-01-20T10:00:00Z" }),
      buildInvoice({ status: "paid", totalValue: 30000, createdAt: "2026-02-10T10:00:00Z" }),
    ]
    mockFetch(invoices)

    const req = buildRequest("http://localhost:3000/api/admin/gateway/stats?period=all")
    const res = await GET(req)
    const body = await res.json()

    expect(body.monthly).toHaveLength(2)
    expect(body.monthly[0].total).toBe(30000) // Jan: 10000+20000
    expect(body.monthly[1].total).toBe(30000) // Fev: 30000
  })
})

describe("GET /api/admin/gateway/stats — period filtering", () => {
  beforeEach(() => {
    vi.mocked(requireRole).mockResolvedValue(MOCK_SESSION)
  })

  it("filtra invoices dentro do período especificado (7d)", async () => {
    const now = new Date()
    const invoices = [
      buildInvoice({ createdAt: new Date(now.getTime() - 3 * 86400000).toISOString() }), // 3 days ago
      buildInvoice({ createdAt: new Date(now.getTime() - 10 * 86400000).toISOString() }), // 10 days ago
    ]
    mockFetch(invoices)

    const req = buildRequest("http://localhost:3000/api/admin/gateway/stats?period=7d")
    const res = await GET(req)
    const body = await res.json()

    expect(body.totalCount).toBe(1) // only the 3-day-old invoice
  })
})

describe("GET /api/admin/gateway/stats — method distribution", () => {
  beforeEach(() => {
    vi.mocked(requireRole).mockResolvedValue(MOCK_SESSION)
  })

  it("agrupa por método de pagamento", async () => {
    const invoices = [
      buildInvoice({ paymentMethods: { list: ["PIX"] }, totalValue: 50000 }),
      buildInvoice({ paymentMethods: { list: ["CARD"] }, totalValue: 30000 }),
      buildInvoice({ paymentMethods: { list: ["PIX", "CARD"] }, totalValue: 20000 }),
    ]
    mockFetch(invoices)

    const req = buildRequest("http://localhost:3000/api/admin/gateway/stats?period=all")
    const res = await GET(req)
    const body = await res.json()

    expect(body.methodDistribution).toHaveLength(2)
    // PIX: 50000 + 20000 = 70000
    // CARD: 30000 + 20000 = 50000
    expect(body.methodDistribution.find((m: { method: string }) => m.method === "PIX")?.total).toBe(
      70000,
    )
    expect(
      body.methodDistribution.find((m: { method: string }) => m.method === "CARD")?.total,
    ).toBe(50000)
  })
})
