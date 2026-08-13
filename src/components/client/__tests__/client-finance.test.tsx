/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/**
 * Tests for ClientFinance — payments overview for the client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen } from "@/__tests__/test-utils"
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

vi.mock("@tanstack/react-query", () => ({
  useQueries: vi.fn(),
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
  Avatar: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  AvatarFallback: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
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
    onValueChange,
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
  CreditCard: () => <svg />,
  Loader2: () => <svg />,
  PiggyBank: () => <svg />,
  Receipt: () => <svg />,
  RotateCcw: () => <svg />,
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
    icon,
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
  vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
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

describe("ClientFinance — loading", () => {
  beforeEach(() => {
    mockUseQueries().mockReturnValue(
      [1, 2, 3, 4].map(() => ({ data: undefined, isLoading: true })) as any,
    )
  })

  afterEach(() => vi.clearAllMocks())

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

  afterEach(() => vi.clearAllMocks())

  it("renderiza PageHeader com título e subtítulo", () => {
    render(<ClientFinance />)
    expect(screen.getByText("Financeiro")).toBeDefined()
    expect(screen.getByText("Acompanhe seus pagamentos e gastos com serviços.")).toBeDefined()
  })

  it("renderiza os 3 cards de resumo financeiro", () => {
    render(<ClientFinance />)
    const cards = screen.getAllByTestId("stat-card")
    expect(cards.length).toBeGreaterThanOrEqual(3)
  })

  it("renderiza os tabs de status com contagens", () => {
    render(<ClientFinance />)
    expect(screen.getByText("Todos")).toBeDefined()
    // "Pago" appears in both tab label and status badges, use getAllByText
    expect(screen.getAllByText("Pago").length).toBeGreaterThanOrEqual(1)
    // "Pendente" appears in multiple elements (tab + badge), use getAllByText
    expect(screen.getAllByText(/Pendente/).length).toBeGreaterThanOrEqual(1)
    // "Reembolsado" appears in both tab label and stat card, use getAllByText
    expect(screen.getAllByText("Reembolsado").length).toBeGreaterThanOrEqual(1)
  })

  it("renderiza seção de gastos por mês", () => {
    render(<ClientFinance />)
    expect(screen.getByText("Gastos por mês")).toBeDefined()
  })

  it("renderiza a tabela de transações com dados dos bookings", () => {
    render(<ClientFinance />)
    // provider name may be inside a filtered subset; check total rendering
    const providerNames = screen.getAllByText(/Paulo/)
    expect(providerNames.length).toBeGreaterThanOrEqual(1)
  })

  it("renderiza o badge de status da conexão real-time", () => {
    render(<ClientFinance />)
    expect(screen.getByText("Ao vivo")).toBeDefined()
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

  afterEach(() => vi.clearAllMocks())

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

  afterEach(() => vi.clearAllMocks())

  it("não possui violações de acessibilidade axe", async () => {
    const { container } = render(<ClientFinance />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
