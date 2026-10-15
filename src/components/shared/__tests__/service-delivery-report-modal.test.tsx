import * as React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@/__tests__/test-utils"

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>()
  const MockIcon = (props: any) => <span data-testid="mock-icon" {...props} />
  return {
    ...actual,
    ClipboardCheck: MockIcon,
    Camera: MockIcon,
    CheckCircle2: MockIcon,
    ShieldCheck: MockIcon,
    AlertTriangle: MockIcon,
    ArrowRight: MockIcon,
    ArrowLeft: MockIcon,
    Plus: MockIcon,
    Trash2: MockIcon,
    Check: MockIcon,
    Sparkles: MockIcon,
    FileCheck2: MockIcon,
    Share2: MockIcon,
    Copy: MockIcon,
    Loader2: MockIcon,
    UploadCloud: MockIcon,
    X: MockIcon,
  }
})

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

import { ServiceDeliveryReportModal } from "../service-delivery-report-modal"
import { toast } from "sonner"

describe("ServiceDeliveryReportModal — Checklist Guiado & Laudo Fotográfico (Zero Disputas)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, message: "Sucesso" }),
    } as any)
  })

  afterEach(() => {
    cleanup()
  })

  it("renderiza o modal com título do serviço, stepper e orientações da Heurística #5", () => {
    render(
      <ServiceDeliveryReportModal
        open={true}
        onOpenChange={vi.fn()}
        bookingId="bk-123"
        serviceTitle="Instalação de Válvula Hidráulica"
        serviceCategory="hidraulica"
        clientName="Maria Souza"
        providerName="Carlos Silva"
      />,
    )

    expect(screen.getByText("Checklist Guiado & Laudo Fotográfico")).toBeDefined()
    expect(screen.getByText(/Instalação de Válvula Hidráulica/i)).toBeDefined()
    expect(screen.getByText(/Prevenção de Disputas/i)).toBeDefined()
    expect(screen.getByText(/1\. Antes/i)).toBeDefined()
    expect(screen.getByText(/2\. Checklist/i)).toBeDefined()
    expect(screen.getByText(/3\. Laudo & Depois/i)).toBeDefined()
  })

  it("impede avanço sem ao menos uma foto do Antes (Heurística #5 - Prevenção de Erros)", () => {
    const { rerender } = render(
      <ServiceDeliveryReportModal
        open={true}
        onOpenChange={vi.fn()}
        bookingId="bk-123"
        serviceTitle="Instalação de Válvula Hidráulica"
        initialBeforePhotos={[]}
      />,
    )

    const nextBtn = screen.getByText(/Salvar Antes e Ir para Checklist/i).closest("button")
    expect(nextBtn?.disabled).toBe(true)

    // Ao prover ao menos 1 foto, o botão deve se habilitar
    rerender(
      <ServiceDeliveryReportModal
        open={true}
        onOpenChange={vi.fn()}
        bookingId="bk-123"
        serviceTitle="Instalação de Válvula Hidráulica"
        initialBeforePhotos={["https://s3.severinno.com/before.jpg"]}
      />,
    )

    const enabledBtn = screen.getByText(/Salvar Antes e Ir para Checklist/i).closest("button")
    expect(enabledBtn?.disabled).toBe(false)
  })

  it("avança para o checklist técnico e permite marcar itens e adicionar item customizado", () => {
    render(
      <ServiceDeliveryReportModal
        open={true}
        onOpenChange={vi.fn()}
        bookingId="bk-123"
        serviceTitle="Reparo Elétrico no Quadro Geral"
        serviceCategory="eletrica"
        initialBeforePhotos={["https://s3.severinno.com/before1.jpg"]}
      />,
    )

    // Clicar na aba 2 do stepper
    const step2Btn = screen.getByText(/2\. Checklist/i)
    fireEvent.click(step2Btn)

    expect(screen.getByText(/Progresso do Checklist/i)).toBeDefined()
    expect(screen.getByText(/Quadro geral desenergizado/i)).toBeDefined()

    // Clicar para alternar o checkbox
    const item = screen.getByText(/Quadro geral desenergizado/i)
    fireEvent.click(item)

    // Adicionar item customizado
    const input = screen.getByPlaceholderText(/Adicionar item técnico específico/i)
    fireEvent.change(input, { target: { value: "Lacre de segurança afixado" } })
    const addBtn = screen.getByText("Adicionar")
    fireEvent.click(addBtn)

    expect(screen.getByText("Lacre de segurança afixado")).toBeDefined()
    expect(toast.success).toHaveBeenCalledWith("Item personalizado adicionado ao checklist!")
  })

  it("renderiza laudo final com código pericial e botões de compartilhamento", () => {
    render(
      <ServiceDeliveryReportModal
        open={true}
        onOpenChange={vi.fn()}
        bookingId="bk-999"
        serviceTitle="Troca de Fechadura Tetra"
        serviceCategory="chaveiro"
        initialBeforePhotos={["https://s3.severinno.com/before.jpg"]}
        initialAfterPhotos={["https://s3.severinno.com/after.jpg"]}
        initialNotes="Fechadura Pado instalada com 2 vias de chaves entregues ao cliente."
      />,
    )

    // Clicar no Step 3
    const step3Btn = screen.getByText(/3\. Laudo & Depois/i)
    fireEvent.click(step3Btn)

    expect(screen.getByText(/Comparador Antes vs Depois/i)).toBeDefined()
    expect(screen.getByText(/Dossiê Pericial Anti-Disputas/i)).toBeDefined()
    expect(screen.getByText(/Compartilhar no WhatsApp/i)).toBeDefined()
    expect(screen.getByText(/Copiar Texto do Laudo/i)).toBeDefined()
  })
})
