/**
 * admin-realtime-telemetry.test.tsx
 *
 * Unit tests for the realtime telemetry admin page.
 *
 * A página polla GET /api/admin/realtime/telemetry a cada 15s e renderiza o
 * gráfico de emits por evento + o sinal de sockets órfãos (multi[]) com badge
 * de alerta quando o flag está ativo. Coberto:
 *   - Loading → skeleton; erro → ErrorState com retry
 *   - Realtime/Redis fora (ok: false) → EmptyState de degradação
 *   - Sem telemetria na janela → EmptyState
 *   - Cards de resumo (emits totais, órfãos agora, multi-socket, máx/usuário)
 *   - Badge/banner de ALERTA quando flag=true; ausente quando flag=false
 *   - Top-5 de eventos (fallback acessível do chart) + contadores
 *   - Seletor de janela muda o ?minutes do queryKey/request
 *   - Refresh manual chama refetch
 *   - axe sem violações com dados
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

// ---- Mock setup -----------------------------------------------------------

const { mockRefetch } = vi.hoisted(() => ({
  mockRefetch: vi.fn(),
}))

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/constants", () => ({
  ROLE_LABELS: { ADMIN: "Administrador", PROVIDER: "Prestador", CLIENT: "Cliente" },
}))

// recharts não é SVG-capable no JSDOM (React 19) — pass-through mock do repo.
vi.mock("recharts", async () => {
  const { createRechartsMock } = await import("./mocks")
  return createRechartsMock()
})

// Ícones usados pela página + admin-shared (o barrel _shared.ts carrega
// admin-online-users-card.tsx — a lista cobre o surface inteiro do grafo,
// mesma estratégia do admin-active-sessions.test.tsx).
vi.mock("lucide-react", () => ({
  Activity: () => <svg />,
  AlertTriangle: () => <svg data-testid="icon-alert" />,
  BarChart3: () => <svg />,
  CheckCircle2: () => <svg />,
  CircleUser: () => <svg />,
  Clock: () => <svg />,
  HardHat: () => <svg />,
  Loader2: () => <svg />,
  MapPin: () => <svg />,
  Navigation: () => <svg />,
  RadioTower: () => <svg />,
  RefreshCcw: () => <svg />,
  RotateCcw: () => <svg />,
  Search: () => <svg />,
  SearchX: () => <svg />,
  ShieldCheck: () => <svg />,
  ShieldX: () => <svg />,
  Trash2: () => <svg />,
  Users: () => <svg />,
  Wifi: () => <svg />,
  X: () => <svg />,
  XCircle: () => <svg />,
}))

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}))

// ---- Builders -------------------------------------------------------------

function buildTelemetryData(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    available: true,
    minutes: 60,
    windowStart: 1700000000000,
    windowEnd: 1700036000000,
    emits: {
      "notification:new": 42,
      "booking:update": 3,
      "message:new": 8,
      "session:renew": 1,
    },
    multi: [
      {
        bucket: 28333333,
        ts: 1700030000000,
        total: 5,
        byRole: { PROVIDER: 5 },
        usersWithMultipleSockets: 0,
        maxSocketsPerUser: 1,
      },
      {
        bucket: 28333334,
        ts: 1700030600000,
        total: 6,
        byRole: { PROVIDER: 6 },
        usersWithMultipleSockets: 1,
        maxSocketsPerUser: 2,
      },
    ],
    flag: true,
    ...overrides,
  }
}

// ---- SUT import -----------------------------------------------------------

import { useQuery } from "@tanstack/react-query"
import { AdminRealtimeTelemetry } from "../admin-realtime-telemetry"

afterEach(cleanup)

function queryMock() {
  return vi.mocked(useQuery)
}

function mockQueryData(data: unknown, overrides: Record<string, unknown> = {}) {
  queryMock().mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    isFetching: false,
    isRefetching: false,
    refetch: mockRefetch,
    dataUpdatedAt: Date.now(),
    ...overrides,
  } as any)
}

// ---- Tests ----------------------------------------------------------------

describe("AdminRealtimeTelemetry — estados", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("renderiza skeleton durante carregamento", () => {
    queryMock().mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: false,
      isRefetching: false,
      refetch: mockRefetch,
      dataUpdatedAt: 0,
    } as any)
    render(<AdminRealtimeTelemetry />)
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0)
  })

  it("renderiza ErrorState com retry quando a query falha", async () => {
    mockQueryData(undefined, { isError: true })
    render(<AdminRealtimeTelemetry />)
    expect(screen.getByText("Não foi possível carregar a telemetria")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Tentar novamente/i }))
    expect(mockRefetch).toHaveBeenCalled()
  })

  it("renderiza EmptyState de degradação quando o realtime/Redis está fora (ok:false)", () => {
    mockQueryData({ ok: false, available: false, emits: {}, multi: [], flag: false })
    render(<AdminRealtimeTelemetry />)
    expect(screen.getByText("Telemetria indisponível")).toBeInTheDocument()
  })

  it("renderiza EmptyState quando não há telemetria na janela", () => {
    mockQueryData({ ok: true, available: true, minutes: 60, emits: {}, multi: [], flag: false })
    render(<AdminRealtimeTelemetry />)
    expect(screen.getByText("Sem telemetria na janela")).toBeInTheDocument()
  })
})

describe("AdminRealtimeTelemetry — dados", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("renderiza os cards de resumo com os valores da janela", () => {
    mockQueryData(buildTelemetryData())
    render(<AdminRealtimeTelemetry />)
    // Emits totais = 42 + 3 + 8 + 1 = 54
    expect(screen.getByText("Emits na janela")).toBeInTheDocument()
    expect(screen.getByText("54")).toBeInTheDocument()
    expect(screen.getByText("Usuários multi-socket")).toBeInTheDocument()
    expect(screen.getByText("Máx. sockets/usuário")).toBeInTheDocument()
    // Último bucket: maxSocketsPerUser = 2
    expect(screen.getByText("2")).toBeInTheDocument()
  })

  it("exibe o badge/banner de ALERTA quando a flag de órfãos está ativa (flag=true)", () => {
    mockQueryData(buildTelemetryData({ flag: true }))
    render(<AdminRealtimeTelemetry />)
    expect(screen.getByText(/Sockets órfãos detectados agora/i)).toBeInTheDocument()
    expect(screen.getByText("flag ativo")).toBeInTheDocument()
    // Card "Órfãos agora" com o valor ATIVO
    expect(screen.getByText("ATIVO")).toBeInTheDocument()
  })

  it("NÃO exibe o banner de alerta quando o flag está inativo (flag=false)", () => {
    mockQueryData(buildTelemetryData({ flag: false }))
    render(<AdminRealtimeTelemetry />)
    expect(screen.queryByText(/Sockets órfãos detectados agora/i)).not.toBeInTheDocument()
    expect(screen.getByText("flag ok")).toBeInTheDocument()
    expect(screen.getByText("OK")).toBeInTheDocument()
  })

  it("lista o top-5 de eventos com contagem (fallback acessível do chart)", () => {
    mockQueryData(buildTelemetryData())
    render(<AdminRealtimeTelemetry />)
    expect(screen.getByText("notification:new")).toBeInTheDocument()
    expect(screen.getByText("booking:update")).toBeInTheDocument()
    expect(screen.getByText("Emits por evento")).toBeInTheDocument()
    expect(screen.getByText("Sinal de sockets órfãos")).toBeInTheDocument()
  })

  it("muda a janela e refaz a query com o novo ?minutes", () => {
    mockQueryData(buildTelemetryData())
    render(<AdminRealtimeTelemetry />)
    fireEvent.click(screen.getByRole("button", { name: "6 h" }))
    // O queryKey muda → o useQuery mock é re-chamado com o novo key. Assert
    // por ÍNDICE EXATO do array (não substring — "60" é substring de "360").
    const minutesInKeys = queryMock().mock.calls.map(
      (c) => (c[0]?.queryKey as unknown[] | undefined)?.[3],
    )
    expect(minutesInKeys).toContain(360)
  })

  it("refresh manual chama refetch", () => {
    mockQueryData(buildTelemetryData())
    render(<AdminRealtimeTelemetry />)
    fireEvent.click(screen.getByRole("button", { name: /Atualizar telemetria agora/i }))
    expect(mockRefetch).toHaveBeenCalled()
  })

  it("não possui violações de acessibilidade axe com dados", async () => {
    mockQueryData(buildTelemetryData())
    const { container } = render(<AdminRealtimeTelemetry />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
