// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn().mockReturnThis() },
}))

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockResolvedValue({ userId: "admin-1", role: "ADMIN" }),
}))

vi.mock("@/lib/db", () => ({
  db: {
    eventWebhook: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { GET, POST } from "@/app/api/admin/push/webhooks/route"
import { PATCH, DELETE } from "@/app/api/admin/push/webhooks/[id]/route"
import { db } from "@/lib/db"

// ── Helpers ────────────────────────────────────────────────────────────────

function mockWebhook(overrides: Record<string, unknown> = {}) {
  return {
    id: "wh-1",
    event: "booking.created",
    title: "Novo agendamento",
    body: "Corpo da notificação",
    pushUrl: "/dashboard",
    targetRoles: ["PROVIDER"],
    active: true,
    createdBy: "admin-1",
    createdAt: new Date("2026-01-15T10:00:00Z"),
    updatedAt: new Date("2026-01-15T10:00:00Z"),
    ...overrides,
  }
}

// ── Tests: GET ─────────────────────────────────────────────────────────────

describe("GET /api/admin/push/webhooks", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns list of webhooks", async () => {
    vi.mocked(db.eventWebhook.findMany).mockResolvedValue([mockWebhook()])

    const res = await GET()
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body!.ok).toBe(true)
    expect(body!.webhooks).toHaveLength(1)
    expect(body!.webhooks[0].title).toBe("Novo agendamento")
    expect(body!.webhooks[0].event).toBe("booking.created")
  })

  it("returns empty array when no webhooks exist", async () => {
    vi.mocked(db.eventWebhook.findMany).mockResolvedValue([])

    const res = await GET()
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body!.ok).toBe(true)
    expect(body!.webhooks).toHaveLength(0)
  })
})

// ── Tests: POST ────────────────────────────────────────────────────────────

describe("POST /api/admin/push/webhooks", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.eventWebhook.findUnique).mockResolvedValue(null) // no duplicate
  })

  const validPayload = {
    event: "booking.created",
    title: "Novo agendamento de {{clientName}}",
    body: "{{clientName}} agendou {{serviceName}}",
    pushUrl: "/dashboard",
    targetRoles: ["PROVIDER"],
  }

  it("creates a webhook with valid data", async () => {
    vi.mocked(db.eventWebhook.create).mockResolvedValue(mockWebhook({
      title: "Novo agendamento de {{clientName}}",
      body: "{{clientName}} agendou {{serviceName}}",
    }))

    const req = createMockRequest({ method: "POST", body: validPayload })
    const res = await POST(req)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(201)
    expect(body!.ok).toBe(true)
    expect(body!.webhook.title).toBe("Novo agendamento de {{clientName}}")
  })

  it("rejects invalid event type", async () => {
    const req = createMockRequest({
      method: "POST",
      body: { ...validPayload, event: "invalid.event" },
    })
    const res = await POST(req)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body!.error).toContain("event invalido")
  })

  it("rejects missing title", async () => {
    const req = createMockRequest({
      method: "POST",
      body: { ...validPayload, title: "" },
    })
    const res = await POST(req)
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })

  it("rejects title exceeding 200 characters", async () => {
    const req = createMockRequest({
      method: "POST",
      body: { ...validPayload, title: "x".repeat(201) },
    })
    const res = await POST(req)
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })

  it("rejects targetRoles as empty array", async () => {
    const req = createMockRequest({
      method: "POST",
      body: { ...validPayload, targetRoles: [] },
    })
    const res = await POST(req)
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })

  it("rejects invalid role in targetRoles", async () => {
    const req = createMockRequest({
      method: "POST",
      body: { ...validPayload, targetRoles: ["INVALID_ROLE"] },
    })
    const res = await POST(req)
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })

  it("rejects duplicate (event + title) combination", async () => {
    vi.mocked(db.eventWebhook.findUnique).mockResolvedValue(mockWebhook())

    const req = createMockRequest({ method: "POST", body: validPayload })
    const res = await POST(req)
    const { status, body } = await parseResponse(res)

    expect(status).toBe(400)
    expect(body!.error).toContain("Ja existe uma regra")
  })

  it("rejects body exceeding 500 characters", async () => {
    const req = createMockRequest({
      method: "POST",
      body: { ...validPayload, body: "x".repeat(501) },
    })
    const res = await POST(req)
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })

  it("rejects invalid pushUrl (javascript: protocol)", async () => {
    const req = createMockRequest({
      method: "POST",
      body: { ...validPayload, pushUrl: "javascript:alert(1)" },
    })
    const res = await POST(req)
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })

  it("accepts all valid event types", async () => {
    const validEvents = [
      "booking.created", "booking.confirmed", "booking.cancelled", "booking.completed",
      "review.created", "quote.received", "quote.responded",
      "payment.confirmed", "message.sent", "provider.registered",
    ]

    for (const event of validEvents) {
      vi.mocked(db.eventWebhook.findUnique).mockResolvedValue(null)
      vi.mocked(db.eventWebhook.create).mockResolvedValue(mockWebhook({ event }))

      const req = createMockRequest({ method: "POST", body: { ...validPayload, event } })
      const res = await POST(req)
      const { status } = await parseResponse(res)

      expect(status).toBe(201)
    }
  })
})

