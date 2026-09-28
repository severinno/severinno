import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"
import { ZodError } from "zod"
import {
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  handleError,
  noStoreJson,
  parsePagination,
  toPublicProvider,
  PUBLIC_PROVIDER_SELECT,
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

  // ── House rule: error responses are NEVER cacheable ──────────────────

  it.each([
    ["HttpError 400", handleError(new HttpError(400, "Bad request")), 400],
    ["HttpError 404", handleError(notFound()), 404],
    ["ZodError", handleError(new ZodError([])), 400],
    ["UNAUTHORIZED", handleError(new Error("UNAUTHORIZED")), 401],
    ["FORBIDDEN", handleError(new Error("FORBIDDEN")), 403],
    ["unknown 500", handleError(new Error("boom")), 500],
  ])("%s carries Cache-Control: no-store", (_name, res: Response, _status) => {
    expect(res.headers.get("Cache-Control")).toBe("no-store")
  })

  it("preserves custom HttpError headers alongside no-store", () => {
    const res = handleError(new HttpError(429, "Rate limited", { "Retry-After": "10" }))
    expect(res.headers.get("Cache-Control")).toBe("no-store")
    expect(res.headers.get("Retry-After")).toBe("10")
  })

  it("noStoreJson sets no-store and default status 500", () => {
    const res = noStoreJson({ error: "x" })
    expect(res.status).toBe(500)
    expect(res.headers.get("Cache-Control")).toBe("no-store")
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

// `publicUser()` ("a linha menos o passwordHash") foi REMOVIDO em 09/2026:
// serializar por subtração encaminhava toda coluna nova do modelo — inclusive
// cpfCnpj, e-mail e o segredo do 2FA — em respostas cross-user. O contrato agora
// é allowlist: PUBLIC_PROVIDER_SELECT / toPublicProvider / toSessionUser.
describe("toPublicProvider (allowlist de terceiros)", () => {
  it("descarta qualquer coluna fora da allowlist", () => {
    const row = {
      id: "1",
      name: "Test",
      whatsapp: "+5533999999999",
      // colunas que um `include` (linha inteira) traria junto:
      passwordHash: "secret",
      cpfCnpj: "123.456.789-00",
      email: "test@test.com",
      twoFactorSecret: "JBSWY3DPEHPK3PXP",
      identityDocUrl: "https://cdn/rg.jpg",
      sessionVersion: 3,
    }
    const result = toPublicProvider(row)

    expect(result).toEqual({ id: "1", name: "Test", whatsapp: "+5533999999999" })
  })

  it("omite campos ausentes em vez de escrever undefined", () => {
    const result = toPublicProvider({ id: "1" })
    expect(result).toEqual({ id: "1" })
    expect(Object.keys(result)).toHaveLength(1)
  })
})

describe("PUBLIC_PROVIDER_SELECT", () => {
  it("não pede credencial, dado fiscal nem documento de KYC ao banco", () => {
    for (const field of [
      "passwordHash",
      "twoFactorSecret",
      "twoFactorBackupCodes",
      "cpfCnpj",
      "email",
      "identityDocUrl",
      "identitySelfieUrl",
      "lytexRecipientId",
      "sessionVersion",
      "servicePolygon",
      "travelFeePolicy",
      "deletedAt",
    ]) {
      expect(PUBLIC_PROVIDER_SELECT, `campo sensível: ${field}`).not.toHaveProperty(field)
    }
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
