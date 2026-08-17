/**
 * admin-online-users-card.test.tsx
 *
 * Unit tests for the OnlineUsersKpiCard component.
 *
 * O componente renderiza o KPI "Usuários online" (presença única de sessões
 * realtime ativas) e um tooltip com o breakdown por ROLE — o campo `role`
 * que a rota GET /api/admin/realtime/sessions retorna por socket. Coberto:
 *   - Contador `onlineUsers` + subtítulo de sockets/conflitos
 *   - Breakdown por role no tooltip (usuário DISTINTO, não socket)
 *   - Usuário com 2 sockets simultâneos conta 1 (casa com onlineUsers)
 *   - Role desconhecida entra como "outros"
 *   - Realtime fora do ar (ok: false) → sem breakdown, mensagem de degradação
 *   - Degradação graciosa com sessionsData undefined
 *
 * O tooltip usa Radix (Portal): o content só monta no document.body quando
 * o trigger recebe hover/focus — o helper `hoverCard` simula o hover antes
 * de assertar o breakdown.
 */

import { describe, it, expect, afterEach, vi } from "vitest"
import React from "react"
import { render, screen, fireEvent, waitFor, cleanup } from "@/__tests__/test-utils"

vi.mock("lucide-react", () => ({
  Wifi: () => <svg data-testid="icon-wifi" />,
  CircleUser: () => <svg data-testid="icon-client" />,
  HardHat: () => <svg data-testid="icon-provider" />,
  ShieldCheck: () => <svg data-testid="icon-admin" />,
  RefreshCcw: () => <svg data-testid="icon-refresh" />,
  TrendingUp: () => <svg />,
  TrendingDown: () => <svg />,
}))

// O componente usa useMutation/useQueryClient (botão revogar órfãos) e toast
// (sonner) — mesmo padrão de mock do admin-dashboard.test.tsx.
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
  useMutation: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/api", () => ({
  apiPost: vi.fn().mockResolvedValue({ ok: true, revoked: 0 }),
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog">{children}</div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p data-testid="dialog-description">{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
}))

import OnlineUsersKpiCard, { type OnlineUsersSessionsResponse } from "../admin-online-users-card"

// ===========================================================================
// Fixtures
// ===========================================================================

/** Helper: monta a resposta do GET /api/admin/realtime/sessions. */
function makeSessions(
  users: Array<{ userId: string; role: string; sockets?: number }>,
  overrides: Partial<OnlineUsersSessionsResponse> = {},
): OnlineUsersSessionsResponse {
  const sessions: OnlineUsersSessionsResponse["sessions"] = {}
  for (const u of users) {
    sessions[u.userId] = Array.from({ length: u.sockets ?? 1 }, (_, i) => ({
      userId: u.userId,
      role: u.role,
      socketId: `${u.userId}-${i}`,
      connectedAt: "2026-08-16T12:00:00.000Z",
      joinedAt: "2026-08-16T12:00:01.000Z",
    }))
  }
  return {
    ok: true,
    sessions,
    totalSockets: Object.values(sessions).reduce((n, s) => n + s.length, 0),
    onlineUsers: Object.keys(sessions).length,
    ...overrides,
  }
}

function sessionsByUser(data: OnlineUsersSessionsResponse | undefined) {
  return new Map(Object.entries(data?.sessions ?? {}))
}

const renderCard = (sessionsData: OnlineUsersSessionsResponse | undefined) =>
  render(
    <OnlineUsersKpiCard
      sessionsData={sessionsData}
      sessionsByUser={sessionsByUser(sessionsData)}
    />,
  )

/** Abre o tooltip: o Radix abre o content no onPointerMove do trigger
 *  (mouseenter não borbulha no jsdom — padrão já documentado no repo) e o
 *  open acontece em microtask; o waitFor absorve a montagem do Portal. */
async function hoverCard() {
  fireEvent.pointerMove(screen.getByText("Usuários online"))
  await waitFor(() => {
    expect(tooltipContent()).not.toBeNull()
  })
}

