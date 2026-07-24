import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET, POST } from "../messages/route"
import { createMockRequest } from "@/lib/__tests__/helpers/api-test-utils"

const { mockMessages, mockPeer } = vi.hoisted(() => ({
  mockMessages: [
    { id: "msg-1", fromId: "client-1", toId: "prov-1", content: "Olá, gostaria de agendar", read: true, bookingId: null, createdAt: new Date("2026-07-20T10:00:00Z") },
    { id: "msg-2", fromId: "prov-1", toId: "client-1", content: "Claro! Qual dia?", read: false, bookingId: null, createdAt: new Date("2026-07-20T10:05:00Z") },
    { id: "msg-3", fromId: "client-1", toId: "prov-1", content: "Segunda-feira às 14h", read: true, bookingId: null, createdAt: new Date("2026-07-20T10:10:00Z") },
  ],
  mockPeer: { id: "prov-1", name: "Maria Souza", avatarUrl: null, role: "PROVIDER" as const },
}))

const mockDb = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  message: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  notification: { create: vi.fn() },
}))

vi.mock("@/lib/db", () => ({ default: mockDb, db: mockDb }))
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }))
vi.mock("@/lib/validators", () => ({
  messageSchema: { parse: vi.fn() },
}))
vi.mock("@/lib/logger", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { requireUser } from "@/lib/auth"
import { messageSchema } from "@/lib/validators"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireUser).mockResolvedValue({ userId: "client-1", role: "CLIENT" })
})

describe("GET /api/messages", () => {
  describe("conversation with a specific peer (?with=userId)", () => {
    beforeEach(() => {
      mockDb.user.findUnique.mockResolvedValue(mockPeer)
      mockDb.message.findMany.mockResolvedValue(mockMessages)
    })

    it("returns conversation messages with peer info", async () => {
      const response = await GET(createMockRequest({ searchParams: { with: "prov-1" } }))
      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.peer.id).toBe("prov-1")
      expect(data.items).toHaveLength(3)
    })

    it("marks unread inbound messages as read", async () => {
      await GET(createMockRequest({ searchParams: { with: "prov-1" } }))
      expect(mockDb.message.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { fromId: "prov-1", toId: "client-1", read: false },
          data: { read: true },
        }),
      )
    })

    it("returns 404 when peer not found", async () => {
      mockDb.user.findUnique.mockResolvedValue(null)
      const response = await GET(createMockRequest({ searchParams: { with: "unknown" } }))
      expect(response.status).toBe(404)
    })
  })

  describe("conversations list (no ?with param)", () => {
    beforeEach(() => {
      mockDb.message.findMany
        .mockResolvedValueOnce([
          { toId: "prov-1", content: "Olá", createdAt: new Date("2026-07-20T10:10:00Z"), read: true },
          { toId: "prov-2", content: "Teste", createdAt: new Date("2026-07-19T09:00:00Z"), read: true },
        ])
        .mockResolvedValueOnce([
          { fromId: "prov-1", content: "Oi", createdAt: new Date("2026-07-20T10:05:00Z"), read: false },
        ])
      mockDb.user.findMany.mockResolvedValue([mockPeer])
    })

    it("returns conversation list grouped by peer", async () => {
      const response = await GET(createMockRequest())
      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.items).toBeDefined()
      expect(mockDb.message.findMany).toHaveBeenCalledTimes(2)
    })

    it("sorts conversations by most recent message", async () => {
      const response = await GET(createMockRequest())
      const data = await response.json()
      expect(response.status).toBe(200)
    })
  })
})

describe("POST /api/messages", () => {
  const validMessage = { toId: "prov-1", content: "Olá, gostaria de agendar um serviço" }

  beforeEach(() => {
    vi.mocked(messageSchema.parse).mockReturnValue(validMessage)
    mockDb.user.findUnique.mockResolvedValue({ id: "prov-1", active: true })
    mockDb.message.create.mockResolvedValue({ id: "msg-new", ...validMessage, fromId: "client-1", read: false, bookingId: null, createdAt: new Date() })
  })

  it("sends a message and creates notification", async () => {
    mockDb.notification.create.mockResolvedValue({})
    const response = await POST(createMockRequest({ method: "POST", body: validMessage }))
    const data = await response.json()
    expect(response.status).toBe(201)
    expect(data.message.fromId).toBe("client-1")
    expect(mockDb.notification.create).toHaveBeenCalled()
  })

  it("throws 400 when sending to self", async () => {
    vi.mocked(messageSchema.parse).mockReturnValueOnce({ toId: "client-1", content: "test" })
    mockDb.notification.create.mockResolvedValue({})
    const response = await POST(createMockRequest({ method: "POST", body: { toId: "client-1", content: "test" } }))
    expect(response.status).toBe(400)
  })

  it("throws 404 when recipient does not exist", async () => {
    mockDb.user.findUnique.mockResolvedValue(null)
    const response = await POST(createMockRequest({ method: "POST", body: validMessage }))
    expect(response.status).toBe(404)
  })

  it("throws 404 when recipient is inactive", async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: "prov-1", active: false })
    const response = await POST(createMockRequest({ method: "POST", body: validMessage }))
    expect(response.status).toBe(404)
  })

  it("truncates long content in notification body to 80 chars", async () => {
    const longMsg = { toId: "prov-1", content: "a".repeat(100) }
    vi.mocked(messageSchema.parse).mockReturnValue(longMsg)
    mockDb.message.create.mockResolvedValue({ id: "msg-new", ...longMsg, fromId: "client-1", read: false, bookingId: null, createdAt: new Date() })

    await POST(createMockRequest({ method: "POST", body: longMsg }))
    expect(mockDb.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          body: expect.stringMatching(/^a{80}…$/),
        }),
      }),
    )
  })

  it("does not throw when notification creation fails (best-effort)", async () => {
    mockDb.notification.create.mockRejectedValue(new Error("DB error"))
    const response = await POST(createMockRequest({ method: "POST", body: validMessage }))
    expect(response.status).toBe(201)
  })
})
