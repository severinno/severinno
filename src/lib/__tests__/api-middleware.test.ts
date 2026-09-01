/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * api-middleware.test.ts
 *
 * Tests for the API middleware helpers:
 *   - parseBody — parse JSON body + Zod validation
 *   - parseSearchParams — validate URLSearchParams with Zod
 */

import { describe, it, expect } from "vitest"
import { z } from "zod"
import { parseBody, parseSearchParams } from "@/lib/api-middleware"

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
