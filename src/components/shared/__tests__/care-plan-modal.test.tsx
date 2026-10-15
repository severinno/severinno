import * as React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup, waitFor } from "@/__tests__/test-utils"
import { CarePlanModal } from "../care-plan-modal"

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>()
  const MockIcon = (props: any) => <span data-testid="mock-icon" {...props} />
  return {
    ...actual,
    CalendarDays: MockIcon,
    Sparkles: MockIcon,
    ShieldCheck: MockIcon,
    CheckCircle2: MockIcon,
    Tag: MockIcon,
    Loader2: MockIcon,
    Clock: MockIcon,
    MapPin: MockIcon,
    HeartHandshake: MockIcon,
  }
})

describe("CarePlanModal Component", () => {
  const defaultService = {
    id: "srv-clean-123",
    title: "Faxina Residencial Completa",
    basePrice: 200,
    providerId: "prov-maria-456",
    providerName: "Maria Faxinas",
  }

  const mockOnClose = vi.fn()
  const mockOnSuccess = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    cleanup()
  })

  it("renders modal with default weekly 15% discount and pricing breakdown", () => {
    render(
      <CarePlanModal
        isOpen={true}
        onClose={mockOnClose}
        service={defaultService}
        defaultAddress="Rua Peçanha, 100 - Centro, GV"
      />,
    )

    expect(screen.getByText("Plano de Cuidado Residencial")).toBeInTheDocument()
    expect(screen.getByText("15% OFF")).toBeInTheDocument()
    expect(screen.getByText("10% OFF")).toBeInTheDocument()
    expect(screen.getByText("7% OFF")).toBeInTheDocument()
    expect(screen.getByText("5% OFF")).toBeInTheDocument()

    // 200 with 15% discount = 170
    expect(screen.getByText(/170/)).toBeInTheDocument()
    expect(screen.getByText(/Local: Rua Peçanha/)).toBeInTheDocument()
  })

  it("updates pricing breakdown when user switches to Biweekly (10% OFF)", () => {
    render(<CarePlanModal isOpen={true} onClose={mockOnClose} service={defaultService} />)

    // Click on Quinzenal button
    const biweeklyBtn = screen.getByRole("button", { name: /Quinzenal/i })
    fireEvent.click(biweeklyBtn)

    // 200 with 10% discount = 180
    expect(screen.getByText(/180/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Ativar Plano \(10% OFF\)/i })).toBeInTheDocument()
  })

  it("successfully submits subscription and calls onSuccess callback", async () => {
    const mockResponse = {
      ok: true,
      firstBookingId: "bk-first-123",
      subscriptionId: "sub-care-999",
      message: "Plano ativado",
    }

    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    })

    render(
      <CarePlanModal
        isOpen={true}
        onClose={mockOnClose}
        service={defaultService}
        onSuccess={mockOnSuccess}
      />,
    )

    const submitBtn = screen.getByRole("button", { name: /Ativar Plano/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/subscriptions",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("srv-clean-123"),
        }),
      )
      expect(mockOnSuccess).toHaveBeenCalledWith("bk-first-123")
      expect(mockOnClose).toHaveBeenCalled()
    })
  })
})
