import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────
// Padrão geo-alert-notify.test.ts: mocks criados com vi.hoisted e injetados
// na factory do vi.mock. Evita o bug de ASI do padrão anterior, onde duas
// linhas `(vi.mocked(...) as any).mockResolvedValue(...)` consecutivas eram
// encadeadas pelo parser JS (`foo()(bar())`) — a primeira terminava em `)`
// e a segunda começava com `(`, então a segunda virava chamada do RESULTADO
// da primeira e `mockResolvedValue` quebrava com "is not a function".

const { mockSettingFindUnique, mockSettingCreate } = vi.hoisted(() => ({
  mockSettingFindUnique: vi.fn(),
  mockSettingCreate: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: new Proxy(
    {},
    { get: () => ({ prefix: "test", max: 1000, windowMs: 60_000 }) },
  ),
}))

vi.mock("@/lib/db", () => ({
  db: {
    setting: {
      findUnique: mockSettingFindUnique,
      create: mockSettingCreate,
    },
  },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST as newsletterHandler } from "../newsletter/route"
import { db } from "@/lib/db"

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/newsletter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("subscribes a new email successfully", async () => {
    mockSettingFindUnique.mockResolvedValue(null)
    mockSettingCreate.mockResolvedValue({} as any)

    const req = createMockRequest({
      method: "POST",
      body: { email: "user@example.com" },
    })
    const res = await newsletterHandler(req as any)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).ok).toBe(true)
    expect((parsed.body as any).message).toBe("Inscrição confirmada!")
    expect(db.setting.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: "newsletter:user@example.com",
      }),
    })
  })

  it("returns already subscribed when email exists", async () => {
    mockSettingFindUnique.mockResolvedValue({
      key: "newsletter:user@example.com",
      value: JSON.stringify({ email: "user@example.com" }),
    } as any)
    mockSettingCreate.mockResolvedValue({} as any)

    const req = createMockRequest({
      method: "POST",
      body: { email: "user@example.com" },
    })
    const res = await newsletterHandler(req as any)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect((parsed.body as any).ok).toBe(true)
    expect((parsed.body as any).alreadySubscribed).toBe(true)
    expect((parsed.body as any).message).toBe("Este e-mail já está inscrito!")
    // Should NOT create a new subscription
    expect(db.setting.create).not.toHaveBeenCalled()
  })

  it("returns 400 when email is missing", async () => {
    const req = createMockRequest({
      method: "POST",
      body: {},
    })
    const res = await newsletterHandler(req as any)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toBe("E-mail é obrigatório.")
  })

  it("returns 400 when email is invalid", async () => {
    const req = createMockRequest({
      method: "POST",
      body: { email: "not-an-email" },
    })
    const res = await newsletterHandler(req as any)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toBe("E-mail inválido.")
  })

  it("normalizes email to lowercase", async () => {
    mockSettingFindUnique.mockResolvedValue(null)
    mockSettingCreate.mockResolvedValue({} as any)

    const req = createMockRequest({
      method: "POST",
      body: { email: "User@Example.COM" },
    })
    await newsletterHandler(req as any)

    expect(db.setting.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: "newsletter:user@example.com",
      }),
    })
  })

  it("trims whitespace from email", async () => {
    mockSettingFindUnique.mockResolvedValue(null)
    mockSettingCreate.mockResolvedValue({} as any)

    const req = createMockRequest({
      method: "POST",
      body: { email: "  user@example.com  " },
    })
    await newsletterHandler(req as any)

    expect(db.setting.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: "newsletter:user@example.com",
      }),
    })
  })
})
