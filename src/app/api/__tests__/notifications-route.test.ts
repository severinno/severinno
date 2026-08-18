/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "../notifications/route"
import { PATCH } from "../notifications/[id]/read/route"
import { createMockRequest } from "@/lib/__tests__/helpers/api-test-utils"

const { mockNotifications } = vi.hoisted(() => ({
  mockNotifications: [
    {
      id: "notif-1",
      userId: "client-1",
      type: "BOOKING_CONFIRMED",
      title: "Serviço confirmado",
      body: "Seu agendamento foi confirmado",
      read: false,
      createdAt: new Date("2026-07-20"),
    },
    {
      id: "notif-2",
      userId: "client-1",
      type: "MESSAGE",
      title: "Nova mensagem",
      body: "Olá, tudo bem?",
      read: false,
      createdAt: new Date("2026-07-19"),
    },
    {
      id: "notif-3",
      userId: "client-1",
      type: "BOOKING_REMINDER",
      title: "Lembrete",
      body: "Seu serviço é amanhã",
      read: true,
      createdAt: new Date("2026-07-18"),
    },
  ],
}))

const mockDb = vi.hoisted(() => ({
  notification: {
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock("@/lib/db", () => ({ default: mockDb, db: mockDb }))
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }))
vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { requireUser } from "@/lib/auth"

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireUser).mockResolvedValue({ userId: "client-1", role: "CLIENT" })
  mockDb.notification.count.mockResolvedValue(3)
})

describe("GET /api/notifications", () => {
  it("returns paginated notifications", async () => {
    mockDb.notification.findMany.mockResolvedValue(mockNotifications)
    const response = await GET(createMockRequest())
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.items).toHaveLength(3)
    expect(data.total).toBe(3)
    expect(data).toHaveProperty("page")
    expect(data).toHaveProperty("limit")
    expect(data).toHaveProperty("unreadCount")
  })

  it("includes unreadCount in response", async () => {
    mockDb.notification.findMany.mockResolvedValue(mockNotifications)
    mockDb.notification.count
      .mockResolvedValueOnce(3) // total
      .mockResolvedValueOnce(2) // unreadCount
    const response = await GET(createMockRequest())
    const data = await response.json()
    expect(data.unreadCount).toBe(2)
  })

  it("filters by unread=1", async () => {
    mockDb.notification.findMany.mockResolvedValue(mockNotifications.slice(0, 2))
    mockDb.notification.count
      .mockResolvedValueOnce(2) // total (unread only)
      .mockResolvedValueOnce(2) // unreadCount (always all)
    const response = await GET(createMockRequest({ searchParams: { unread: "1" } }))
    expect(response.status).toBe(200)
    expect(mockDb.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ read: false }),
      }),
    )
  })

  it("orders by read asc, createdAt desc", async () => {
    mockDb.notification.findMany.mockResolvedValue(mockNotifications)
    await GET(createMockRequest())
    expect(mockDb.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ read: "asc" }, { createdAt: "desc" }] }),
    )
  })

  it("supports pagination", async () => {
    mockDb.notification.findMany.mockResolvedValue([mockNotifications[0]])
    const response = await GET(createMockRequest({ searchParams: { page: "2", limit: "10" } }))
    expect(response.status).toBe(200)
    expect(mockDb.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    )
  })
})

describe("PATCH /api/notifications/[id]/read", () => {
  it("marks notification as read", async () => {
    mockDb.notification.findUnique.mockResolvedValue({ id: "notif-1", userId: "client-1" })
    mockDb.notification.update.mockResolvedValue({ ...mockNotifications[0], read: true })

    const response = await PATCH(createMockRequest(), {
      params: Promise.resolve({ id: "notif-1" }),
    })
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.notification.read).toBe(true)
  })

  it("returns 404 when notification not found", async () => {
    mockDb.notification.findUnique.mockResolvedValue(null)
    const response = await PATCH(createMockRequest(), {
      params: Promise.resolve({ id: "not-found" }),
    })
    expect(response.status).toBe(404)
  })

  it("returns 403 when notification belongs to another user", async () => {
    mockDb.notification.findUnique.mockResolvedValue({ id: "notif-1", userId: "other-user" })
    const response = await PATCH(createMockRequest(), {
      params: Promise.resolve({ id: "notif-1" }),
    })
    expect(response.status).toBe(403)
  })

  it("allows ADMIN to mark any notification as read", async () => {
    vi.mocked(requireUser).mockResolvedValue({ userId: "admin-1", role: "ADMIN" })
    mockDb.notification.findUnique.mockResolvedValue({ id: "notif-1", userId: "client-1" })
    mockDb.notification.update.mockResolvedValue({ ...mockNotifications[0], read: true })

    const response = await PATCH(createMockRequest(), {
      params: Promise.resolve({ id: "notif-1" }),
    })
    expect(response.status).toBe(200)
  })
})
