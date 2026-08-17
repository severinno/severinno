/**
 * admin-active-sessions.test.tsx
 *
 * Unit tests for the dedicated real-time active-sessions admin page.
 *
 * A página polla GET /api/admin/realtime/sessions a cada 5s (refetchInterval)
 * e lista UMA linha por usuário online: avatar/nome/e-mail (users map), perfil,
 * nº de sessões (badge de conflito >1), joinedAt e motivo do último kick.
 * Coberto:
 *   - Loading → skeleton; erro → ErrorState com retry
 *   - Realtime fora (ok: false) → EmptyState de degradação (nunca quebra)
 *   - Ninguém online → EmptyState "Ninguém online agora"
 *   - Renderiza linhas com nome/e-mail (users map) + cards de resumo
 *   - Badge âmbar de conflito quando >1 socket + motivo do último kick
 *   - Busca por e-mail (debounced) filtra client-side
 *   - Filtro por role (tabs) filtra client-side
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@/__tests__/test-utils"
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

// Ícones usados pela página + admin-shared (lucide tem surface parcial nos
// mocks do repo — a lista cobre o que o grafo importa).
vi.mock("lucide-react", () => ({
  AlertTriangle: () => <svg data-testid="icon-alert" />,
  CheckCircle2: () => <svg />,
  CircleUser: () => <svg />,
  Clock: () => <svg />,
  HardHat: () => <svg />,
  Loader2: () => <svg />,
  MapPin: () => <svg />,
  Navigation: () => <svg />,
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

function buildSessionsData() {
  return {
    ok: true,
    // userId → sockets ativos (o route agrupa; cada socket tem role/joinedAt)
    sessions: {
      u1: [
        {
          userId: "u1",
          role: "PROVIDER",
          socketId: "s1",
          connectedAt: "2026-08-16T11:55:00.000Z",
          joinedAt: "2026-08-16T11:55:01.000Z",
        },
        {
          userId: "u1",
          role: "PROVIDER",
          socketId: "s2",
          connectedAt: "2026-08-16T12:00:00.000Z",
          joinedAt: "2026-08-16T12:00:01.000Z",
        },
      ],
      u2: [
        {
          userId: "u2",
          role: "CLIENT",
          socketId: "s3",
          connectedAt: "2026-08-16T11:50:00.000Z",
          joinedAt: "2026-08-16T11:50:01.000Z",
        },
      ],
    },
    // users map — enriquecimento do route (nome/e-mail p/ display + busca)
    users: {
      u1: { name: "Ana Prestadora", email: "ana@severinno.com", avatarUrl: null },
      u2: { name: "Bruno Cliente", email: "bruno@severinno.com", avatarUrl: null },
    },
    totalSockets: 3,
    onlineUsers: 2,
    kicks: {
      u1: {
        reason: "session_limit",
        at: "2026-08-16T12:00:00.000Z",
        count: 2,
        max: 2,
        history: [
          { reason: "session_limit", at: "2026-08-16T11:30:00.000Z", socketId: "s0", max: 2 },
        ],
      },
    },
  }
}

// ---- SUT import -----------------------------------------------------------

import { useQuery } from "@tanstack/react-query"
import { AdminActiveSessions } from "../admin-active-sessions"

afterEach(cleanup)

// Nome sem prefixo "use" (o eslint react-hooks/rules-of-hooks trata funções
// começando com "use" como hooks e reclama de chamadas fora de componentes).
function queryMock() {
  return vi.mocked(useQuery)
}

function mockQueryData(data: unknown, overrides: Record<string, unknown> = {}) {
  queryMock().mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: mockRefetch,
    dataUpdatedAt: Date.now(),
    ...overrides,
  } as any)
}

// ---- Tests ----------------------------------------------------------------

describe("AdminActiveSessions — estados", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("renderiza skeleton durante carregamento", () => {
    queryMock().mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      isFetching: false,
      refetch: mockRefetch,
      dataUpdatedAt: 0,
    } as any)
    render(<AdminActiveSessions />)
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThanOrEqual(5)
  })

  it("renderiza ErrorState com retry quando o fetch falha", () => {
    queryMock().mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: mockRefetch,
      dataUpdatedAt: 0,
    } as any)
    render(<AdminActiveSessions />)
    expect(screen.getByText("Não foi possível carregar as sessões")).toBeInTheDocument()
  })

  it("degradação graciosa: realtime fora do ar (ok: false) → EmptyState, nunca quebra", () => {
    mockQueryData({ ok: false, sessions: {}, totalSockets: 0, onlineUsers: 0, kicks: {} })
    render(<AdminActiveSessions />)
    expect(screen.getByText("Realtime indisponível")).toBeInTheDocument()
    expect(screen.queryByText("Ana Prestadora")).toBeNull()
  })

  it("nenhum usuário online → EmptyState 'Ninguém online agora'", () => {
    mockQueryData({ ok: true, sessions: {}, totalSockets: 0, onlineUsers: 0, kicks: {} })
    render(<AdminActiveSessions />)
    expect(screen.getByText("Ninguém online agora")).toBeInTheDocument()
  })
})

describe("AdminActiveSessions — dados", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("renderiza cards de resumo (online, sockets, conflitos)", () => {
    mockQueryData(buildSessionsData())
    render(<AdminActiveSessions />)
    expect(screen.getByText("Usuários online")).toBeInTheDocument()
    expect(screen.getByText("Sockets ativos")).toBeInTheDocument()
    expect(screen.getByText("Conflitos de sessão")).toBeInTheDocument()
    // 2 usuários online · 3 sockets · 1 conflito (u1 com 2 sockets)
    expect(screen.getByText("2")).toBeInTheDocument()
    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText("1")).toBeInTheDocument()
  })

  it("renderiza uma linha por usuário com nome/e-mail do users map + perfil", () => {
    mockQueryData(buildSessionsData())
    render(<AdminActiveSessions />)
    expect(screen.getByText("Ana Prestadora")).toBeInTheDocument()
    expect(screen.getByText("ana@severinno.com")).toBeInTheDocument()
    expect(screen.getByText("Bruno Cliente")).toBeInTheDocument()
    expect(screen.getByText("bruno@severinno.com")).toBeInTheDocument()
    // Perfis (RoleBadge)
    expect(screen.getByText("Prestador")).toBeInTheDocument()
    expect(screen.getByText("Cliente")).toBeInTheDocument()
  })

  it("badge âmbar de conflito quando usuário tem >1 socket (2 sessões)", () => {
    mockQueryData(buildSessionsData())
    render(<AdminActiveSessions />)
    expect(screen.getByText("2 sessões")).toBeInTheDocument()
    expect(screen.getByText("1 sessão")).toBeInTheDocument()
  })

  it("exibe o motivo do último kick (limite de sessões + contagem)", () => {
    mockQueryData(buildSessionsData())
    render(<AdminActiveSessions />)
    expect(screen.getByText("Limite de sessões")).toBeInTheDocument()
    // "· 2×" (contagem de kicks)
    expect(screen.getByText("· 2×")).toBeInTheDocument()
  })
})

describe("AdminActiveSessions — filtros", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("busca por e-mail filtra as linhas (client-side, debounced)", async () => {
    mockQueryData(buildSessionsData())
    render(<AdminActiveSessions />)

    fireEvent.change(screen.getByPlaceholderText("Buscar por nome ou e-mail"), {
      target: { value: "bruno@severinno.com" },
    })
    await waitFor(() => {
      expect(screen.queryByText("Ana Prestadora")).toBeNull()
    })
    expect(screen.getByText("Bruno Cliente")).toBeInTheDocument()
  })

  it("filtro por role (tabs) mostra só o perfil selecionado", () => {
    mockQueryData(buildSessionsData())
    render(<AdminActiveSessions />)

    fireEvent.click(screen.getByText("Prestadores"))
    expect(screen.getByText("Ana Prestadora")).toBeInTheDocument()
    expect(screen.queryByText("Bruno Cliente")).toBeNull()
  })

  it("limpar filtros restaura as linhas", async () => {
    mockQueryData(buildSessionsData())
    render(<AdminActiveSessions />)

    fireEvent.change(screen.getByPlaceholderText("Buscar por nome ou e-mail"), {
      target: { value: "ana" },
    })
    await waitFor(() => {
      expect(screen.queryByText("Bruno Cliente")).toBeNull()
    })
    fireEvent.click(screen.getByText("Limpar filtros"))
    await waitFor(() => {
      expect(screen.getByText("Bruno Cliente")).toBeInTheDocument()
    })
  })
})

describe("AdminActiveSessions — acessibilidade", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("não possui violações de acessibilidade axe com dados", async () => {
    mockQueryData(buildSessionsData())
    const { container } = render(<AdminActiveSessions />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
