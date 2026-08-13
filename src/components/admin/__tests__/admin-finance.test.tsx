/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for AdminFinanceDashboard — financial overview for the admin panel.
 *
 * Verifies:
 *  - Loading state renders skeleton
 *  - Error state renders ErrorState with retry button
 *  - Data state renders title, summary cards, period selector, chart titles,
 *    provider table, transaction table, and real-time badge
 *  - Accessibility (axe-core)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

// ---- Builders -------------------------------------------------------------

function buildFinanceData() {
  return {
    summary: {
      PAID: { total: 150000, count: 45 },
      PENDING: { total: 30000, count: 12 },
      REFUNDED: { total: 5000, count: 3 },
    },
    monthlyRevenue: [
      { month: "2025-01", label: "Jan", total: 40000, count: 10 },
      { month: "2025-02", label: "Fev", total: 50000, count: 15 },
      { month: "2025-03", label: "Mar", total: 60000, count: 20 },
    ],
    paymentMethods: [
      { method: "PIX", total: 130000, count: 40 },
      { method: "CARD", total: 50000, count: 20 },
    ],
    transactions: [
      {
        id: "tx-1",
        bookingId: "b-1",
        amount: 150,
        method: "PIX",
        status: "PAID",
        transactionId: "ltx-1",
        createdAt: "2025-03-15T10:00:00Z",
        updatedAt: "2025-03-15T10:05:00Z",
        lytexId: "ly-1",
        lytexStatus: "settled",
        qrCode: null,
        paidAt: "2025-03-15T10:05:00Z",
        booking: {
          id: "b-1",
          scheduledAt: "2025-03-20T14:00:00Z",
          status: "COMPLETED",
          client: { id: "c-1", name: "Carlos Cliente", email: "carlos@test.com" },
          provider: { id: "p-1", name: "Paulo Prestador" },
          service: { id: "s-1", title: "Limpeza Pesada" },
        },
      },
    ],
    total: 15,
    page: 1,
    limit: 15,
    period: "30d",
    averageTicket: 3500,
    commissionPercent: 15,
    providerStats: [
      {
        id: "p-1",
        name: "Paulo Prestador",
        email: "paulo@test.com",
        avatarUrl: null,
        total: 15000,
        count: 12,
        commission: 2250,
        net: 12750,
      },
    ],
    mrr: {
      current: 55000,
      previous: 50000,
      growth: 10,
      history: [
        { month: "2025-01", label: "Jan", total: 50000 },
        { month: "2025-02", label: "Fev", total: 52000 },
        { month: "2025-03", label: "Mar", total: 55000 },
      ],
    },
  }
}

// ---- Mock setup -----------------------------------------------------------

const { mockRefetch } = vi.hoisted(() => ({
  mockRefetch: vi.fn(),
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}))

