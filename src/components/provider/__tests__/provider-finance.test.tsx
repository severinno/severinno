/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for ProviderFinance — financial overview for the provider panel.
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
    clientName: string
    serviceTitle: string
    scheduledAt: string
  }> = {},
) {
  const now = new Date()
  // Use current month/year so filters match
  const defaultDate = new Date(now.getFullYear(), now.getMonth(), 15).toISOString()
  return {
    id,
    scheduledAt: overrides.scheduledAt ?? defaultDate,
    status: "COMPLETED",
    amount: overrides.amount ?? 15000,
    paymentMethod: overrides.paymentMethod ?? "PIX",
    paymentStatus: overrides.paymentStatus ?? "PAID",
    service: { id: "s-1", title: overrides.serviceTitle ?? "Limpeza" },
    client: { id: "c-1", name: overrides.clientName ?? "Maria Cliente", avatarUrl: null },
  }
}

// ---- Mocks ----------------------------------------------------------------

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}))

vi.mock("@/hooks/use-realtime-finance", () => ({
  useRealtimeFinance: vi.fn(() => ({
    isConnected: true,
    status: "connected",
  })),
}))

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn(
    (selector?: (s: { user: { id: string; name: string; role: string } | null }) => unknown) => {
      const state = { user: { id: "provider-1", name: "Paulo", role: "PROVIDER" } }
      return selector ? selector(state) : state
    },
  ),
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

vi.mock("lucide-react", () => ({
  CheckCircle2: () => <svg />,
  Clock: () => <svg />,
  CreditCard: () => <svg />,
  RotateCcw: () => <svg />,
  Wallet: () => <svg />,
  XCircle: () => <svg />,
}))

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardTitle: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <h3 className={className}>{children}</h3>
  ),
}))

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  AvatarFallback: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  AvatarImage: () => null,
}))

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <span className={className}>{children}</span>
  ),
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

vi.mock("../provider-wallet", () => ({
  ProviderWallet: () => <div data-testid="provider-wallet" />,
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

import { useQuery } from "@tanstack/react-query"
import { ProviderFinance } from "../provider-finance"

// ---- Helper ---------------------------------------------------------------

function useQueryMock() {
  return vi.mocked(useQuery)
}

// ---- Tests ----------------------------------------------------------------

afterEach(cleanup)

const emptyData = { items: [], total: 0 }

describe("ProviderFinance — loading", () => {
  beforeEach(() => {
    useQueryMock().mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    } as any)
  })

  afterEach(() => vi.clearAllMocks())

  it("renderiza ProviderWallet mesmo durante carregamento", () => {
    render(<ProviderFinance />)
    expect(screen.getByTestId("provider-wallet")).toBeDefined()
  })
})

describe("ProviderFinance — data rendering", () => {
  beforeEach(() => {
    useQueryMock().mockReturnValue({
      data: {
        items: [
          buildBooking("b-1"),
          buildBooking("b-2", { paymentStatus: "PENDING", clientName: "João Cliente" }),
        ],
        total: 2,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any)
  })

  afterEach(() => vi.clearAllMocks())

  it("renderiza ProviderWallet", () => {
    render(<ProviderFinance />)
    expect(screen.getByTestId("provider-wallet")).toBeDefined()
  })

  it("renderiza os 3 cards de resumo financeiro", () => {
    render(<ProviderFinance />)
    // Use regex to match text that may be split across elements
    expect(screen.getByText(/Recebido/)).toBeDefined()
    expect(screen.getByText(/A receber/)).toBeDefined()
    // "Estornado" appears in both stat card and filter dropdown, use getAllByText
    expect(screen.getAllByText(/Estornado/).length).toBeGreaterThanOrEqual(1)
  })

  it("renderiza o gráfico de receita por mês", () => {
    render(<ProviderFinance />)
    // The chart title may contain the year in parentheses
    expect(screen.getByText(/Receita por mês/i)).toBeDefined()
  })

  it("renderiza filtros", () => {
    render(<ProviderFinance />)
    expect(screen.getByText(/Todos os status/)).toBeDefined()
  })

  it("renderiza a tabela de transações com bookings", () => {
    render(<ProviderFinance />)
    expect(screen.getByText("Maria Cliente")).toBeDefined()
  })

  it("mostra contagem de transações", () => {
    render(<ProviderFinance />)
    // Transação count appears both in CardTitle (capital T) and filter bar
    // (lowercase t), use getAllByText
    expect(screen.getAllByText(/transações?/i).length).toBeGreaterThanOrEqual(1)
  })

  it("renderiza o badge de status da conexão real-time", () => {
    render(<ProviderFinance />)
    expect(screen.getByText("Ao vivo")).toBeDefined()
  })
})

describe("ProviderFinance — empty state", () => {
  beforeEach(() => {
    useQueryMock().mockReturnValue({
      data: emptyData,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any)
  })

  afterEach(() => vi.clearAllMocks())

  it("mostra mensagem de vazio quando não há transações", () => {
    render(<ProviderFinance />)
    expect(screen.getByText("Nenhuma transação neste período.")).toBeDefined()
  })
})

describe("ProviderFinance — accessibility", () => {
  beforeEach(() => {
    useQueryMock().mockReturnValue({
      data: { items: [buildBooking("b-1")], total: 1 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as any)
  })

  afterEach(() => vi.clearAllMocks())

  it("não possui violações de acessibilidade axe", async () => {
    const { container } = render(<ProviderFinance />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
