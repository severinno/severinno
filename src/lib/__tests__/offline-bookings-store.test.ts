import { describe, it, expect, beforeEach } from "vitest"
import {
  saveOfflineBookings,
  getOfflineBookings,
  getOfflineBookingById,
  updateOfflineBookingStatus,
  clearOfflineBookings,
  type OfflineBooking,
} from "@/lib/offline-bookings-store"

const mockBooking: OfflineBooking = {
  id: "booking-1",
  code: "SEV-1024",
  serviceTitle: "Instalação Elétrica Residencial",
  scheduledAt: "2026-10-16T15:00:00Z",
  status: "CONFIRMED",
  amount: 250,
  address: "Rua Israel Pinheiro, 2450",
  neighborhood: "Centro",
  city: "Governador Valadares",
  contactName: "Carlos Silva",
  contactPhone: "33999998888",
  contactRole: "PROVIDER",
  completionPin: "4821",
  notes: "Interfone 201",
  cachedAt: Date.now(),
}

describe("offline-bookings-store", () => {
  beforeEach(async () => {
    await clearOfflineBookings()
  })

  it("salva e recupera agendamentos ativos da memória e do storage local", async () => {
    await saveOfflineBookings([mockBooking])

    const stored = await getOfflineBookings()
    expect(stored).toHaveLength(1)
    expect(stored[0].id).toBe("booking-1")
    expect(stored[0].code).toBe("SEV-1024")
    expect(stored[0].serviceTitle).toBe("Instalação Elétrica Residencial")
    expect(stored[0].completionPin).toBe("4821")
  })

  it("busca agendamento por ID", async () => {
    await saveOfflineBookings([mockBooking])

    const found = await getOfflineBookingById("booking-1")
    expect(found).not.toBeNull()
    expect(found?.contactName).toBe("Carlos Silva")

    const notFound = await getOfflineBookingById("inexistent-id")
    expect(notFound).toBeNull()
  })

  it("atualiza status de um agendamento offline", async () => {
    await saveOfflineBookings([mockBooking])

    const updated = await updateOfflineBookingStatus("booking-1", "IN_PROGRESS")
    expect(updated).toBe(true)

    const found = await getOfflineBookingById("booking-1")
    expect(found?.status).toBe("IN_PROGRESS")
  })

  it("limpa todos os agendamentos salvos", async () => {
    await saveOfflineBookings([mockBooking])
    await clearOfflineBookings()

    const stored = await getOfflineBookings()
    expect(stored).toHaveLength(0)
  })
})
