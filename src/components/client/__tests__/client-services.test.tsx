/**
 * Tests for ClientServices — historical and warranty view of services.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

// ---- Builder --------------------------------------------------------------

function buildBooking(
  id: string,
  overrides: Partial<{
    status: string
    amount: number
    paymentMethod: string
    providerName: string
    serviceTitle: string
    scheduledAt: string
    reviews?: Array<{ id: string; rating: number; comment?: string | null; createdAt: string }>
  }> = {},
) {
  return {
    id,
    status: overrides.status ?? "COMPLETED",
    scheduledAt: overrides.scheduledAt ?? "2026-09-26T19:48:00.000Z",
    amount: overrides.amount ?? 12000,
    paymentMethod: overrides.paymentMethod ?? "PIX",
    address: "Rua das Flores, 100",
    service: {
      id: "s-1",
      title: overrides.serviceTitle ?? "Desentupimento de ralo e pia",
      basePrice: 12000,
      unit: "FIXED",
      category: { id: "cat-1", name: "Hidráulica" },
    },
    provider: {
      id: "p-1",
      name: overrides.providerName ?? "Carlos Encanador",
      avatarUrl: null,
    },
    reviews: overrides.reviews,
  }
}

// ---- Mocks ----------------------------------------------------------------

const mockNavigate = vi.fn()
const mockOpenProvider = vi.fn()
const mockOpenBooking = vi.fn()

vi.mock("@tanstack/react-query", () => ({
  useQueries: vi.fn(),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}))

vi.mock("@/store/view", () => ({
  useViewStore: vi.fn((selector?: (s: any) => unknown) =>
    selector ? selector({ navigate: mockNavigate }) : { navigate: mockNavigate },
  ),
}))

vi.mock("@/store/ui", () => ({
  useUIStore: vi.fn((selector?: (s: any) => unknown) =>
    selector
      ? selector({ openProvider: mockOpenProvider, openBooking: mockOpenBooking })
      : { openProvider: mockOpenProvider, openBooking: mockOpenBooking },
  ),
}))

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}))

vi.mock("@/lib/format", () => ({
  formatBRL: vi.fn(
    (v: number) => `R$ ${(v / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
  ),
  formatDate: vi.fn(() => "26/09/2026"),
}))

vi.mock("@/lib/utils", () => ({
  cn: (...inputs: (string | undefined | null | false)[]) => inputs.filter(Boolean).join(" "),
}))

vi.mock("@/lib/constants", () => ({
  BOOKING_STATUS_LABELS: {
    COMPLETED: "Concluído",
    CANCELLED: "Cancelado",
    CONFIRMED: "Confirmado",
    PENDING: "Pendente",
  },
  PAYMENT_METHOD_LABELS: { PIX: "PIX", CARD: "Cartão", CASH: "Dinheiro" },
  SERVICE_UNIT_SHORT: { FIXED: "un", HOUR: "h", M2: "m²" },
}))

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}))

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
  AvatarFallback: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  AvatarImage: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}))

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({
    children,
    value,
    onValueChange: _onValueChange,
  }: {
    children: React.ReactNode
    value?: string
    onValueChange?: (v: string) => void
  }) => <div data-value={value}>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children, value }: { children: React.ReactNode; value?: string }) => (
    <button type="button" data-value={value}>
      {children}
    </button>
  ),
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({
    children,
    className,
    ...props
  }: {
    children?: React.ReactNode
    className?: string
    [key: string]: unknown
  }) => (
    <button type="button" className={className} {...props}>
      {children}
    </button>
  ),
  SelectValue: () => <span>Valor</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value?: string }) => (
    <div data-value={value}>{children}</div>
  ),
}))

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: {
    children?: React.ReactNode
    onClick?: () => void
    [key: string]: unknown
  }) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock("@/components/modals/star-rating", () => ({
  StarRatingDisplay: ({ value }: { value: number }) => (
    <div data-testid="star-rating">{value} estrelas</div>
  ),
}))

vi.mock("@/components/shared/dashboard-shell", () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
    </div>
  ),
  StatCard: ({
    label,
    value,
    hint,
  }: {
    label?: string
    value?: string
    tone?: string
    hint?: string
  }) => (
    <div data-testid="stat-card">
      <p>{label}</p>
      <p>{value}</p>
      {hint && <p>{hint}</p>}
    </div>
  ),
}))

vi.mock("@/components/shared/receipt-modal", () => ({
  ReceiptModal: ({ bookingId, open }: { bookingId: string; open: boolean }) =>
    open ? <div data-testid="receipt-modal">Receipt for {bookingId}</div> : null,
}))

vi.mock("@/components/client/review-dialog", () => ({
  ReviewDialog: ({ open, booking }: { open: boolean; booking: any }) =>
    open ? <div data-testid="review-dialog">Review for {booking?.id}</div> : null,
}))

vi.mock("@/components/client/client-shared", () => ({
  StatusBadge: ({
    children,
    tone,
    icon: _icon,
  }: {
    children?: React.ReactNode
    tone?: string
    icon?: React.ComponentType
  }) => <span data-tone={tone}>{children}</span>,
  bookingIcon: vi.fn(() => null),
  bookingTone: vi.fn(() => "emerald" as const),
}))

// ---- SUT import -----------------------------------------------------------

import { useQueries } from "@tanstack/react-query"
import { ClientServices } from "../client-services"

// ---- Helpers --------------------------------------------------------------

function mockUseQueries() {
  return vi.mocked(useQueries)
}

// ---- Tests ----------------------------------------------------------------

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("ClientServices — rendering and structure", () => {
  beforeEach(() => {
    mockUseQueries().mockReturnValue([
      {
        data: {
          items: [
            buildBooking("b-1", {
              reviews: [
                { id: "rev-1", rating: 5, comment: "Excelente serviço!", createdAt: "2026-10-16" },
              ],
            }),
            buildBooking("b-2", {
              reviews: undefined,
            }),
          ],
          total: 2,
          page: 1,
          limit: 50,
        },
        isLoading: false,
      },
      {
        data: {
          items: [buildBooking("b-3", { status: "CANCELLED" })],
          total: 1,
          page: 1,
          limit: 50,
        },
        isLoading: false,
      },
    ] as any)
  })

  it("renderiza hero banner com título, badges e ações rápidas", () => {
    render(<ClientServices />)
    expect(screen.getByText("Serviços contratados")).toBeDefined()
    expect(screen.getByText("Histórico & Garantia de Serviços")).toBeDefined()
    expect(screen.getByText("Ver agendamentos")).toBeDefined()
    expect(screen.getByText("Buscar prestadores")).toBeDefined()
  })

  it("renderiza banner de garantia legal de 90 dias", () => {
    render(<ClientServices />)
    expect(screen.getByText("Garantia Severinno de 90 Dias")).toBeDefined()
    expect(screen.getByText("Cobertura Ativa")).toBeDefined()
  })

  it("renderiza os 3 cards de resumo com contadores e total investido", () => {
    render(<ClientServices />)
    const cards = screen.getAllByTestId("stat-card")
    expect(cards.length).toBeGreaterThanOrEqual(3)
    expect(screen.getAllByText("Concluídos").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("Total Investido")).toBeDefined()
    expect(screen.getAllByText("Cancelados").length).toBeGreaterThanOrEqual(1)
  })

  it("renderiza tabs de status com contagens", () => {
    render(<ClientServices />)
    expect(screen.getAllByText("Concluídos").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("Cancelados").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("Todos")).toBeDefined()
  })

  it("exibe avaliação existente no card b-1 e prompt de avaliar agora no b-2", () => {
    render(<ClientServices />)
    expect(screen.getByText("“Excelente serviço!”")).toBeDefined()
    expect(screen.getByText("Avaliar agora")).toBeDefined()
  })

  it("abre ReviewDialog ao clicar em Avaliar agora no serviço pendente de avaliação", () => {
    render(<ClientServices />)
    const reviewBtn = screen.getByText("Avaliar agora")
    fireEvent.click(reviewBtn)
    expect(screen.getByTestId("review-dialog")).toBeDefined()
  })

  it("abre ReceiptModal ao clicar em Recibo", () => {
    render(<ClientServices />)
    const receiptBtns = screen.getAllByText("Recibo")
    expect(receiptBtns.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(receiptBtns[0]!)
    expect(screen.getByTestId("receipt-modal")).toBeDefined()
  })

  it("dispara navegação segura para mensagens internas da plataforma", () => {
    render(<ClientServices />)
    const messageBtns = screen.getAllByTitle("Enviar mensagem na plataforma")
    fireEvent.click(messageBtns[0]!)
    expect(mockNavigate).toHaveBeenCalledWith("client.messages", {
      providerId: "p-1",
      bookingId: "b-1",
    })
  })

  it("dispara recontratação ao clicar em Contratar novamente", () => {
    render(<ClientServices />)
    const rebookBtns = screen.getAllByText("Contratar novamente")
    fireEvent.click(rebookBtns[0]!)
    expect(mockOpenBooking).toHaveBeenCalledWith({
      providerId: "p-1",
      serviceId: "s-1",
    })
  })

  it("abre perfil do prestador ao clicar no nome", () => {
    render(<ClientServices />)
    const providerBtns = screen.getAllByText("Carlos Encanador")
    fireEvent.click(providerBtns[0]!)
    expect(mockOpenProvider).toHaveBeenCalledWith("p-1")
  })

  it("filtra serviços pelo campo de busca", () => {
    render(<ClientServices />)
    const input = screen.getByPlaceholderText("Filtrar por prestador ou serviço...")
    fireEvent.change(input, { target: { value: "inexistente" } })
    expect(screen.getByText("Sem resultados")).toBeDefined()
  })
})

describe("ClientServices — empty state", () => {
  beforeEach(() => {
    mockUseQueries().mockReturnValue([
      { data: { items: [], total: 0, page: 1, limit: 50 }, isLoading: false },
      { data: { items: [], total: 0, page: 1, limit: 50 }, isLoading: false },
    ] as any)
  })

  it("mostra mensagem de vazio quando não há serviços", () => {
    render(<ClientServices />)
    expect(screen.getByText("Você ainda não concluiu serviços")).toBeDefined()
  })
})

describe("ClientServices — accessibility", () => {
  beforeEach(() => {
    mockUseQueries().mockReturnValue([
      {
        data: {
          items: [buildBooking("b-1")],
          total: 1,
          page: 1,
          limit: 50,
        },
        isLoading: false,
      },
      {
        data: { items: [], total: 0, page: 1, limit: 50 },
        isLoading: false,
      },
    ] as any)
  })

  it("não possui violações de acessibilidade axe", async () => {
    const { container } = render(<ClientServices />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
