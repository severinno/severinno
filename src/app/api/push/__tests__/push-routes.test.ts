import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  POST as subscribePush,
  DELETE as unsubscribePush,
  GET as getVapidKey,
} from "@/app/api/push/subscribe/route"
import { POST as trackPushClick } from "@/app/api/push/click/route"
import { POST as testPush } from "@/app/api/push/send-test/route"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"

const mockSendPushNotification = vi.fn().mockResolvedValue(undefined)
vi.mock("@/lib/push", () => ({
  sendPushNotification: (...args: any[]) => mockSendPushNotification(...args),
}))

vi.mock("@/lib/db", () => ({
  db: {
    pushSubscription: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
    pushAnalytics: {
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}))

describe("POST & DELETE /api/push/subscribe and /api/push/click", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue({ userId: "u-123", role: "CLIENT" } as any)
  })

  it("subscribes user to web push", async () => {
    vi.mocked(db.pushSubscription.upsert).mockResolvedValue({} as any)

    const req = new Request("http://localhost:3000/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify({
        endpoint: "https://fcm.googleapis.com/fcm/send/123",
        p256dh: "key-1",
        auth: "auth-1",
      }),
    })

    const res = await subscribePush(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(db.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { endpoint: "https://fcm.googleapis.com/fcm/send/123" },
      }),
    )
  })

  it("unsubscribes user from web push", async () => {
    vi.mocked(db.pushSubscription.deleteMany).mockResolvedValue({ count: 1 })

    const req = new Request("http://localhost:3000/api/push/subscribe", {
      method: "DELETE",
      body: JSON.stringify({
        endpoint: "https://fcm.googleapis.com/fcm/send/123",
      }),
    })

    const res = await unsubscribePush(req, { params: Promise.resolve({}) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it("tracks push click in analytics", async () => {
    vi.mocked(db.pushAnalytics.update).mockResolvedValue({} as any)

    const req = new Request("http://localhost:3000/api/push/click", {
      method: "POST",
      body: JSON.stringify({
        notificationId: "notif-123",
      }),
    })

    const res = await trackPushClick(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it("returns public VAPID key via GET", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "test-public-key-xyz")

    const req = new Request("http://localhost:3000/api/push/subscribe", {
      method: "GET",
    })

    const res = await getVapidKey(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.publicKey).toBe("test-public-key-xyz")
  })

  describe("POST /api/push/send-test", () => {
    it("returns 400 when user has no active push subscriptions", async () => {
      vi.mocked(db.pushSubscription.findMany).mockResolvedValue([])

      const req = new Request("http://localhost:3000/api/push/send-test", { method: "POST" })
      const res = await testPush(req)
      expect(res.status).toBe(400)
      expect(mockSendPushNotification).not.toHaveBeenCalled()
    })

    it("sends test notification when user has active subscriptions", async () => {
      vi.mocked(db.pushSubscription.findMany).mockResolvedValue([
        {
          id: "sub-1",
          endpoint: "https://push.example.com",
          p256dh: "key",
          auth: "auth",
          userId: "u-123",
        } as any,
      ])

      const req = new Request("http://localhost:3000/api/push/send-test", { method: "POST" })
      const res = await testPush(req)
      const json = await res.json()

      expect(res.status).toBe(200)
      expect(json.ok).toBe(true)
      expect(json.deviceCount).toBe(1)
      expect(mockSendPushNotification).toHaveBeenCalledWith(
        "u-123",
        expect.stringContaining("Notificação de Teste"),
        expect.any(String),
        "/dashboard",
        expect.objectContaining({ notificationType: "TEST" }),
      )
    })
  })
})
