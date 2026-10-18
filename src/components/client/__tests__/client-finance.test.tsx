/**
 * Tests for ClientFinance — payments overview for the client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

// ---- Builder --------------------------------------------------------------

function buildBooking(
  id: string,
  overrides: Partial<{
    amount: number
    paymentMethod: string
    paymentStatus: string
    providerName: string
    serviceTitle: string
    scheduledAt: string
  }> = {},
) {
  const now = new Date()
  return {
    id,
    status: "COMPLETED",
    scheduledAt: overrides.scheduledAt ?? new Date(now.getFullYear(), 2, 15).toISOString(),
    amount: overrides.amount ?? 15000,
    paymentMethod: overrides.paymentMethod ?? "PIX",
    paymentStatus: overrides.paymentStatus ?? "PAID",
    service: { id: "s-1", title: overrides.serviceTitle ?? "Limpeza" },
    provider: { id: "p-1", name: overrides.providerName ?? "Paulo Prestador", avatarUrl: null },
  }
}

// ---- Mocks ----------------------------------------------------------------

const mockNavigate = vi.fn()
const mockOpenProvider = vi.fn()
const mockOpenBooking = vi.fn()

vi.mock("@tanstack/react-query", () => ({
  useQueries: vi.fn(),
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

vi.mock("@/hooks/use-realtime-finance", () => ({
  useRealtimeFinance: vi.fn(() => ({
    isConnected: true,
    status: "connected",
  })),
}))

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({ items: [], total: 0 }),
}))

vi.mock("@/lib/format", () => ({
  formatBRL: vi.fn(
    (v: number) => `R$ ${(v / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
  ),
  formatDate: vi.fn(() => "15/03/2025"),
}))

vi.mock("@/lib/utils", () => ({
  cn: (...inputs: (string | undefined | null | false)[]) => inputs.filter(Boolean).join(" "),
}))

vi.mock("@/lib/constants", () => ({
  PAYMENT_STATUS_LABELS: { PAID: "Pago", PENDING: "Pagamento pendente", REFUNDED: "Estornado" },
  PAYMENT_METHOD_LABELS: { PIX: "PIX", CARD: "Cartão" },
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

vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <td className={className}>{children}</td>
  ),
  TableHead: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <th className={className}>{children}</th>
  ),
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <tr className={className}>{children}</tr>
  ),
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

vi.mock("lucide-react", () => ({
  Calendar: () => <svg />,
  CreditCard: () => <svg />,
  FileText: () => <svg />,
  Loader2: () => <svg />,
  Lock: () => <svg />,
  MessageSquare: () => <svg />,
  PiggyBank: () => <svg />,
  Receipt: () => <svg />,
  RotateCcw: () => <svg />,
  Search: () => <svg />,
  ShieldCheck: () => <svg />,
  Wallet: () => <svg />,
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

vi.mock("@/components/client/client-shared", () => ({
  PageHeader: ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  ),
  StatusBadge: ({
    children,
    tone,
    icon: _icon,
  }: {
    children?: React.ReactNode
    tone?: string
    icon?: React.ComponentType
  }) => <span data-tone={tone}>{children}</span>,
  paymentIcon: vi.fn(() => null),
  paymentTone: vi.fn(() => "zinc" as const),
}))

vi.stubGlobal(
  "ResizeObserver",
  vi.fn(function () {
    return {
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }
  }),
)

vi.stubGlobal(
  "matchMedia",
  vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
)

// ---- SUT import -----------------------------------------------------------

import { useQueries } from "@tanstack/react-query"
import { ClientFinance } from "../client-finance"

// ---- Helpers --------------------------------------------------------------

function mockUseQueries() {
  return vi.mocked(useQueries)
}

// ---- Tests ----------------------------------------------------------------

afterEach(cleanup)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-01-05T15:00:00.000Z")) // 12:00 BRT
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("ClientFinance — loading", () => {
  beforeEach(() => {
    mockUseQueries().mockReturnValue(
      [1, 2, 3, 4].map(() => ({ data: undefined, isLoading: true })) as any,
    )
  })

  it("mostra loader durante carregamento", () => {
    render(<ClientFinance />)
    expect(screen.getByText("Carregando pagamentos…")).toBeDefined()
  })
})

describe("ClientFinance — data rendering", () => {
  beforeEach(() => {
    mockUseQueries().mockReturnValue(
      [1, 2, 3, 4].map((p) => ({
        data: {
          items:
            p === 1 ? [buildBooking("b-1"), buildBooking("b-2", { paymentStatus: "PENDING" })] : [],
          total: 2,
          page: p,
          limit: 50,
        },
        isLoading: false,
      })) as any,
    )
  })

  it("renderiza Hero Banner com título, subtítulo e ações rápidas", () => {
    render(<ClientFinance />)
    expect(screen.getByText("Financeiro")).toBeDefined()
    expect(screen.getByText("Acompanhe seus pagamentos e gastos com serviços.")).toBeDefined()
    expect(screen.getByText("Pagamento Seguro & Custódia Escrow")).toBeDefined()
    expect(screen.getByText("Ver agendamentos")).toBeDefined()
    expect(screen.getByText("Buscar prestadores")).toBeDefined()
  })

  it("renderiza o banner educativo de Custódia Digital Escrow", () => {
    render(<ClientFinance />)
    expect(screen.getByText("Custódia Digital Severinno Escrow")).toBeDefined()
    expect(screen.getByText("100% Protegido")).toBeDefined()
  })

  it("renderiza os 3 cards de resumo financeiro", () => {
    render(<ClientFinance />)
    const cards = screen.getAllByTestId("stat-card")
    expect(cards.length).toBeGreaterThanOrEqual(3)
  })

  it("renderiza os tabs de status com contagens", () => {
    render(<ClientFinance />)
    expect(screen.getByText("Todos")).toBeDefined()
    expect(screen.getAllByText("Pago").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Pendente/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("Reembolsado").length).toBeGreaterThanOrEqual(1)
  })

  it("renderiza seção de gastos por mês", () => {
    render(<ClientFinance />)
    expect(screen.getByText("Gastos por mês")).toBeDefined()
  })

  it("renderiza a tabela e cards com dados dos bookings", () => {
    render(<ClientFinance />)
    const providerNames = screen.getAllByText(/Paulo/)
    expect(providerNames.length).toBeGreaterThanOrEqual(1)
  })

  it("renderiza o badge de status da conexão real-time", () => {
    render(<ClientFinance />)
    expect(screen.getByText("Ao vivo")).toBeDefined()
  })

  it("abre o ReceiptModal ao clicar em Recibo no booking liquidado", () => {
    render(<ClientFinance />)
    const receiptButtons = screen.getAllByText("Recibo")
    expect(receiptButtons.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(receiptButtons[0]!)
    expect(screen.getByTestId("receipt-modal")).toBeDefined()
    expect(screen.getByText("Receipt for b-1")).toBeDefined()
  })

  it("abre o perfil do prestador ao clicar no nome", () => {
    render(<ClientFinance />)
    const providerButtons = screen.getAllByText("Paulo Prestador")
    fireEvent.click(providerButtons[0]!)
    expect(mockOpenProvider).toHaveBeenCalledWith("p-1")
  })

  it("dispara navegação para mensagens internas sem WhatsApp externo", () => {
    render(<ClientFinance />)
    const messageButtons = screen.getAllByTitle("Enviar mensagem na plataforma")
    fireEvent.click(messageButtons[0]!)
    expect(mockNavigate).toHaveBeenCalledWith("client.messages", {
      providerId: "p-1",
      bookingId: "b-1",
    })
  })

  it("filtra itens ao digitar no campo de busca", () => {
    render(<ClientFinance />)
    const input = screen.getByPlaceholderText("Filtrar por prestador ou serviço...")
    fireEvent.change(input, { target: { value: "inexistente" } })
    expect(screen.getByText("Sem resultados")).toBeDefined()
  })
})

describe("ClientFinance — empty state", () => {
  beforeEach(() => {
    mockUseQueries().mockReturnValue(
      [1, 2, 3, 4].map(() => ({
        data: { items: [], total: 0, page: 1, limit: 50 },
        isLoading: false,
      })) as any,
    )
  })

  it("mostra mensagem de vazio quando não há bookings", () => {
    render(<ClientFinance />)
    expect(screen.getByText("Nenhum pagamento encontrado")).toBeDefined()
  })
})

describe("ClientFinance — accessibility", () => {
  beforeEach(() => {
    mockUseQueries().mockReturnValue(
      [1, 2, 3, 4].map((p) => ({
        data: {
          items:
            p === 1 ? [buildBooking("b-1"), buildBooking("b-2", { paymentStatus: "PENDING" })] : [],
          total: 2,
          page: p,
          limit: 50,
        },
        isLoading: false,
      })) as any,
    )
  })

  it("não possui violações de acessibilidade axe", async () => {
    const { container } = render(<ClientFinance />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
