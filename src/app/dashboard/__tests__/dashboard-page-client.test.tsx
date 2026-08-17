/**
 * DashboardPageClient — seeding SSR do countdown da sessão.
 *
 * Cobre o contrato novo: a prop `initialSessionExpiresAt` (lida no server
 * component via getSessionExpiresAt) é semeada no auth store via
 * seedSessionExpiry no mount — antes/em paralelo ao fetchMe — eliminando o
 * flash de carregamento do countdown no primeiro paint.
 *
 * Os painéis reais são pesados (ClientPanel/ProviderPanel/AdminPanel): mockados
 * como divs para o teste focar no wiring do seeding.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen } from "@/__tests__/test-utils"

// ── Hoisted mocks (factories rodam antes dos imports estáticos) ────────────

const { mockSeedSessionExpiry, mockFetchMe, mockNavigate } = vi.hoisted(() => ({
  mockSeedSessionExpiry: vi.fn(),
  mockFetchMe: vi.fn(),
  mockNavigate: vi.fn(),
}))

// Estado controlável do auth store (status/user/initialized por teste).
// user tipado como Record | null: o spinner testa user: null (não inicializado).
const mockAuthState = vi.hoisted(() => ({
  current: {
    status: "authenticated",
    initialized: true,
    user: { id: "user-1", name: "Maria", email: "maria@test.com", role: "CLIENT" },
  } as { status: string; initialized: boolean; user: Record<string, unknown> | null },
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock("@/store/auth", () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      status: mockAuthState.current.status,
      initialized: mockAuthState.current.initialized,
      user: mockAuthState.current.user,
      fetchMe: mockFetchMe,
      seedSessionExpiry: mockSeedSessionExpiry,
    }),
}))

vi.mock("@/store/view", () => ({
  useViewStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ navigate: mockNavigate }),
}))

vi.mock("@/components/client/client-panel", () => ({
  ClientPanel: () => <div data-testid="client-panel">Painel Cliente</div>,
}))

vi.mock("@/components/provider/provider-panel", () => ({
  ProviderPanel: () => <div data-testid="provider-panel">Painel Prestador</div>,
}))

vi.mock("@/components/admin/admin-panel", () => ({
  AdminPanel: () => <div data-testid="admin-panel">Painel Admin</div>,
}))

vi.mock("lucide-react", () => ({
  Loader2: () => <svg aria-hidden data-testid="loader" />,
}))

// ── SUT ────────────────────────────────────────────────────────────────────

import { DashboardPageClient } from "../dashboard-page-client"

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthState.current = {
    status: "authenticated",
    initialized: true,
    user: { id: "user-1", name: "Maria", email: "maria@test.com", role: "CLIENT" },
  }
})

afterEach(cleanup)

describe("DashboardPageClient — seeding SSR do countdown", () => {
  it("semeia seedSessionExpiry com initialSessionExpiresAt no mount (paint inicial antes do fetchMe)", () => {
    const expiry = Math.floor(Date.now() / 1000) + 20 * 24 * 60 * 60
    render(<DashboardPageClient initialSessionExpiresAt={expiry} />)

    // O seed roda no mount; o fetchMe também é disparado (paralelo).
    expect(mockSeedSessionExpiry).toHaveBeenCalledWith(expiry)
    expect(mockFetchMe).toHaveBeenCalledTimes(1)
  })

  it("NÃO semeia quando a prop é null (sem sessão SSR — fetchMe decide sozinho)", () => {
    render(<DashboardPageClient initialSessionExpiresAt={null} />)
    expect(mockSeedSessionExpiry).not.toHaveBeenCalled()
    expect(mockFetchMe).toHaveBeenCalledTimes(1)
  })

  it("renderiza o painel do role após autenticação (wiring intacto)", () => {
    render(<DashboardPageClient initialSessionExpiresAt={null} />)
    expect(screen.getByTestId("client-panel")).toBeDefined()
  })

  it("mostra o spinner enquanto não inicializado (loading inicial)", () => {
    mockAuthState.current = { status: "loading", initialized: false, user: null }
    render(<DashboardPageClient initialSessionExpiresAt={null} />)
    expect(screen.getByTestId("loader")).toBeDefined()
    expect(screen.queryByTestId("client-panel")).toBeNull()
  })
})
