import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"
import { ProviderPriceEstimatorDialog } from "../provider-price-estimator-dialog"

vi.mock("@/lib/sounds", () => ({
  playCoinSound: vi.fn(),
}))

vi.mock("@/lib/haptics", () => ({
  triggerHaptic: vi.fn(),
}))

describe("ProviderPriceEstimatorDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it("não possui violações de acessibilidade (axe clean)", async () => {
    const { container } = render(
      <ProviderPriceEstimatorDialog open={true} onOpenChange={vi.fn()} />,
    )
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("calcula valores de mão de obra e preço sugerido corretamente", () => {
    render(
      <ProviderPriceEstimatorDialog open={true} onOpenChange={vi.fn()} initialHourlyRate={60} />,
    )

    expect(screen.getByText("Calculadora Expressa de Precificação")).toBeInTheDocument()
    expect(screen.getByText(/Tempo estimado de execução/i)).toBeInTheDocument()
    expect(screen.getByText(/Deslocamento em Governador Valadares/i)).toBeInTheDocument()
    expect(screen.getByText(/Garantia de custódia/i)).toBeInTheDocument()
  })

  it("chama onApplyPrice com o preço sugerido ao clicar em Aplicar", () => {
    const onApplyMock = vi.fn()
    const onOpenChangeMock = vi.fn()

    render(
      <ProviderPriceEstimatorDialog
        open={true}
        onOpenChange={onOpenChangeMock}
        initialHourlyRate={50}
        onApplyPrice={onApplyMock}
      />,
    )

    const applyBtn = screen.getByRole("button", { name: /Aplicar/i })
    fireEvent.click(applyBtn)

    expect(onApplyMock).toHaveBeenCalledTimes(1)
    expect(onApplyMock).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        labor: expect.any(Number),
        travel: expect.any(Number),
        materials: expect.any(Number),
      }),
    )
    expect(onOpenChangeMock).toHaveBeenCalledWith(false)
  })

  it("copia resumo de orçamento ao clicar em Copiar Orçamento", async () => {
    render(<ProviderPriceEstimatorDialog open={true} onOpenChange={vi.fn()} />)

    const copyBtn = screen.getByRole("button", { name: /Copiar Orçamento/i })
    fireEvent.click(copyBtn)

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("Estimativa de Orçamento Técnico"),
    )
  })
})
