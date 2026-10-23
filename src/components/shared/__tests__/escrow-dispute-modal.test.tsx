import * as React from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@/__tests__/test-utils"
import { EscrowDisputeModal } from "../escrow-dispute-modal"

// Mock haptics
vi.mock("@/lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}))

// Mock sonner
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

describe("EscrowDisputeModal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it("renders dispute dialog with title and Escrow protection banner", () => {
    render(
      <EscrowDisputeModal
        open={true}
        onOpenChange={vi.fn()}
        bookingId="b-101"
        serviceTitle="Instalação de Chuveiro"
        providerName="Carlos Eletricista"
        amount={180}
      />,
    )

    expect(screen.getByText("Contestar Serviço & Escrow")).toBeDefined()
    expect(screen.getByText(/Carlos Eletricista/)).toBeDefined()
    expect(screen.getByText(/R\$ 180\.00/)).toBeDefined()
    expect(screen.getByText("Qualidade Insatisfatória")).toBeDefined()
    expect(screen.getByText("Dano ou Avaria Material")).toBeDefined()
  })

  it("prevents submission when reason is shorter than 10 characters", async () => {
    render(
      <EscrowDisputeModal
        open={true}
        onOpenChange={vi.fn()}
        bookingId="b-101"
        serviceTitle="Instalação de Chuveiro"
        providerName="Carlos Eletricista"
        amount={180}
      />,
    )

    const textarea = screen.getByPlaceholderText(/Explique o que aconteceu/i)
    fireEvent.change(textarea, { target: { value: "Ruim" } })

    const submitBtn = screen.getByRole("button", { name: /Congelar Custódia & Abrir Disputa/i })
    expect(submitBtn).toBeDisabled()
  })

  it("submits dispute successfully with category and reason", async () => {
    const onSuccess = vi.fn()
    const onOpenChange = vi.fn()

    ;(global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, dispute: { id: "disp-1" } }),
    })

    render(
      <EscrowDisputeModal
        open={true}
        onOpenChange={onOpenChange}
        bookingId="b-101"
        serviceTitle="Instalação de Chuveiro"
        providerName="Carlos Eletricista"
        amount={180}
        onSuccess={onSuccess}
      />,
    )

    // Select category "Dano ou Avaria Material"
    const damageBtn = screen.getByText("Dano ou Avaria Material")
    fireEvent.click(damageBtn)

    const textarea = screen.getByPlaceholderText(/Explique o que aconteceu/i)
    fireEvent.change(textarea, {
      target: { value: "O prestador quebrou o azulejo do banheiro durante o serviço." },
    })

    const submitBtn = screen.getByRole("button", { name: /Congelar Custódia & Abrir Disputa/i })
    expect(submitBtn).not.toBeDisabled()
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/bookings/b-101/dispute",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining("DAMAGED"),
        }),
      )
      expect(onSuccess).toHaveBeenCalled()
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })
})
