import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@/__tests__/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { BookingGridCard } from "@/components/client/booking-grid-card"
import { BookingDetailsDialog } from "@/components/client/booking-details-dialog"
import type { Booking } from "@/components/client/client-bookings"

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
}))

import { apiGet } from "@/lib/api"

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
      },
    },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const sampleBooking: Booking = {
  id: "bk-101",
  status: "CONFIRMED",
  scheduledAt: "2026-11-01T14:00:00.000Z",
  amount: 250,
  quantity: 1,
  unit: "HORA",
  paymentMethod: "PIX",
  paymentStatus: "HELD",
  address: "Rua das Flores, 123",
  cep: "35010-000",
  service: {
    id: "srv-101",
    title: "Instalação Elétrica Residencial",
    basePrice: 250,
    unit: "HORA",
    category: { id: "cat-1", name: "Elétrica" },
  },
  provider: {
    id: "prv-101",
    name: "Carlos Eletricista",
    avatarUrl: null,
    whatsapp: "33999998888",
  },
  reviews: [],
}

describe("BookingGridCard", () => {
  afterEach(cleanup)

  it("renders booking grid card with provider name, title and amount", () => {
    const onViewDetails = vi.fn()
    const onCancel = vi.fn()
    const onComplete = vi.fn()
    const onReview = vi.fn()
    const onMessage = vi.fn()
    const onViewProvider = vi.fn()

    render(
      <BookingGridCard
        booking={sampleBooking}
        onViewDetails={onViewDetails}
        onCancel={onCancel}
        onComplete={onComplete}
        onReview={onReview}
        onMessage={onMessage}
        onViewProvider={onViewProvider}
        isCompleting={false}
      />,
    )

    expect(screen.getByText("Carlos Eletricista")).toBeInTheDocument()
    expect(screen.getByText("Instalação Elétrica Residencial")).toBeInTheDocument()
    expect(screen.getByText("R$ 250,00")).toBeInTheDocument()
  })

  it("triggers onComplete when Liberar button is clicked", () => {
    const onComplete = vi.fn()
    render(
      <BookingGridCard
        booking={sampleBooking}
        onViewDetails={vi.fn()}
        onCancel={vi.fn()}
        onComplete={onComplete}
        onReview={vi.fn()}
        onMessage={vi.fn()}
        onViewProvider={vi.fn()}
        isCompleting={false}
      />,
    )

    const completeBtn = screen.getByRole("button", { name: /liberar custódia/i })
    fireEvent.click(completeBtn)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})

describe("BookingDetailsDialog", () => {
  afterEach(cleanup)

  it("renders dialog details when bookingId is provided", async () => {
    vi.mocked(apiGet).mockResolvedValueOnce({ booking: sampleBooking })
    const onOpenChange = vi.fn()

    renderWithQuery(<BookingDetailsDialog bookingId="bk-101" onOpenChange={onOpenChange} />)

    expect(screen.getByText(/detalhes do agendamento/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText("Carlos Eletricista")).toBeInTheDocument()
    })
    expect(screen.getByText("Rua das Flores, 123")).toBeInTheDocument()
    expect(screen.getByText("35010-000")).toBeInTheDocument()
  })

  it("does not render dialog content when bookingId is null", () => {
    renderWithQuery(<BookingDetailsDialog bookingId={null} onOpenChange={vi.fn()} />)

    expect(screen.queryByText(/detalhes do agendamento/i)).not.toBeInTheDocument()
  })
})
