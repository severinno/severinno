/**
 * Tests for GET /api/admin/gateway/invoices — admin Lytex invoice listing.
 *
 * The route has a module-level `cachedToken` variable that persists between
 * tests. To avoid stale-cache issues, each test group uses its own describe
 * block with vi.resetModules() and dynamic import() per test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

let _mockRole: string | null = null

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockImplementation(async (role: string) => {
    if (_mockRole !== role) throw new Error("FORBIDDEN")
  }),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ── Helpers ────────────────────────────────────────────────────────────────

const INVOICES = {
  invoices: [
    { id: "inv-1", amount: 50000, status: "paid", createdAt: "2025-01-15" },
    { id: "inv-2", amount: 30000, status: "pending", createdAt: "2025-02-10" },
  ],
  total: 2,
  page: 1,
  perPage: 20,
}

const TOKEN_RESP = { accessToken: "test-token" }

/** Set env vars required by the route's getToken(). */
function setEnv() {
  process.env.LYTEX_CLIENT_ID = "test-client"
  process.env.LYTEX_CLIENT_SECRET = "test-secret"
}

function clearEnv() {
  delete process.env.LYTEX_CLIENT_ID
  delete process.env.LYTEX_CLIENT_SECRET
}

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  const fns = responses.map((r) =>
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { "content-type": "application/json" },
      }),
    ),
  )
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => fns.shift()!()),
  )
}

// ── Success ────────────────────────────────────────────────────────────────

describe("GET /api/admin/gateway/invoices — success", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    _mockRole = "ADMIN"
    setEnv()
    mockFetchSequence([
      { status: 200, body: TOKEN_RESP },
      { status: 200, body: INVOICES },
    ])
  })
  afterEach(clearEnv)

  it("returns invoices list from Lytex API", async () => {
    const { GET } = await import("../admin/gateway/invoices/route")
    const req = new Request("http://localhost/api/admin/gateway/invoices")
    const res = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.invoices).toHaveLength(2)
    expect(data.total).toBe(2)
    expect(data.page).toBe(1)
  })
})

// ── Search and pagination ──────────────────────────────────────────────────

describe("GET /api/admin/gateway/invoices — query params", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    _mockRole = "ADMIN"
    setEnv()
  })
  afterEach(clearEnv)

  it("passes search parameter to Lytex API", async () => {
    // Token fetch must succeed first (uses a resolved promise for auth)
    mockFetchSequence([
      { status: 200, body: TOKEN_RESP },
      { status: 200, body: INVOICES },
    ])

    const { GET } = await import("../admin/gateway/invoices/route")
    const req = new Request("http://localhost/api/admin/gateway/invoices?search=50000")
    await GET(req)

    // With fresh module + reset, there should be 2 fetch calls
    const calls = vi.mocked(fetch).mock.calls
    expect(calls.length).toBe(2)
    expect(String(calls[1][0])).toContain("search=50000")
  })

  it("passes page and perPage parameters", async () => {
    mockFetchSequence([
      { status: 200, body: TOKEN_RESP },
      { status: 200, body: { invoices: [], total: 0, page: 2, perPage: 10 } },
    ])

    const { GET } = await import("../admin/gateway/invoices/route")
    const req = new Request("http://localhost/api/admin/gateway/invoices?page=2&perPage=10")
    await GET(req)

    const calls = vi.mocked(fetch).mock.calls
    expect(String(calls[1][0])).toContain("page=2")
    expect(String(calls[1][0])).toContain("perPage=10")
  })
})

// ── Error handling ─────────────────────────────────────────────────────────

describe("GET /api/admin/gateway/invoices — errors", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    _mockRole = "ADMIN"
    setEnv()
  })
  afterEach(clearEnv)

  it("returns 500 with ok:false when Lytex API returns error", async () => {
    mockFetchSequence([
      { status: 200, body: TOKEN_RESP },
      { status: 500, body: { message: "Internal server error" } },
    ])

    const { GET } = await import("../admin/gateway/invoices/route")
    const req = new Request("http://localhost/api/admin/gateway/invoices")
    const res = await GET(req)

    expect(res.status).toBe(500)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toContain("Lytex API error")
  })
})

// ── Auth ───────────────────────────────────────────────────────────────────

describe("GET /api/admin/gateway/invoices — auth", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    setEnv()
  })
  afterEach(clearEnv)

  it("returns 403 when user is not admin", async () => {
    _mockRole = "PROVIDER"

    const { GET } = await import("../admin/gateway/invoices/route")
    const req = new Request("http://localhost/api/admin/gateway/invoices")
    const res = await GET(req)

    expect(res.status).toBe(403)
  })

  it("returns 401 when user is not authenticated", async () => {
    const { requireRole } = await import("@/lib/auth")
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const { GET } = await import("../admin/gateway/invoices/route")
    const req = new Request("http://localhost/api/admin/gateway/invoices")
    const res = await GET(req)

    expect(res.status).toBe(401)
  })
})