vi.mock("@/hooks/use-realtime-finance", () => ({
  useRealtimeFinance: vi.fn(() => ({
    isConnected: true,
    status: "connected",
  })),
}))

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/format", () => ({
  formatBRL: vi.fn(
    (v: number) => `R$ ${(v / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
  ),
}))

vi.mock("@/lib/utils", () => ({
  cn: (...inputs: (string | undefined | null | false)[]) => inputs.filter(Boolean).join(" "),
}))

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: {
    children?: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    [key: string]: unknown
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}))

vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({
    children,
    colSpan,
    className,
  }: {
    children?: React.ReactNode
    colSpan?: number
    className?: string
  }) => (
    <td colSpan={colSpan} className={className}>
      {children}
    </td>
  ),
  TableHead: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <th className={className}>{children}</th>
  ),
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableRow: ({
    children,
    onClick,
    className,
  }: {
    children?: React.ReactNode
    onClick?: () => void
    className?: string
  }) => (
    <tr onClick={onClick} className={className}>
      {children}
    </tr>
  ),
}))

vi.mock("@/components/admin/admin-shared", () => ({
  ErrorState: ({
    title,
    description,
    onRetry,
  }: {
    title: string
    description?: string
    onRetry?: () => void
  }) => (
    <div data-testid="error-state">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {onRetry && (
        <button type="button" onClick={onRetry} data-testid="retry-btn">
          Tentar novamente
        </button>
      )}
    </div>
  ),
}))

vi.mock("@/lib/constants", () => ({
  PAYMENT_STATUS_LABELS: { PAID: "Pago", PENDING: "Pagamento pendente", REFUNDED: "Estornado" },
  PAYMENT_METHOD_LABELS: { PIX: "PIX", CARD: "Cartão" },
}))

vi.mock("lucide-react", () => ({
  ArrowDown: () => <svg />,
  ArrowUp: () => <svg />,
  Banknote: () => <svg />,
  ChevronDown: () => <svg />,
  ChevronLeft: () => <svg />,
  ChevronRight: () => <svg />,
  ChevronUp: () => <svg />,
  CreditCard: () => <svg />,
  DollarSign: () => <svg />,
  Download: () => <svg />,
  Handshake: () => <svg />,
  Loader2: () => <svg />,
  QrCode: () => <svg />,
  Receipt: () => <svg />,
  RefreshCw: () => <svg />,
  RotateCw: () => <svg />,
  Ticket: () => <svg />,
  TrendingDown: () => <svg />,
  TrendingUp: () => <svg />,
  UserCircle: () => <svg />,
  Wallet: () => <svg />,
}))

vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
)

// Recharts is not SVG-capable under JSDOM (React 19 + recharts 2.x hooks crash
// with "Cannot read properties of null (reading 'useRef')"). Shared mock —
// pass-through placeholders; chart titles/data render outside the SVG.
vi.mock("recharts", async () => {
  const { createRechartsMock } = await import("./mocks")
  return createRechartsMock()
})

// ---- SUT import -----------------------------------------------------------

import { useQuery } from "@tanstack/react-query"
import { AdminFinanceDashboard } from "../admin-finance"

// ---- Setup / Teardown -----------------------------------------------------

afterEach(cleanup)

function useQueryMock() {
  return vi.mocked(useQuery)
}

// ---- Tests ----------------------------------------------------------------

describe("AdminFinanceDashboard — loading", () => {
  beforeEach(() => {
    useQueryMock().mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: false,
      refetch: mockRefetch,
      dataUpdatedAt: 0,
    } as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("renderiza skeleton durante carregamento", () => {
    render(<AdminFinanceDashboard />)
    const skeletons = screen.getAllByTestId("skeleton")
    expect(skeletons.length).toBeGreaterThanOrEqual(5)
  })
})

describe("AdminFinanceDashboard — error", () => {
  beforeEach(() => {
    useQueryMock().mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: mockRefetch,
      dataUpdatedAt: 0,
    } as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("renderiza ErrorState com mensagem e botão de retry", () => {
    render(<AdminFinanceDashboard />)
    expect(screen.getByText("Não foi possível carregar os dados financeiros")).toBeDefined()
    expect(screen.getByTestId("retry-btn")).toBeDefined()
  })

  it("chama refetch ao clicar em Tentar Novamente", () => {
    render(<AdminFinanceDashboard />)
    fireEvent.click(screen.getByTestId("retry-btn"))
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })
})

describe("AdminFinanceDashboard — data rendering", () => {
  beforeEach(() => {
    useQueryMock().mockReturnValue({
      data: buildFinanceData(),
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: mockRefetch,
      dataUpdatedAt: Date.now(),
    } as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("renderiza título e subtítulo", () => {
    render(<AdminFinanceDashboard />)
    expect(screen.getByText("Financeiro")).toBeDefined()
    expect(screen.getByText("Resumo de transações e faturamento da plataforma")).toBeDefined()
  })

  it("renderiza os 3 cards de resumo", () => {
    render(<AdminFinanceDashboard />)
    expect(screen.getByText("Recebido")).toBeDefined()
    expect(screen.getByText("Pendente")).toBeDefined()
    expect(screen.getByText("Estornado")).toBeDefined()
  })

  it("renderiza seletor de período com 5 opções", () => {
    render(<AdminFinanceDashboard />)
    expect(screen.getByText("7 dias")).toBeDefined()
    expect(screen.getByText("30 dias")).toBeDefined()
    expect(screen.getByText("90 dias")).toBeDefined()
    expect(screen.getByText("12 meses")).toBeDefined()
    expect(screen.getByText("Todo período")).toBeDefined()
  })

  it("renderiza os títulos dos charts", () => {
    render(<AdminFinanceDashboard />)
    expect(screen.getByText("Faturamento mensal")).toBeDefined()
    expect(screen.getByText("MRR — Receita Recorrente")).toBeDefined()
    expect(screen.getByText("Forma de pagamento")).toBeDefined()
    expect(screen.getByText("Ticket médio mensal")).toBeDefined()
  })

  it("renderiza seção de extrato por prestador", () => {
    render(<AdminFinanceDashboard />)
    expect(screen.getByText("Extrato por prestador")).toBeDefined()
    expect(screen.getAllByText("Paulo Prestador").length).toBeGreaterThanOrEqual(1)
  })

  it("renderiza histórico de transações com dados", () => {
    render(<AdminFinanceDashboard />)
    expect(screen.getByText("Histórico de transações")).toBeDefined()
    expect(screen.getByText("Carlos Cliente")).toBeDefined()
  })

  it("renderiza o badge de status da conexão real-time", () => {
    render(<AdminFinanceDashboard />)
    expect(screen.getByText("Ao vivo")).toBeDefined()
  })
})

describe("AdminFinanceDashboard — accessibility", () => {
  beforeEach(() => {
    useQueryMock().mockReturnValue({
      data: buildFinanceData(),
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: mockRefetch,
      dataUpdatedAt: Date.now(),
    } as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("não possui violações de acessibilidade axe", async () => {
    const { container } = render(<AdminFinanceDashboard />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