// ── Tests: PATCH ───────────────────────────────────────────────────────────

describe("PATCH /api/admin/push/webhooks/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("updates webhook fields partially", async () => {
    vi.mocked(db.eventWebhook.findUnique).mockResolvedValue(mockWebhook())
    vi.mocked(db.eventWebhook.update).mockResolvedValue(mockWebhook({
      title: "Título atualizado",
      body: "Corpo atualizado",
    }))

    const req = createMockRequest({
      method: "PATCH",
      body: { title: "Título atualizado", body: "Corpo atualizado" },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: "wh-1" }) })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body!.webhook.title).toBe("Título atualizado")
  })

  it("returns 404 when webhook does not exist", async () => {
    vi.mocked(db.eventWebhook.findUnique).mockResolvedValue(null)

    const req = createMockRequest({ method: "PATCH", body: { title: "Novo" } })
    const res = await PATCH(req, { params: Promise.resolve({ id: "non-existent" }) })
    const { status } = await parseResponse(res)

    expect(status).toBe(404)
  })

  it("rejects empty title", async () => {
    vi.mocked(db.eventWebhook.findUnique).mockResolvedValue(mockWebhook())

    const req = createMockRequest({ method: "PATCH", body: { title: "" } })
    const res = await PATCH(req, { params: Promise.resolve({ id: "wh-1" }) })
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })

  it("rejects title exceeding 200 characters", async () => {
    vi.mocked(db.eventWebhook.findUnique).mockResolvedValue(mockWebhook())

    const req = createMockRequest({ method: "PATCH", body: { title: "x".repeat(201) } })
    const res = await PATCH(req, { params: Promise.resolve({ id: "wh-1" }) })
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })

  it("rejects empty targetRoles", async () => {
    vi.mocked(db.eventWebhook.findUnique).mockResolvedValue(mockWebhook())

    const req = createMockRequest({ method: "PATCH", body: { targetRoles: [] } })
    const res = await PATCH(req, { params: Promise.resolve({ id: "wh-1" }) })
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })

  it("rejects invalid role in targetRoles", async () => {
    vi.mocked(db.eventWebhook.findUnique).mockResolvedValue(mockWebhook())

    const req = createMockRequest({ method: "PATCH", body: { targetRoles: ["BOGUS"] } })
    const res = await PATCH(req, { params: Promise.resolve({ id: "wh-1" }) })
    const { status } = await parseResponse(res)

    expect(status).toBe(400)
  })

  it("toggles active field", async () => {
    vi.mocked(db.eventWebhook.findUnique).mockResolvedValue(mockWebhook())
    vi.mocked(db.eventWebhook.update).mockResolvedValue(mockWebhook({ active: false }))

    const req = createMockRequest({ method: "PATCH", body: { active: false } })
    const res = await PATCH(req, { params: Promise.resolve({ id: "wh-1" }) })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body!.webhook.active).toBe(false)
  })
})

// ── Tests: DELETE ──────────────────────────────────────────────────────────

describe("DELETE /api/admin/push/webhooks/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("deletes an existing webhook", async () => {
    vi.mocked(db.eventWebhook.findUnique).mockResolvedValue(mockWebhook())
    vi.mocked(db.eventWebhook.delete).mockResolvedValue(mockWebhook())

    const req = createMockRequest({ method: "DELETE" })
    const res = await DELETE(req, { params: Promise.resolve({ id: "wh-1" }) })
    const { status, body } = await parseResponse(res)

    expect(status).toBe(200)
    expect(body!.ok).toBe(true)
    expect(db.eventWebhook.delete).toHaveBeenCalledWith({ where: { id: "wh-1" } })
  })

  it("returns 404 when webhook does not exist", async () => {
    vi.mocked(db.eventWebhook.findUnique).mockResolvedValue(null)

    const req = createMockRequest({ method: "DELETE" })
    const res = await DELETE(req, { params: Promise.resolve({ id: "non-existent" }) })
    const { status } = await parseResponse(res)

    expect(status).toBe(404)
  })
})
