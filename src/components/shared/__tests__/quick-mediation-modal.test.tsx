import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@/__tests__/test-utils"
import { QuickMediationModal } from "../quick-mediation-modal"

vi.mock("@/lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("QuickMediationModal", () => {
  it("renders with delay presets and default title", () => {
    render(
      <QuickMediationModal
        open={true}
        onOpenChange={vi.fn()}
        bookingId="booking-123"
        serviceTitle="Instalação Elétrica"
        peerName="Carlos Cliente"
        userRole="PROVIDER"
      />,
    )

    expect(screen.getByText("Resolução Ágil de Imprevistos")).toBeDefined()
    expect(screen.getByText("+15m")).toBeDefined()
    expect(screen.getByText("+30m")).toBeDefined()
    expect(screen.getByText("+45m")).toBeDefined()
    expect(screen.getByText("+60m")).toBeDefined()
    expect(screen.getByText("Enviar Aviso de Atraso")).toBeDefined()
  })

  it("submits delay notification successfully", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    })
    globalThis.fetch = fetchMock

    const onSuccess = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <QuickMediationModal
        open={true}
        onOpenChange={onOpenChange}
        bookingId="booking-123"
        peerName="Carlos Cliente"
        onSuccess={onSuccess}
      />,
    )

    const btn = screen.getByText("Enviar Aviso de Atraso")
    fireEvent.click(btn)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/bookings/booking-123/mediate",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ action: "notify_delay", delayMinutes: 15 }),
        }),
      )
      expect(onSuccess).toHaveBeenCalled()
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it("renders scope adjustment tab only for providers", () => {
    const { unmount } = render(
      <QuickMediationModal
        open={true}
        onOpenChange={vi.fn()}
        bookingId="booking-123"
        userRole="CLIENT"
      />,
    )

    expect(screen.queryByText("Peça / Escopo")).toBeNull()
    unmount()

    render(
      <QuickMediationModal
        open={true}
        onOpenChange={vi.fn()}
        bookingId="booking-123"
        userRole="PROVIDER"
      />,
    )
    expect(screen.getByText("Peça / Escopo")).toBeDefined()
  })

  it("passes axe accessibility checks with 0 violations", async () => {
    const { axe } = await import("vitest-axe")
    const { container } = render(
      <QuickMediationModal open={true} onOpenChange={vi.fn()} bookingId="booking-123" />,
    )

    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
