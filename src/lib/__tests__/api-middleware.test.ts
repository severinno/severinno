/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * api-middleware.test.ts
 *
 * Tests for the API middleware helpers:
 *   - apiRoute — wraps try/catch + handleError
 *   - parseBody — parse JSON body + Zod validation
 *   - parseSearchParams — validate URLSearchParams with Zod
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"
import { z } from "zod"
import { apiRoute, parseBody, parseSearchParams } from "@/lib/api-middleware"

// ---------------------------------------------------------------------------
// Mock handleError — we only test that apiRoute *calls* it correctly, not its
// internal response shape (handleError is tested separately).
// ---------------------------------------------------------------------------

vi.mock("@/lib/api-server", () => ({
  handleError: vi.fn((e: unknown) => {
    // Reproduce the real handleError's response shape so tests can assert
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Dados inválidos", details: (e as import("zod").ZodError).issues },
        { status: 400 },
      )
    }
    if (e instanceof Error) {
      if (e.message === "UNAUTHORIZED") {
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
      }
      if (e.message === "FORBIDDEN") {
        return NextResponse.json({ error: "Acesso proibido" }, { status: 403 })
      }
    }
    return NextResponse.json({ error: "Erro interno" }, { status: 500 })
  }),
}))

// ---------------------------------------------------------------------------
// Test schemas
// ---------------------------------------------------------------------------

const testSchema = z.object({
  name: z.string().min(2, "Nome muito curto"),
  age: z.coerce.number().int().min(0),
})

type TestInput = z.infer<typeof testSchema>

const searchSchema = z.object({
  q: z.string().min(1, "Query obrigatória"),
  limit: z.coerce.number().int().min(1).max(10).default(5),
  page: z.coerce.number().int().min(1).default(1),
})

// ---------------------------------------------------------------------------
// apiRoute
// ---------------------------------------------------------------------------

describe("apiRoute", () => {
  it("returns the response from a successful handler", async () => {
    const result = await apiRoute(async () => {
      return NextResponse.json({ ok: true })
    })

    const body = await result.json()
    expect(result.status).toBe(200)
    expect(body).toEqual({ ok: true })
  })

  it("returns handler's custom status code", async () => {
    const result = await apiRoute(async () => {
      return NextResponse.json({ created: true }, { status: 201 })
    })

    expect(result.status).toBe(201)
    const body = await result.json()
    expect(body).toEqual({ created: true })
  })

  it("catches generic errors and returns 500", async () => {
    // Generic Error → handleError mock returns 500
    const result = await apiRoute(async () => {
      // This would normally be: throw badRequest("Something")
      // but handleError is mocked to treat plain Error as 500
      throw new Error("Custom error")
    })

    expect(result.status).toBe(500)
  })

  it("catches ZodError and returns 400", async () => {
    const result = await apiRoute(async () => {
      const schema = z.object({ x: z.number() })
      schema.parse({ x: "not-a-number" })
      return NextResponse.json({ ok: true })
    })

    const body = await result.json()
    expect(result.status).toBe(400)
    expect(body).toHaveProperty("error", "Dados inválidos")
    expect(body).toHaveProperty("details")
    expect(Array.isArray(body.details)).toBe(true)
    expect(body.details.length).toBeGreaterThan(0)
  })

  it("catches auth errors and returns 401", async () => {
    const result = await apiRoute(async () => {
      throw new Error("UNAUTHORIZED")
    })

    expect(result.status).toBe(401)
    const body = await result.json()
    expect(body).toEqual({ error: "Não autorizado" })
  })

  it("catches auth errors and returns 403", async () => {
    const result = await apiRoute(async () => {
      throw new Error("FORBIDDEN")
    })

    expect(result.status).toBe(403)
    const body = await result.json()
    expect(body).toEqual({ error: "Acesso proibido" })
  })

  it("propagates the handler's response headers", async () => {
    const result = await apiRoute(async () => {
      const resp = NextResponse.json({ ok: true })
      resp.headers.set("X-Custom", "value")
      return resp
    })

    expect(result.headers.get("X-Custom")).toBe("value")
  })

  it("handles nested async handlers", async () => {
    const result = await apiRoute(async () => {
      const inner = async () => {
        return NextResponse.json({ nested: true })
      }
      return await inner()
    })

    const body = await result.json()
    expect(body).toEqual({ nested: true })
  })
})

// ---------------------------------------------------------------------------
// parseBody
// ---------------------------------------------------------------------------

describe("parseBody", () => {
  const VALID_BODY = { name: "Alice", age: 30 }

  it("parses a valid JSON body", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_BODY),
    })

    const data = await parseBody(request, testSchema)
    expect(data).toEqual(VALID_BODY)
  })

  it("throws ZodError for invalid body", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "A", age: -1 }),
    })

    await expect(parseBody(request, testSchema)).rejects.toThrow(z.ZodError)
  })

  it("throws ZodError when required fields are missing", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })

    await expect(parseBody(request, testSchema)).rejects.toThrow(z.ZodError)
  })

  it("throws SyntaxError for malformed JSON", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    })

    await expect(parseBody(request, testSchema)).rejects.toThrow()
  })

  it("preserves transformed values from Zod schema", async () => {
    const schema = z.object({
      value: z.string().transform((v) => v.toUpperCase()),
    })

    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "hello" }),
    })

    const data = await parseBody(request, schema)
    expect(data.value).toBe("HELLO")
  })
})

// ---------------------------------------------------------------------------
// parseSearchParams
// ---------------------------------------------------------------------------

describe("parseSearchParams", () => {
  it("parses valid search params", () => {
    const url = new URL("http://localhost?q=test&limit=5")
    const data = parseSearchParams(searchSchema, url.searchParams)

    expect(data.q).toBe("test")
    expect(data.limit).toBe(5)
    expect(data.page).toBe(1) // default
  })

  it("applies default values for missing optional params", () => {
    const url = new URL("http://localhost?q=hello")
    const data = parseSearchParams(searchSchema, url.searchParams)

    expect(data.q).toBe("hello")
    expect(data.limit).toBe(5) // default
    expect(data.page).toBe(1) // default
  })

  it("throws ZodError for invalid params", () => {
    const url = new URL("http://localhost?q=&limit=999")
    expect(() => parseSearchParams(searchSchema, url.searchParams)).toThrow(z.ZodError)
  })

  it("throws ZodError when required params are missing", () => {
    const url = new URL("http://localhost")
    // q is required (min(1))
    expect(() => parseSearchParams(searchSchema, url.searchParams)).toThrow(z.ZodError)
  })

  it("coerces numeric strings to numbers", () => {
    const url = new URL("http://localhost?q=search&limit=3&page=2")
    const data = parseSearchParams(searchSchema, url.searchParams)

    expect(data.limit).toBe(3)
    expect(data.page).toBe(2)
  })

  it("ignores extra params not in the schema", () => {
    const url = new URL("http://localhost?q=test&extra=ignored&limit=10")
    const data = parseSearchParams(searchSchema, url.searchParams)

    expect(data.q).toBe("test")
    expect(data.limit).toBe(10)
    expect(data.page).toBe(1) // default
    // extra should be ignored
    expect(Object.keys(data).sort()).toEqual(["limit", "page", "q"])
  })
})
