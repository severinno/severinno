import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { POST } from "../web-vitals/route"

function req(body: unknown) {
  return createMockRequest({ method: "POST", body }) as any
}

describe("POST /api/web-vitals", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 400 for invalid payload (missing name)", async () => {
    const res = await POST(req({ value: 100 }))
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(400)
  })

  it("returns 400 for invalid payload (non-numeric value)", async () => {
    const res = await POST(req({ name: "LCP", value: "not-a-number" }))
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(400)
  })

  it("accepts valid metric and returns 200", async () => {
    const res = await POST(
      req({
        name: "LCP",
        value: 2500,
        rating: "good",
        id: "v1",
        navigationType: "navigate",
        delta: 100,
        timestamp: Date.now(),
      }),
    )
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(200)
    expect((parsed.body as any).ok).toBe(true)
  })

  it("returns 200 even on malformed JSON (beacon should never fail)", async () => {
    const badReq = new Request("http://localhost:3000/api/web-vitals", {
      method: "POST",
      body: "not json",
      headers: { "content-type": "application/json" },
    })
    const res = await POST(badReq as any)
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(200)
    expect((parsed.body as any).ok).toBe(true)
  })
})
