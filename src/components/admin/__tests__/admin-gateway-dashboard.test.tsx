/**
 * Tests for AdminGatewayDashboard — gateway de pagamento dashboard.
 *
 * Verifies:
 *  - Loading state renders skeleton
 *  - Error state renders ErrorState with retry button
 *  - Data state renders title, summary cards, period selector, chart titles,
 *    status detail table, and summary bar
 *  - Accessibility (axe-core)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@testing-library/react"
import { axe } from "vitest-axe"

// ---- Builder -------------------------------------------------------------

function buildGatewayStatsData() {
  return {
    period: "30d",
    totalVolume: 50000000,   // R$ 500.000,00 em centavos
    totalCount: 120,
    paidCount: 85,
    conversionRate: 70.8,
    averageTicket: 588235,   // R$ 5.882,35 em centavos
    byStatus: [
      { status: "paid", total: 45000000, count: 85 },
      { status: "waitingPayment", total: 3000000, count: 18 },
      { status: "expired", total: 1500000, count: 10 },
      { status: "canceled", total: 500000, count: 7 },
    ],
    monthly: [
      { month: "2026-01", label: "Jan/26", total: 8000000, count: 20, paid: 6500000, paidCount: 15 },
      { month: "2026-02", label: "Fev/26", total: 12000000, count: 28, paid: 10000000, paidCount: 22 },
      { month: "2026-03", label: "Mar/26", total: 15000000, count: 35, paid: 13000000, paidCount: 26 },
    ],
    methodDistribution: [
      { method: "PIX", total: 35000000, count: 70 },
      { method: "CARD", total: 15000000, count: 50 },
    ],
    trend: [
      { month: "2026-01", label: "Jan/26", conversion: 75, volume: 8000000, transactions: 20 },
      { month: "2026-02", label: "Fev/26", conversion: 78.6, volume: 12000000, transactions: 28 },
      { month: "2026-03", label: "Mar/26", conversion: 74.3, volume: 15000000, transactions: 35 },
    ],
  }
}

// ---- Mocks ---------------------------------------------------------------

const { mockRefetch } = vi.hoisted(() => ({
  mockRefetch: vi.fn(),
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/utils", () => ({
  cn: (...inputs: (string | undefined | null | false)[]) =>
    inputs.filter(Boolean).join(" "),
}))

vi.mock("lucide-react", () => ({
  Banknote: () => <svg data-testid="icon-banknote" />,
  DollarSign: () => <svg data-testid="icon-dollarsign" />,
  Loader2: () => <svg data-testid="icon-loader" />,
  Percent: () => <svg data-testid="icon-percent" />,
  RotateCw: () => <svg data-testid="icon-rotate" />,
  TrendingDown: () => <svg data-testid="icon-trendingdown" />,
  TrendingUp: () => <svg data-testid="icon-trendingup" />,
  Zap: () => <svg data-testid="icon-zap" />,
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

vi.mock("@/components/admin/admin-shared", () => ({
  ErrorState: ({ title, description, onRetry }: { title: string; description?: string; onRetry?: () => void }) => (
    <div data-testid="error-state">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {onRetry && <button type="button" onClick={onRetry} data-testid="retry-btn">Tentar novamente</button>}
    </div>
  ),
  TableSkeleton: ({ rows, cols }: { rows?: number; cols?: number }) => (
    <div data-testid="table-skeleton">{rows}×{cols}</div>
  ),
}))

vi.stubGlobal(
  "ResizeObserver",
  vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  })),
)

// ---- SUT import -----------------------------------------------------------

import { useQuery } from "@tanstack/react-query"
import { AdminGatewayDashboard } from "../admin-gateway-dashboard"

// ---- Setup / Teardown -----------------------------------------------------

afterEach(cleanup)

function useQueryMock() {
  return vi.mocked(useQuery)
}

// ---- Tests ----------------------------------------------------------------

describe("AdminGatewayDashboard — loading", () => {
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
    render(<AdminGatewayDashboard />)
    expect(screen.getByTestId("table-skeleton")).toBeDefined()
  })
})

describe("AdminGatewayDashboard — error", () => {
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
    render(<AdminGatewayDashboard />)
    expect(screen.getByText("Não foi possível carregar os dados do gateway")).toBeDefined()
    expect(screen.getByTestId("retry-btn")).toBeDefined()
  })

  it("chama refetch ao clicar em Tentar Novamente", () => {
    render(<AdminGatewayDashboard />)
    fireEvent.click(screen.getByTestId("retry-btn"))
    expect(mockRefetch).toHaveBeenCalledTimes(1)
  })
})

describe("AdminGatewayDashboard — data rendering", () => {
  beforeEach(() => {
    useQueryMock().mockReturnValue({
      data: buildGatewayStatsData(),
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
    render(<AdminGatewayDashboard />)
    expect(screen.getByText("Gateway de Pagamento")).toBeDefined()
    expect(screen.getByText(/Métricas agregadas do Lytex/)).toBeDefined()
  })

  it("renderiza os 4 cards de resumo", () => {
    render(<AdminGatewayDashboard />)
    // "Volume total", "Ticket médio" aparecem nos cards + summary bar
    expect(screen.getAllByText("Volume total").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("Pagas")).toBeDefined()
    expect(screen.getByText("Taxa de conversão")).toBeDefined()
    expect(screen.getAllByText("Ticket médio").length).toBeGreaterThanOrEqual(1)
  })

  it("renderiza seletor de período com 5 opções", () => {
    render(<AdminGatewayDashboard />)
    expect(screen.getByText("7 dias")).toBeDefined()
    expect(screen.getByText("30 dias")).toBeDefined()
    expect(screen.getByText("90 dias")).toBeDefined()
    expect(screen.getByText("12 meses")).toBeDefined()
    expect(screen.getByText("Todo período")).toBeDefined()
  })

  it("renderiza os títulos dos charts", () => {
    render(<AdminGatewayDashboard />)
    expect(screen.getByText("Volume mensal")).toBeDefined()
    expect(screen.getByText("Distribuição por status")).toBeDefined()
    expect(screen.getByText("Volume de transações")).toBeDefined()
    expect(screen.getByText("Conversão ao longo do tempo")).toBeDefined()
    expect(screen.getByText("Métodos de pagamento")).toBeDefined()
    expect(screen.getByText("Detalhamento por status")).toBeDefined()
  })

  it("renderiza dados na tabela de detalhamento por status", () => {
    render(<AdminGatewayDashboard />)
    // "Pago", "Aguardando" aparecem no donut legend + tabela
    expect(screen.getAllByText("Pago").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("Aguardando").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("Expirado").length).toBeGreaterThanOrEqual(1)
  })

  it("renderiza o resumo do período", () => {
    render(<AdminGatewayDashboard />)
    expect(screen.getByText("Resumo do período:")).toBeDefined()
    // "Volume total" e "Conversão" aparecem em múltiplos elementos
    expect(screen.getAllByText("Volume total").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("Conversão").length).toBeGreaterThanOrEqual(1)
  })

  it("mostra o número de faturas no card de volume total", () => {
    render(<AdminGatewayDashboard />)
    // Subtext aparece no card + summary bar — usar getAllByText
    expect(screen.getAllByText(/120 faturas/).length).toBeGreaterThanOrEqual(1)
  })
})

describe("AdminGatewayDashboard — empty data", () => {
  beforeEach(() => {
    useQueryMock().mockReturnValue({
      data: {
        period: "30d",
        totalVolume: 0,
        totalCount: 0,
        paidCount: 0,
        conversionRate: 0,
        averageTicket: 0,
        byStatus: [],
        monthly: [],
        methodDistribution: [],
        trend: [],
      },
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

  it("renderiza sem dados — mostra estrutura vazia sem quebrar", () => {
    render(<AdminGatewayDashboard />)
    // Should render the basic structure without crashing
    expect(screen.getByText("Gateway de Pagamento")).toBeDefined()
    // Cards render with 0 values (R$ 0,00)
    expect(screen.getAllByText("Volume total").length).toBeGreaterThanOrEqual(1)
  })
})

describe("AdminGatewayDashboard — accessibility", () => {
  beforeEach(() => {
    useQueryMock().mockReturnValue({
      data: buildGatewayStatsData(),
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
    const { container } = render(<AdminGatewayDashboard />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
