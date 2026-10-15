import { describe, it, expect, vi, afterEach } from "vitest"
import * as React from "react"
import { render, screen, fireEvent, cleanup } from "@/__tests__/test-utils"
import { InstantQuoteStepWizard } from "../instant-quote-step-wizard"
import { GvReelsShowcase } from "../gv-reels-showcase"
import { FipeServicesIndex } from "../fipe-services-index"
import { DigitalContractGenerator } from "../digital-contract-generator"

afterEach(() => {
  cleanup()
})

describe("InstantQuoteStepWizard", () => {
  it("renders step 1 with categories and GV neighborhoods", () => {
    render(<InstantQuoteStepWizard />)
    expect(
      screen.getByRole("region", { name: "Orçamentômetro Instantâneo em 3 Passos" }),
    ).toBeDefined()
    expect(screen.getByText("Eletricista")).toBeDefined()
    expect(screen.getByText("Encanador")).toBeDefined()
    expect(screen.getByText("Centro")).toBeDefined()
    expect(screen.getByText("Avançar para Detalhes")).toBeDefined()
  })

  it("navigates through step 1 -> step 2 -> step 3 and displays WhatsApp CTA", () => {
    const onFilterMock = vi.fn()
    render(<InstantQuoteStepWizard onFilterResults={onFilterMock} />)

    // Step 1 -> Step 2
    fireEvent.click(screen.getByText("Avançar para Detalhes"))
    expect(screen.getByText("O que precisa ser feito em Eletricista?")).toBeDefined()

    // Step 2 -> Step 3
    fireEvent.click(screen.getByText("Ver Estimativa & Disparar"))
    expect(screen.getByText(/Estimativa Média de Valor em Governador Valadares/i)).toBeDefined()
    expect(screen.getByText(/Disparar Cotação Pronta no WhatsApp Agora/i)).toBeDefined()

    // Test secondary filter action
    const filterBtn = screen.getByText(/Ver Prestadores de Eletricista Disponíveis na Vitrine/i)
    fireEvent.click(filterBtn)
    expect(onFilterMock).toHaveBeenCalledWith(expect.stringContaining("Eletricista"))
  })
})

describe("GvReelsShowcase", () => {
  it("renders horizontal reels cards with live badges and views count", () => {
    render(<GvReelsShowcase />)
    expect(
      screen.getByRole("region", { name: "Reels de Serviços Reais em Governador Valadares" }),
    ).toBeDefined()
    expect(screen.getByText(/Transformação Completa de Quadro Antigo/i)).toBeDefined()
    expect(screen.getByText("Ilha dos Araújos")).toBeDefined()
  })

  it("opens immersive modal on card click and closes on close button", () => {
    render(<GvReelsShowcase />)
    const card = screen.getByText(/Transformação Completa de Quadro Antigo/i)
    fireEvent.click(card)

    expect(screen.getByRole("dialog")).toBeDefined()
    expect(screen.getByText(/Resultado Comprovado em Ilha dos Araújos/i)).toBeDefined()
    expect(screen.getByText("Contratar via WhatsApp")).toBeDefined()

    // Find and click close button
    const closeBtn = screen.getByTestId("close-reel-modal")
    fireEvent.click(closeBtn)
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("FipeServicesIndex", () => {
  it("renders price benchmark gauge with zones and diagnostics", () => {
    render(<FipeServicesIndex />)
    expect(
      screen.getByRole("region", { name: "Tabela FIPE dos Serviços de Governador Valadares" }),
    ).toBeDefined()
    expect(screen.getAllByText(/Instalação \/ Troca de Chuveiro Elétrico/i)[0]).toBeDefined()
    expect(screen.getByText(/Zona de Risco/i)).toBeDefined()
    expect(screen.getByText(/Faixa Justa de GV/i)).toBeDefined()
  })

  it("switches benchmark service and triggers onFilterService", () => {
    const onFilterMock = vi.fn()
    render(<FipeServicesIndex onFilterService={onFilterMock} />)

    // Select second benchmark (Limpeza de Ar Split)
    const arPill = screen.getByText(/Limpeza & Higienização de Ar Split/i)
    fireEvent.click(arPill)

    expect(screen.getByText(/Lavagem superficial apenas de filtro de tela/i)).toBeDefined()

    const filterBtn = screen.getByText("Ver Profissionais com Preço Justo")
    fireEvent.click(filterBtn)
    expect(onFilterMock).toHaveBeenCalledWith(expect.stringContaining("Ar Split"))
  })
})

describe("DigitalContractGenerator", () => {
  it("renders live contract preview and updates on input change", () => {
    render(<DigitalContractGenerator />)
    expect(
      screen.getByRole("region", { name: "Gerador de Pré-Contrato Digital e Recibo Oficial" }),
    ).toBeDefined()
    expect(screen.getByText(/TERMO OFICIAL DE CONTRATAÇÃO & GARANTIA RESIDENCIAL/i)).toBeDefined()
    expect(screen.getByText("Mariana Silveira")).toBeDefined()

    // Change client name
    const input = screen.getByPlaceholderText("Ex: Seu Nome Completo")
    fireEvent.change(input, { target: { value: "Roberto Carlos" } })
    expect(screen.getAllByText("Roberto Carlos").length).toBeGreaterThan(0)
  })

  it("triggers clipboard copy on button click", () => {
    // Mock navigator.clipboard
    const writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    })

    render(<DigitalContractGenerator />)
    const copyBtn = screen.getByText("Copiar Texto da Minuta")
    fireEvent.click(copyBtn)
    expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining("MINUTA DE CONTRATO"))
  })
})
