import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET as runReminders } from "@/app/api/cron/reminders/route"
import { GET as runCommissions } from "@/app/api/cron/commissions-report/route"
import { GET as runHealthMonitor } from "@/app/api/cron/health-monitor/route"
import { db } from "@/lib/db"
import { sendMail } from "@/lib/mail"
import { sendPushNotification } from "@/lib/push"
import { runHealthMonitor as executeMonitor } from "@/lib/health-monitor"

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    payment: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock("@/lib/mail", () => ({
  sendMail: vi.fn().mockResolvedValue({}),
  bookingReminderHtml: vi.fn().mockReturnValue("<p>reminder</p>"),
  commissionReportHtml: vi.fn().mockReturnValue("<p>report</p>"),
}))

vi.mock("@/lib/push", () => ({
  sendPushNotification: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/health-monitor", () => ({
  runHealthMonitor: vi.fn(),
}))

describe("Cron API Routes (/api/cron/*)", () => {
  const CRON_SECRET = "test-cron-secret-123"

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
  })

  describe("GET /api/cron/reminders", () => {
    it("rejects request with invalid token", async () => {
      const req = new Request("http://localhost:3000/api/cron/reminders", {
        headers: { authorization: "Bearer wrong-secret" },
      })
      const res = await runReminders(req)
      expect(res.status).toBe(401)
    })

    it("processes and dispatches reminders for tomorrow's bookings", async () => {
      const mockBooking = {
        id: "b1",
        scheduledAt: new Date(Date.now() + 23.5 * 60 * 60 * 1000),
        clientId: "c1",
        client: { id: "c1", name: "Cliente", email: "client@test.com" },
        provider: { id: "p1", name: "Prestador" },
        service: { title: "Pintura" },
      }

      vi.mocked(db.booking.findMany).mockResolvedValue([mockBooking as any])
      vi.mocked(db.booking.update).mockResolvedValue({} as any)

      const req = new Request("http://localhost:3000/api/cron/reminders", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      })
      const res = await runReminders(req)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.sent).toBe(1)
      expect(sendMail).toHaveBeenCalled()
      expect(sendPushNotification).toHaveBeenCalled()
      expect(db.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "b1" },
        }),
      )
    })
  })

  describe("GET /api/cron/commissions-report", () => {
    it("generates monthly commissions report for admins", async () => {
      vi.mocked(db.booking.findMany).mockResolvedValue([
        {
          id: "b1",
          amount: 1000,
          status: "COMPLETED",
          provider: { id: "p1", name: "Top Prestador" },
        } as any,
      ])
      vi.mocked(db.user.findMany).mockResolvedValue([
        { id: "admin-1", name: "Admin", email: "admin@severinno.com" } as any,
      ])

      const req = new Request("http://localhost:3000/api/cron/commissions-report", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      })
      const res = await runCommissions(req)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.sent).toBe(1)
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "admin@severinno.com",
        }),
      )
    })
  })

  describe("GET /api/cron/health-monitor", () => {
    it("runs system health monitor checks and reports status", async () => {
      vi.mocked(executeMonitor).mockResolvedValue({
        healthy: true,
        overallStatus: "healthy",
        totalServices: 5,
        healthyCount: 5,
        degradedCount: 0,
        unhealthyCount: 0,
        alertsSent: 0,
        services: [{ name: "PostgreSQL", status: "healthy", message: "ok", alerted: false }],
        timestamp: new Date().toISOString(),
      })

      const req = new Request("http://localhost:3000/api/cron/health-monitor", {
        headers: { authorization: `Bearer ${CRON_SECRET}` },
      })
      const res = await runHealthMonitor(req)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.healthy).toBe(true)
      expect(json.summary.healthy).toBe(5)
    })
  })
})
