import { describe, it, expect, vi, beforeEach } from "vitest"
import { notifyPerfectSlotFit, checkAndNotifyBookingSlotFit } from "@/lib/slot-fit-notifications"

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    notification: {
      create: vi.fn().mockResolvedValue({ id: "notif-123", createdAt: new Date() }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "prov-1",
        name: "Carlos Eletricista",
        whatsapp: "5511999998888",
      }),
    },
  },
}))

vi.mock("@/lib/redis", () => {
  const store = new Map<string, unknown>()
  return {
    cacheGet: vi.fn(async (key: string) => store.get(key) ?? null),
    cacheSet: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    cacheDel: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  }
})

vi.mock("@/lib/push", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/lib/evolution", () => ({
  sendText: vi.fn().mockResolvedValue({ key: { id: "msg-123" } }),
  formatPhone: vi.fn((phone: string) => phone.replace(/\D/g, "")),
  isValidWhatsApp: vi.fn(() => true),
}))

vi.mock("@/lib/realtime-client", () => ({
  emitRealtime: vi.fn().mockResolvedValue(true),
}))

// O mock precisa cobrir os DOIS jeitos de usar o logger: por `child()` (o
// padrão dos módulos de domínio) e DIRETO (`logger.warn(...)`, como o
// geo-metrics faz ao hidratar snapshots do disco). Sem os métodos de topo, a
// chamada estourava `default.warn is not a function` como erro NÃO TRATADO —
// o vitest sai 1 mesmo com 732/732 arquivos verdes.
vi.mock("@/lib/logger", () => {
  const nivel = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  return { default: { ...nivel(), child: nivel } }
})

describe("slot-fit-notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("notifyPerfectSlotFit sends in-app, push, and whatsapp notification", async () => {
    const result = await notifyPerfectSlotFit({
      providerId: "prov-1",
      bookingId: "book-1",
      serviceTitle: "Instalação de Tomada",
      scheduledAt: new Date("2026-10-15T14:00:00Z"),
      detourKm: 1.8,
      addedMinutes: 4,
    })

    expect(result).toBe(true)

    const { sendPushNotification } = await import("@/lib/push")
    expect(sendPushNotification).toHaveBeenCalledWith(
      "prov-1",
      expect.stringContaining("Encaixe Perfeito"),
      expect.stringContaining("1.8 km"),
      expect.stringContaining("/provider/routes"),
      expect.objectContaining({ tag: "slot-fit:book-1" }),
    )

    const { sendText } = await import("@/lib/evolution")
    expect(sendText).toHaveBeenCalledWith(
      "5511999998888",
      expect.stringContaining("Encaixe Perfeito na sua Rota"),
    )
  })

  it("checkAndNotifyBookingSlotFit detects perfect slot and notifies", async () => {
    const { db } = await import("@/lib/db")
    vi.mocked(db.booking.findUnique).mockResolvedValueOnce({
      id: "candidate-booking",
      providerId: "prov-1",
      scheduledAt: new Date("2026-10-15T15:00:00Z"),
      lat: -23.5505,
      lng: -46.6333,
      address: "Rua Direita, 50",
      status: "CONFIRMED",
      service: { title: "Troca de Chuveiro" },
    } as any)

    vi.mocked(db.booking.findMany).mockResolvedValueOnce([
      {
        id: "existing-1",
        lat: -23.551,
        lng: -46.634,
        address: "Rua A, 100",
        service: { title: "Manutenção Elétrica" },
      },
    ] as any)

    const outcome = await checkAndNotifyBookingSlotFit("candidate-booking")
    expect(outcome.eligible).toBe(true)
    expect(outcome.notified).toBe(true)
    expect(outcome.fitQuality).toBe("PERFECT")
  })

  it("checkAndNotifyBookingSlotFit prevents duplicate notification if already notified", async () => {
    const { cacheSet } = await import("@/lib/redis")
    await cacheSet("slot_fit:notified:already-done", true)

    const outcome = await checkAndNotifyBookingSlotFit("already-done")
    expect(outcome.eligible).toBe(false)
    expect(outcome.notified).toBe(false)
    expect(outcome.reason).toBe("already_notified")
  })
})