/** Content do tooltip (portaled em document.body pelo Radix). */
function tooltipContent(): HTMLElement | null {
  return document.body.querySelector('[data-slot="tooltip-content"]')
}

// ===========================================================================
// Tests
// ===========================================================================

describe("OnlineUsersKpiCard", () => {
  afterEach(() => {
    try {
      cleanup()
    } catch {
      // Container already cleaned up
    }
  })

  it("renders the online users counter (presença única)", () => {
    const data = makeSessions([
      { userId: "u1", role: "CLIENT" },
      { userId: "u2", role: "PROVIDER" },
      { userId: "u3", role: "ADMIN" },
    ])
    renderCard(data)

    expect(screen.getByText("Usuários online")).toBeInTheDocument()
    expect(screen.getByText("3")).toBeInTheDocument()
    expect(screen.getByText(/3 sockets ativos/)).toBeInTheDocument()
  })

  it("shows the role breakdown in the tooltip (usuário distinto por role)", async () => {
    const data = makeSessions([
      { userId: "u1", role: "CLIENT" },
      { userId: "u2", role: "CLIENT" },
      { userId: "u3", role: "PROVIDER" },
      { userId: "u4", role: "ADMIN" },
    ])
    renderCard(data)
    await hoverCard()

    const tooltip = tooltipContent()
    expect(tooltip).not.toBeNull()
    expect(tooltip).toHaveTextContent("Online por perfil")
    expect(tooltip).toHaveTextContent("Clientes")
    expect(tooltip).toHaveTextContent("Prestadores")
    expect(tooltip).toHaveTextContent("Administradores")
    expect(tooltip).toHaveTextContent("Outros")
  })

  it("counts a user with 2 sockets as 1 (não conta socket — casa com onlineUsers)", () => {
    const data = makeSessions([
      { userId: "u1", role: "CLIENT", sockets: 2 }, // conflito/órfão
      { userId: "u2", role: "PROVIDER" },
    ])
    renderCard(data)

    // onlineUsers = 2 usuários distintos (não 3 sockets).
    expect(screen.getByText("2")).toBeInTheDocument()
    // O subtítulo sinaliza o conflito (1 usuário com >1 socket).
    expect(screen.getByText(/3 sockets ativos · 1 conflito\(s\)/)).toBeInTheDocument()
  })

  it("groups unknown roles under 'outros'", async () => {
    const data = makeSessions([
      { userId: "u1", role: "SUPERVISOR" }, // role fora de CLIENT/PROVIDER/ADMIN
      { userId: "u2", role: "CLIENT" },
    ])
    renderCard(data)
    await hoverCard()

    const tooltip = tooltipContent()
    expect(tooltip).not.toBeNull()
    expect(tooltip).toHaveTextContent("Outros")
    expect(tooltip).toHaveTextContent("Clientes")
  })

  it("does not render the breakdown when realtime is unavailable (ok: false)", async () => {
    const data: OnlineUsersSessionsResponse = {
      ok: false,
      sessions: {},
      totalSockets: 0,
      onlineUsers: 0,
    }
    renderCard(data)

    expect(screen.getByText("Realtime indisponível")).toBeInTheDocument()
    await hoverCard()

    // Degradação graciosa: tooltip avisa, sem breakdown e sem crash.
    expect(tooltipContent()).toHaveTextContent("Realtime indisponível no momento.")
    expect(screen.queryByText("Online por perfil")).toBeNull()
  })

  it("degrades gracefully when sessionsData is undefined (sem fetch ainda)", () => {
    renderCard(undefined)

    expect(screen.getByText("Usuários online")).toBeInTheDocument()
    expect(screen.getByText("0")).toBeInTheDocument()
  })

  it("renders the revoke-orphans button", () => {
    renderCard(makeSessions([{ userId: "u1", role: "CLIENT" }]))

    expect(screen.getByRole("button", { name: /Revogar sockets órfãos/ })).toBeInTheDocument()
  })
})
