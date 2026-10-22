import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET, PUT } from "../notification-preferences/route"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: "u-123", role: "CLIENT" }),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { general: { max: 100, windowMs: 60000 } },
}))

const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
}

vi.mock("@/lib/redis", () => ({
  getClient: vi.fn(() => mockRedis),
}))

vi.mock("@/lib/db", () => ({
  db: {
    notificationPreference: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  },
}))

describe("Notification Preferences Route (/api/users/notification-preferences)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("GET /api/users/notification-preferences", () => {
    it("returns all categories merged with user preferences and quiet hours", async () => {
      vi.mocked(db.notificationPreference.findMany).mockResolvedValue([
        {
          id: "pref-1",
          userId: "u-123",
          type: "QUOTE",
          pushEnabled: true,
          emailEnabled: false,
          whatsappEnabled: true,
          soundEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any)

      mockRedis.get.mockResolvedValueOnce(
        JSON.stringify({ enabled: true, start: "23:00", end: "07:00" }),
      )

      const req = new Request("http://localhost:3000/api/users/notification-preferences")
      const res = await GET(req)
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.preferences).toHaveLength(5)

      // The QUOTE category should have emailEnabled = false
      const quotePref = data.preferences.find((p: any) => p.type === "QUOTE")
      expect(quotePref.emailEnabled).toBe(false)
      expect(quotePref.whatsappEnabled).toBe(true)

      // An unconfigured category should have default true
      const bookingPref = data.preferences.find((p: any) => p.type === "BOOKING")
      expect(bookingPref.pushEnabled).toBe(true)
      expect(bookingPref.emailEnabled).toBe(true)

      // Quiet hours should match redis
      expect(data.quietHours).toEqual({ enabled: true, start: "23:00", end: "07:00" })
    })

    it("rejects unauthorized access when session fails", async () => {
      const { unauthorized } = await import("@/lib/api-server")
      vi.mocked(requireUser).mockRejectedValueOnce(unauthorized())

      const req = new Request("http://localhost:3000/api/users/notification-preferences")
      const res = await GET(req)
      expect(res.status).toBe(401)
    })
  })

  describe("PUT /api/users/notification-preferences", () => {
    it("batches upserts in a single $transaction and persists quiet hours in redis", async () => {
      const payload = {
        preferences: [
          {
            type: "QUOTE",
            pushEnabled: false,
            emailEnabled: true,
            whatsappEnabled: false,
            soundEnabled: true,
          },
          {
            type: "MESSAGE",
            pushEnabled: true,
            emailEnabled: true,
            whatsappEnabled: true,
            soundEnabled: false,
          },
        ],
        quietHours: {
          enabled: true,
          start: "22:30",
          end: "08:00",
        },
      }

      const req = new Request("http://localhost:3000/api/users/notification-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const res = await PUT(req)
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.success).toBe(true)

      expect(db.$transaction).toHaveBeenCalledTimes(1)
      expect(db.notificationPreference.upsert).toHaveBeenCalledTimes(2)
      expect(mockRedis.set).toHaveBeenCalledWith(
        "user:u-123:quiet-hours",
        JSON.stringify(payload.quietHours),
      )
    })

    it("rejects invalid input schema with 400", async () => {
      const payload = {
        quietHours: {
          enabled: true,
          start: "invalid-time",
          end: "08:00",
        },
      }

      const req = new Request("http://localhost:3000/api/users/notification-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const res = await PUT(req)
      const data = await res.json()

      expect(res.status).toBe(400)
      expect(data.error).toBe("Dados inválidos")
      expect(db.$transaction).not.toHaveBeenCalled()
    })
  })
})
