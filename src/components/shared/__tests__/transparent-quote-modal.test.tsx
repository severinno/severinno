import * as React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@/__tests__/test-utils"
import { TransparentQuoteModal } from "../transparent-quote-modal"
import type { TransparentQuoteBreakdown } from "@/lib/materials-breakdown"

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>()
  const MockIcon = (props: any) => <span data-testid="mock-icon" {...props} />
  return {
    ...actual,
    Wrench: MockIcon,
    Package: MockIcon,
    Store: MockIcon,
    ShieldCheck: MockIcon,
    Plus: MockIcon,
    Trash2: MockIcon,
    ExternalLink: MockIcon,
    MessageCircle: MockIcon,
    Copy: MockIcon,
    Check: MockIcon,
    MapPin: MockIcon,
    Tag: MockIcon,
  }
})

describe("TransparentQuoteModal Component", () => {
  const mockOnOpenChange = vi.fn()
  const mockOnSave = vi.fn()

  const sampleBreakdown: TransparentQuoteBreakdown = {
    laborCost: 150,
    materialsCost: 80,
    payer: "CLIENT",
    suggestedStoreId: "construgil-ilha",
    materials: [
      { id: "mat-1", name: "Registro de Gaveta 3/4", quantity: 1, unit: "un", estimatedPrice: 50 },
      { id: "mat-2", name: "Fita Veda Rosca", quantity: 2, unit: "un", estimatedPrice: 15 },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it("renders in compose mode and allows provider to input labor cost, add material, and save", () => {
    render(
      <TransparentQuoteModal
        open={true}
        onOpenChange={mockOnOpenChange}
        mode="compose"
        serviceTitle="Troca de Registro e Canos"
        serviceCategory="Hidráulica"
        onSave={mockOnSave}
      />,
    )

    expect(screen.getByText("Orçamento Transparente: Mão de Obra vs Materiais")).toBeInTheDocument()
    expect(screen.getByText("100% Protegido no Escrow")).toBeInTheDocument()

    // Enter labor cost
    const laborInput = screen.getByPlaceholderText("Ex: 150,00")
    fireEvent.change(laborInput, { target: { value: "200" } })

    // Add material item
    const nameInput = screen.getByPlaceholderText("Nome do material (ex: Tubo PVC)")
    const priceInput = screen.getByPlaceholderText("R$ est.")
    fireEvent.change(nameInput, { target: { value: "Tubo PVC Tigre" } })
    fireEvent.change(priceInput, { target: { value: "45" } })

    const addBtn = screen.getByRole("button", { name: /Adicionar Item à Lista/i })
    fireEvent.click(addBtn)

    expect(screen.getByText("Tubo PVC Tigre")).toBeInTheDocument()

    // Confirm and save
    const confirmBtn = screen.getByRole("button", { name: /Confirmar Discriminação/i })
    fireEvent.click(confirmBtn)

    expect(mockOnSave).toHaveBeenCalledWith(
      expect.objectContaining({
        laborCost: 200,
        materialsCost: 45,
        payer: "CLIENT",
      }),
      245,
    )
    expect(mockOnOpenChange).toHaveBeenCalledWith(false)
  })

  it("renders in view mode showing Escrow protection, materials list and GV partner store", () => {
    render(
      <TransparentQuoteModal
        open={true}
        onOpenChange={mockOnOpenChange}
        mode="view"
        serviceTitle="Instalação de Chuveiro e Troca de Fiação"
        serviceCategory="Elétrica"
        initialBreakdown={sampleBreakdown}
      />,
    )

    expect(screen.getByText("Discriminação Transparente do Orçamento")).toBeInTheDocument()
    expect(screen.getByText("Protegido no Escrow")).toBeInTheDocument()
    expect(screen.getByText("Registro de Gaveta 3/4")).toBeInTheDocument()
    expect(screen.getByText("Fita Veda Rosca")).toBeInTheDocument()

    // GV Partner store section
    expect(screen.getByText("Onde Comprar em Governador Valadares")).toBeInTheDocument()
    expect(screen.getByText(/Construgil Materiais/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Chamar no WhatsApp/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Ver no Google Maps/i })).toBeInTheDocument()
  })
})
