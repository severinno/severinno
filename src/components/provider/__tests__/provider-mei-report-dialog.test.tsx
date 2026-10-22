import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/__tests__/test-utils"

import { ProviderMeiReportDialog } from "../provider-mei-report-dialog"

const mockTriggerHaptic = vi.fn()
vi.mock("@/lib/haptics", () => ({
  triggerHaptic: (...args: unknown[]) => mockTriggerHaptic(...args),
}))

describe("ProviderMeiReportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          dre: {
            providerName: "João Prestador",
            totalBookings: 8,
            grossRevenue: 2400.0,
            platformFees: 288.0,
            netRevenue: 2112.0,
            escrowReleased: 2112.0,
            ytdGross: 14500.0,
            meiAnnualLimit: 81000.0,
            meiPercentUsed: 17.9,
            isWithinMeiLimit: true,
          },
        }),
      }),
    )
  })

  it("renders report title and competency when open", async () => {
    render(<ProviderMeiReportDialog open={true} onOpenChange={vi.fn()} />)

    expect(screen.getByText("Demonstrativo Mensal & Extrato MEI")).toBeInTheDocument()
    expect(screen.getByText("Mês de Competência")).toBeInTheDocument()
    expect(await screen.findByText("Faturamento Bruto")).toBeInTheDocument()
    expect(screen.getByText("Taxa da Plataforma (12%)")).toBeInTheDocument()
    expect(screen.getByText("Receita Líquida Recebida")).toBeInTheDocument()
  })

  it("triggers window.open on 'Imprimir / Salvar PDF'", async () => {
    const windowOpenSpy = vi.spyOn(window, "open").mockImplementation(() => null)

    render(<ProviderMeiReportDialog open={true} onOpenChange={vi.fn()} />)

    const printBtn = screen.getByRole("button", {
      name: /Imprimir \/ Salvar PDF/i,
    })
    fireEvent.click(printBtn)

    expect(mockTriggerHaptic).toHaveBeenCalledWith("selection")
    expect(windowOpenSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/provider/reports?type=dre"),
      "_blank",
    )
  })
})
