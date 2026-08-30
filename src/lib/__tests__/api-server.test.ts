import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"
import {
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  handleError,
  parsePagination,
  publicUser,
  USER_PUBLIC_SELECT,
  cacheControlPublic,
  cacheControlPrivate,
  syncEntitySearch,
} from "../api-server"

// Mock logger to avoid noisy output
vi.mock("../logger", () => ({
  default: { error: vi.fn() },
  logger: { error: vi.fn() },
}))

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock("../db", () => ({ db: mockDb }))

describe("HttpError", () => {
  it("creates error with status and message", () => {
    const err = new HttpError(404, "Not found")
    expect(err.status).toBe(404)
    expect(err.message).toBe("Not found")
    expect(err).toBeInstanceOf(Error)
  })
})

describe("error helpers", () => {
  it("badRequest returns 400", () => {
    const err = badRequest()
    expect(err.status).toBe(400)
    expect(err.message).toBe("Requisição inválida")
  })

  it("badRequest accepts custom message", () => {
    const err = badRequest("Custom error")
    expect(err.message).toBe("Custom error")
  })

  it("unauthorized returns 401", () => {
    const err = unauthorized()
    expect(err.status).toBe(401)
  })

  it("forbidden returns 403", () => {
    const err = forbidden()
    expect(err.status).toBe(403)
  })

  it("notFound returns 404", () => {
    const err = notFound()
    expect(err.status).toBe(404)
  })

  it("conflict returns 409", () => {
    const err = conflict()
    expect(err.status).toBe(409)
  })
})

describe("handleError", () => {
  it("maps HttpError to response with correct status", async () => {
    const err = new HttpError(400, "Bad request")
    const res = handleError(err)
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe("Bad request")
  })

  it("maps UNAUTHORIZED message to 401", async () => {
    const res = handleError(new Error("UNAUTHORIZED"))
    const body = await res.json()
    expect(res.status).toBe(401)
    expect(body.error).toBe("Não autorizado")
  })

  it("maps FORBIDDEN message to 403", async () => {
    const res = handleError(new Error("FORBIDDEN"))
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.error).toBe("Acesso proibido")
  })

  it("returns 500 for unknown errors", async () => {
    const res = handleError(new Error("Something unexpected"))
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.error).toBe("Erro interno do servidor")
  })

  it("returns 500 for non-Error thrown values", async () => {
    const res = handleError("string error")
    const _body = await res.json()
    expect(res.status).toBe(500)
  })
})

describe("parsePagination", () => {
  it("returns defaults for empty params", () => {
    const params = new URLSearchParams()
    const result = parsePagination(params)
    expect(result.page).toBe(1)
    expect(result.limit).toBe(20)
    expect(result.skip).toBe(0)
    expect(result.take).toBe(20)
  })

  it("parses page and limit from params", () => {
    const params = new URLSearchParams({ page: "3", limit: "10" })
    const result = parsePagination(params)
    expect(result.page).toBe(3)
    expect(result.limit).toBe(10)
    expect(result.skip).toBe(20)
    expect(result.take).toBe(10)
  })

  it("clamps limit to max 50", () => {
    const params = new URLSearchParams({ limit: "100" })
    const result = parsePagination(params)
    expect(result.limit).toBe(50)
  })

  it("clamps page to min 1", () => {
    const params = new URLSearchParams({ page: "0" })
    const result = parsePagination(params)
    expect(result.page).toBe(1)
  })

  it("handles invalid page number", () => {
    const params = new URLSearchParams({ page: "abc" })
    const result = parsePagination(params)
    expect(result.page).toBe(1)
  })
})

describe("publicUser", () => {
  it("strips passwordHash from user object", () => {
    const user = {
      id: "1",
      email: "test@test.com",
      name: "Test",
      passwordHash: "secret",
      role: "CLIENT",
    }
    const result = publicUser(user)
    expect(result).not.toHaveProperty("passwordHash")
    expect(result.id).toBe("1")
    expect(result.email).toBe("test@test.com")
  })

  it("preserves all other fields", () => {
    const user = {
      id: "1",
      email: "test@test.com",
      name: "Test",
      passwordHash: "secret",
      verified: true,
      active: true,
    }
    const result = publicUser(user)
    expect(result).toHaveProperty("verified")
    expect(result).toHaveProperty("active")
    expect(Object.keys(result)).not.toContain("passwordHash")
  })
})

