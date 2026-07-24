import { describe, it, expect, vi } from "vitest"
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
} from "../api-server"

// Mock logger to avoid noisy output
vi.mock("../logger", () => ({
  default: { error: vi.fn() },
  logger: { error: vi.fn() },
}))

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
    const body = await res.json()
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
