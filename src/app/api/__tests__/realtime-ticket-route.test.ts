import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>()
  return {
    ...actual,
    createSocketTicket: vi.fn(async () => ({ ok: true, ticket: "a".repeat(64), expiresIn: 60 })),
  }
})

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: {
    login: { prefix: "login", max: 5, windowMs: 60000 },
  },
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { POST } from "../realtime/ticket/route"
import { createSocketTicket } from "@/lib/auth"

const mockedTicket = vi.mocked(createSocketTicket)

beforeEach(() => {
  mockedTicket.mockClear()
  mockedTicket.mockResolvedValue({ ok: true, ticket: "a".repeat(64), expiresIn: 60 })
})

describe("POST /api/realtime/ticket", () => {
  it("200 com ticket de 64 hex e expiresIn para sessão válida", async () => {
    const req = createMockRequest({ method: "POST" })
    const res = await POST(req)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body).toEqual({ ok: true, ticket: "a".repeat(64), expiresIn: 60 })
  })

  it("401 quando a sessão não autentica", async () => {
    mockedTicket.mockResolvedValue({ ok: false, error: "Não autenticado" })
    const req = createMockRequest({ method: "POST" })
    const res = await POST(req)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(401)
    expect(body).toEqual({ error: "Não autenticado" })
  })

  it("a identidade NUNCA vem do corpo (payload ignorado)", async () => {
    const req = createMockRequest({
      method: "POST",
      body: { userId: "vítima", role: "ADMIN" },
    })
    const res = await POST(req)
    const { body } = await parseResponse(res)
    // O ticket reflete a SESSÃO (mock fixo) — o corpo não influencia.
    expect(body).toEqual({ ok: true, ticket: "a".repeat(64), expiresIn: 60 })
  })
})