describe("USER_PUBLIC_SELECT", () => {
  it("contains expected fields for Prisma select", () => {
    expect(USER_PUBLIC_SELECT).toHaveProperty("id")
    expect(USER_PUBLIC_SELECT).toHaveProperty("email")
    expect(USER_PUBLIC_SELECT).toHaveProperty("name")
    expect(USER_PUBLIC_SELECT).toHaveProperty("role")
    expect(USER_PUBLIC_SELECT).not.toHaveProperty("passwordHash")
  })
})

// ---------------------------------------------------------------------------
// cacheControlPrivate
// ---------------------------------------------------------------------------
describe("cacheControlPrivate", () => {
  it("sets Cache-Control: private with max-age", () => {
    const res = new Response()
    const result = cacheControlPrivate(res as unknown as NextResponse, 60)
    expect(result.headers.get("Cache-Control")).toBe("private, max-age=60")
    expect(result).toBe(res)
  })

  it("sets Vary: Cookie, Accept-Encoding, Accept", () => {
    const res = new Response()
    const result = cacheControlPrivate(res as unknown as NextResponse, 60)
    expect(result.headers.get("Vary")).toBe("Cookie, Accept-Encoding, Accept")
  })

  it("does NOT include s-maxage in Cache-Control", () => {
    const res = new Response()
    const result = cacheControlPrivate(res as unknown as NextResponse, 120)
    const cc = result.headers.get("Cache-Control")
    expect(cc).toBe("private, max-age=120")
    expect(cc).not.toContain("s-maxage")
  })

  it("handles zero max-age", () => {
    const res = new Response()
    const result = cacheControlPrivate(res as unknown as NextResponse, 0)
    expect(result.headers.get("Cache-Control")).toBe("private, max-age=0")
  })
})

// ---------------------------------------------------------------------------
// cacheControlPublic
// ---------------------------------------------------------------------------
describe("cacheControlPublic", () => {
  it("sets Cache-Control header with max-age and s-maxage", () => {
    const res = new Response()
    const result = cacheControlPublic(res as unknown as NextResponse, 120, 600)
    expect(result.headers.get("Cache-Control")).toBe("public, max-age=120, s-maxage=600")
    expect(result).toBe(res) // returns same response object
  })

  it("defaults s-maxage to max-age when staleWhileRevalidate is omitted", () => {
    const res = new Response()
    const result = cacheControlPublic(res as unknown as NextResponse, 60)
    expect(result.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=60")
  })

  it("handles zero max-age", () => {
    const res = new Response()
    const result = cacheControlPublic(res as unknown as NextResponse, 0)
    expect(result.headers.get("Cache-Control")).toBe("public, max-age=0, s-maxage=0")
  })
})

// ---------------------------------------------------------------------------
// syncCategorySearch
// ---------------------------------------------------------------------------
describe("syncEntitySearch(category)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("inserts a category reindex job into search_reindex_queue", async () => {
    await syncEntitySearch("category", { id: "cat-123" })
    expect(mockDb.$queryRawUnsafe).toHaveBeenCalledTimes(1)
    const sql = mockDb.$queryRawUnsafe.mock.calls[0][0] as string
    expect(sql).toContain("INSERT INTO")
    expect(sql).toContain("search_reindex_queue")
    expect(mockDb.$queryRawUnsafe.mock.calls[0][1]).toBe("category")
    expect(mockDb.$queryRawUnsafe.mock.calls[0][2]).toBe("cat-123")
    expect(mockDb.$queryRawUnsafe.mock.calls[0][3]).toBe("upsert")
  })

  it("resolves to undefined on success", async () => {
    mockDb.$queryRawUnsafe.mockResolvedValue([])
    await expect(syncEntitySearch("category", { id: "cat-1" })).resolves.toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// syncServiceSearch
// ---------------------------------------------------------------------------
describe("syncEntitySearch(service)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("inserts a service reindex job into search_reindex_queue", async () => {
    await syncEntitySearch("service", { id: "svc-456" })
    expect(mockDb.$queryRawUnsafe).toHaveBeenCalledTimes(1)
    const sql = mockDb.$queryRawUnsafe.mock.calls[0][0] as string
    expect(sql).toContain("INSERT INTO")
    expect(sql).toContain("search_reindex_queue")
    expect(mockDb.$queryRawUnsafe.mock.calls[0][1]).toBe("service")
    expect(mockDb.$queryRawUnsafe.mock.calls[0][2]).toBe("svc-456")
    expect(mockDb.$queryRawUnsafe.mock.calls[0][3]).toBe("upsert")
  })

  it("resolves to undefined on success", async () => {
    mockDb.$queryRawUnsafe.mockResolvedValue([])
    await expect(syncEntitySearch("service", { id: "svc-1" })).resolves.toBeUndefined()
  })
})
