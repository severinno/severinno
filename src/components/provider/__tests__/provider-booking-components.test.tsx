import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@/__tests__/test-utils"
import { BookingCard, BookingActions } from "@/components/provider/provider-booking-card"
import { BookingDetailsDialog } from "@/components/provider/provider-booking-details-dialog"
import type { Booking } from "@/components/provider/provider-bookings"

const sampleProviderBooking: Booking = {
  id: "bk-201",
  clientId: "cli-201",
  providerId: "prv-201",
  serviceId: "srv-201",
  scheduledAt: "2026-11-02T10:00:00.000Z",
  status: "PENDING",
  address: "Rua Marechal Floriano, 450",
  cep: "35010-140",
  lat: -18.854,
  lng: -41.945,
  amount: 180,
  quantity: 1,
  unit: "HORA",
  paymentMethod: "PIX",
  paymentStatus: "PENDING",
  notes: "Campainha não funciona, favor bater no portão",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  service: {
    id: "srv-201",
    title: "Manutenção Hidráulica",
    basePrice: 180,
    unit: "HORA",
  },
  client: {
    id: "cli-201",
    name: "Mariana Souza",
    avatarUrl: null,
  },
}

describe("Provider BookingCard & BookingActions", () => {
  afterEach(cleanup)

  it("renders mobile booking card with client name and title", () => {
    const onDetail = vi.fn()
    const onConfirm = vi.fn()

    render(
      <BookingCard
        booking={sampleProviderBooking}
        actioning={false}
        onDetail={onDetail}
        onMessage={vi.fn()}
        onConfirm={onConfirm}
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText("Mariana Souza")).toBeInTheDocument()
    expect(screen.getByText("Manutenção Hidráulica")).toBeInTheDocument()
    expect(screen.getByText("R$ 180,00")).toBeInTheDocument()
  })

  it("triggers onConfirm when Confirmar is clicked in BookingActions", () => {
    const onConfirm = vi.fn()

    render(
      <BookingActions
        booking={sampleProviderBooking}
        actioning={false}
        onDetail={vi.fn()}
        onMessage={vi.fn()}
        onConfirm={onConfirm}
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    const confirmBtn = screen.getByRole("button", { name: /confirmar/i })
    fireEvent.click(confirmBtn)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

describe("Provider BookingDetailsDialog", () => {
  afterEach(cleanup)

  it("renders booking details modal when open is true", () => {
    const onOpenChange = vi.fn()

    render(
      <BookingDetailsDialog
        booking={sampleProviderBooking}
        open={true}
        onOpenChange={onOpenChange}
        onMessage={vi.fn()}
      />,
    )

    expect(screen.getByText("Detalhes do Agendamento")).toBeInTheDocument()
    expect(screen.getByText("Mariana Souza")).toBeInTheDocument()
    expect(screen.getByText("Rua Marechal Floriano, 450")).toBeInTheDocument()
    expect(screen.getByText(/Campainha não funciona/i)).toBeInTheDocument()
  })

  it("does not render dialog content when booking is null", () => {
    render(
      <BookingDetailsDialog
        booking={null}
        open={true}
        onOpenChange={vi.fn()}
        onMessage={vi.fn()}
      />,
    )

    expect(screen.queryByText("Detalhes do Agendamento")).not.toBeInTheDocument()
  })
})
