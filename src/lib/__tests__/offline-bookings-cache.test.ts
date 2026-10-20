import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  cacheOfflineBookings,
  getCachedOfflineBookings,
  clearOfflineBookingsCache,
  type CachedBookingSummary,
} from "../offline-bookings-cache"

describe("offline-bookings-cache", () => {
  const sampleBookings: Array<Partial<CachedBookingSummary> & { id: string }> = [
    {
      id: "booking-cache-1",
      scheduledAt: new Date("2026-10-21T14:00:00Z"),
      status: "CONFIRMED",
      paymentStatus: "HELD",
      amount: 250,
      address: "Rua Israel Pinheiro, 2100, Centro, GV",
      client: {
        id: "client-1",
        name: "Roberta Valadares",
        phone: "33999998888",
      },
      service: {
        id: "srv-1",
        title: "Instalação de Padrão CEMIG",
        basePrice: 250,
      },
    },
    {
      id: "booking-cache-2",
      scheduledAt: new Date("2026-10-21T16:30:00Z"),
      status: "PENDING",
      paymentStatus: "PENDING",
      amount: 120,
      address: "Av. Minas Gerais, 450, Ilha dos Araújos, GV",
      client: {
        id: "client-2",
        name: "Felipe Mendes",
      },
      service: {
        id: "srv-2",
        title: "Troca de Disjuntor",
        basePrice: 120,
      },
    },
  ]

  beforeEach(async () => {
    vi.restoreAllMocks()
    await clearOfflineBookingsCache()
  })

  afterEach(async () => {
    await clearOfflineBookingsCache()
  })

  it("armazena agendamentos e recupera com metadados de sincronização", async () => {
    await cacheOfflineBookings(sampleBookings)

    const result = await getCachedOfflineBookings()
    expect(result.items).toHaveLength(2)
    expect(result.items[0].id).toBe("booking-cache-1")
    expect(result.items[0].client.name).toBe("Roberta Valadares")
    expect(result.items[0].service.title).toBe("Instalação de Padrão CEMIG")
    expect(result.lastSyncAt).toBeGreaterThan(0)
    expect(["indexeddb", "localStorage", "memory"]).toContain(result.source)
  })

  it("recupera agendamentos com endereço e status de custódia preservados", async () => {
    await cacheOfflineBookings(sampleBookings)

    const result = await getCachedOfflineBookings()
    const first = result.items.find((b) => b.id === "booking-cache-1")
    expect(first).toBeDefined()
    expect(first?.address).toContain("Israel Pinheiro")
    expect(first?.paymentStatus).toBe("HELD")
    expect(first?.amount).toBe(250)
  })

  it("retorna lista vazia e source 'empty' quando o cache é limpo", async () => {
    await cacheOfflineBookings(sampleBookings)
    await clearOfflineBookingsCache()

    const result = await getCachedOfflineBookings()
    expect(result.items).toHaveLength(0)
    expect(result.source).toBe("empty")
  })
})
