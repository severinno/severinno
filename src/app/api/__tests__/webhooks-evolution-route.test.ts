import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() },
}))

vi.mock("@/lib/evolution", () => ({
  evolutionLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() },
}))

vi.mock("@/lib/db", () => ({
  db: {
    user: { findFirst: vi.fn() },
  },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST as evolutionWebhookHandler } from "../webhooks/evolution/route"
import { db } from "@/lib/db"

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/webhooks/evolution", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 200 for a valid messages.upsert event", async () => {
    (vi.mocked(db.user.findFirst) as any).mockResolvedValue({
      id: "user-1",
      name: "Test User",
    })

    const payload = {
      event: "messages.upsert",
      instance: "severinno-instance",
      data: {
        key: {
          remoteJid: "5511999999999@s.whatsapp.net",
          fromMe: false,
        },
        message: {
          conversation: "Olá, gostaria de um orçamento",
        },
      },
    }

    const req = createMockRequest({ method: "POST", body: payload })
    const res = await evolutionWebhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.received).toBe(true)
    expect(db.user.findFirst).toHaveBeenCalled()
  })

  it("ignores messages from self (fromMe=true)", async () => {
    const payload = {
      event: "messages.upsert",
      instance: "severinno-instance",
      data: {
        key: {
          remoteJid: "5511999999999@s.whatsapp.net",
          fromMe: true,
        },
        message: {
          conversation: "Mensagem enviada pelo próprio sistema",
        },
      },
    }

    const req = createMockRequest({ method: "POST", body: payload })
    const res = await evolutionWebhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.received).toBe(true)
    // fromMe messages should NOT trigger user lookup
    expect(db.user.findFirst).not.toHaveBeenCalled()
  })

  it("returns 200 for connection.update event", async () => {
    const payload = {
      event: "connection.update",
      instance: "severinno-instance",
      data: {
        instance: { status: "open" },
      },
    }

    const req = createMockRequest({ method: "POST", body: payload })
    const res = await evolutionWebhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.received).toBe(true)
  })

  it("returns 200 for unknown event type", async () => {
    const payload = {
      event: "unknown.event",
      instance: "severinno-instance",
      data: {},
    }

    const req = createMockRequest({ method: "POST", body: payload })
    const res = await evolutionWebhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.received).toBe(true)
  })

  it("returns 200 for disconnected status (logs warning)", async () => {
    const payload = {
      event: "connection.update",
      instance: "severinno-instance",
      data: {
        instance: { status: "disconnected" },
      },
    }

    const req = createMockRequest({ method: "POST", body: payload })
    const res = await evolutionWebhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.received).toBe(true)
  })

  it("returns 200 when message has no text (media message)", async () => {
    const payload = {
      event: "messages.upsert",
      instance: "severinno-instance",
      data: {
        key: {
          remoteJid: "5511999999999@s.whatsapp.net",
          fromMe: false,
        },
        message: {
          imageMessage: { url: "https://example.com/img.jpg" },
        },
      },
    }

    const req = createMockRequest({ method: "POST", body: payload })
    const res = await evolutionWebhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.received).toBe(true)
    // Media without text should not trigger user lookup
    expect(db.user.findFirst).not.toHaveBeenCalled()
  })

  it("returns 200 for invalid JSON body", async () => {
    const req = new Request("http://localhost:3000/api/webhooks/evolution", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "invalid-json{",
    })
    const res = await evolutionWebhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.received).toBe(true)
  })

  it("returns 200 when message sender is not a registered user", async () => {
    (vi.mocked(db.user.findFirst) as any).mockResolvedValue(null)

    const payload = {
      event: "messages.upsert",
      instance: "severinno-instance",
      data: {
        key: {
          remoteJid: "5511888888888@s.whatsapp.net",
          fromMe: false,
        },
        message: {
          conversation: "Olá, quanto custa?",
        },
      },
    }

    const req = createMockRequest({ method: "POST", body: payload })
    const res = await evolutionWebhookHandler(req)
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body!.received).toBe(true)
    // Should log and continue without error
    expect(db.user.findFirst).toHaveBeenCalled()
  })
})
