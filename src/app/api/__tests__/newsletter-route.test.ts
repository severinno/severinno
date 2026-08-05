import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/db", () => ({
  db: {
    setting: {
      findUnique: vi.fn(),
      create: vi.fn(),
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
    (vi.mocked(db.setting.findUnique) as any).mockResolvedValue(null)
    (vi.mocked(db.setting.create) as any).mockResolvedValue({} as any)

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
    (vi.mocked(db.setting.findUnique) as any).mockResolvedValue({
      key: "newsletter:user@example.com",
      value: JSON.stringify({ email: "user@example.com" }),
    } as any)
    (vi.mocked(db.setting.create) as any).mockResolvedValue({} as any)

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
    (vi.mocked(db.setting.findUnique) as any).mockResolvedValue(null)
    (vi.mocked(db.setting.create) as any).mockResolvedValue({} as any)

    const req = createMockRequest({
      method: "POST",
      body: { email: "User@Example.COM" },
    })
    await newsletterHandler(req)

    expect(db.setting.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: "newsletter:user@example.com",
      }),
    })
  })

  it("trims whitespace from email", async () => {
    (vi.mocked(db.setting.findUnique) as any).mockResolvedValue(null)
    (vi.mocked(db.setting.create) as any).mockResolvedValue({} as any)

    const req = createMockRequest({
      method: "POST",
      body: { email: "  user@example.com  " },
    })
    await newsletterHandler(req)

    expect(db.setting.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: "newsletter:user@example.com",
      }),
    })
  })
})
