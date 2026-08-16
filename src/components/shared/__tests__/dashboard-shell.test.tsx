/**
 * DashboardShell — notification sound integration tests.
 *
 * These tests verify that:
 *  - useTransactionNotificationSound is called with the correct items + role
 *  - WalletBalancePill appears / hides based on role and wallet data
 *  - The sound hooks are invoked when react-query returns notification data
 *
 * We mock all heavy UI (sidebar, framer-motion) and external APIs so the
 * component can render in jsdom without side-effects.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// ---- Heavy UI: sidebar renders as a plain div -----------------------------
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children, ..._props }: { children: React.ReactNode }) => (
    <div data-testid="sidebar-provider">{children}</div>
  ),
  Sidebar: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar">{children}</div>
  ),
  SidebarContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar-content">{children}</div>
  ),
  SidebarFooter: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar-footer">{children}</div>
  ),
  SidebarHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar-header">{children}</div>
  ),
  SidebarGroup: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar-group">{children}</div>
  ),
  SidebarGroupContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar-group-content">{children}</div>
  ),
  SidebarGroupLabel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar-group-label">{children}</div>
  ),
  SidebarMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar-menu">{children}</div>
  ),
  SidebarMenuButton: ({ children, ..._props }: { children: React.ReactNode }) => (
    <div data-testid="sidebar-menu-button">{children}</div>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar-menu-item">{children}</div>
  ),
  SidebarInset: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sidebar-inset">{children}</div>
  ),
  SidebarSeparator: () => <div data-testid="sidebar-separator" />,
  SidebarTrigger: () => <div data-testid="sidebar-trigger" />,
}))

// ---- lucide-react icons (dashboard-shell + subcomponentes) ---------------
vi.mock("lucide-react", () => {
  // Retorna um SVG simples para cada ícone — evita resolver o módulo real
  const MockIcon = (props: Record<string, unknown>) => (
    <svg aria-hidden="true" data-testid="mock-icon" {...props} />
  )
  return {
    // dashboard-shell
    Bell: MockIcon,
    Check: MockIcon,
    CheckCheck: MockIcon,
    ChevronRight: MockIcon,
    LayoutDashboard: MockIcon,
    Loader2: MockIcon,
    LogOut: MockIcon,
    MapPin: MockIcon,
    Menu: MockIcon,
    Moon: MockIcon,
    Sun: MockIcon,
    // SessionExpiryBanner
    CalendarClock: MockIcon,
    RefreshCw: MockIcon,
    X: MockIcon,
    // MuteIndicator
    Volume2: MockIcon,
    VolumeX: MockIcon,
    // VibrationIndicator
    Smartphone: MockIcon,
    // WalletBalancePill
    Wallet: MockIcon,
  }
})

// ---- framer-motion: motion.div renders as a plain div --------------------
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ..._props }: { children: React.ReactNode }) => <div>{children}</div>,
    button: ({ children, ..._props }: { children: React.ReactNode }) => (
      <button type="button">{children}</button>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// ---- Hooks under test -----------------------------------------------------
export const mockUseTransactionNotificationSound = vi.fn()
export const mockPlayCoin = vi.fn()
export const mockUseBalancePulse = vi.fn()
export const mockIsPulsing = false

vi.mock("@/lib/use-coin-sound", () => ({
  useCoinSound: () => ({
    playCoin: mockPlayCoin,
    playCompletion: vi.fn(),
    playReview: vi.fn(),
    soundEnabled: true,
  }),
  useTransactionNotificationSound: (...args: unknown[]) =>
    mockUseTransactionNotificationSound(...args),
  useWelcomeSound: vi.fn(),
}))

vi.mock("@/lib/use-balance-pulse", () => ({
  useBalancePulse: (...args: unknown[]) => {
    mockUseBalancePulse(...args)
    return { isPulsing: mockIsPulsing }
  },
}))

// ---- Shared mutable auth user (allows tests to change preferences) --------
const mockAuthUser = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
// sessionExpiresAt (unix seconds) — controlável por teste p/ o banner de sessão.
const mockSessionExpiry = vi.hoisted(() => ({ current: null as number | null }))
const mockFetchMe = vi.hoisted(() => vi.fn())
const mockRenewSession = vi.hoisted(() => vi.fn())

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn((selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      user: mockAuthUser.current,
      logout: vi.fn(),
      fetchMe: mockFetchMe,
      renewSession: mockRenewSession,
      sessionExpiresAt: mockSessionExpiry.current,
    }
    return selector ? selector(state) : state
  }),
}))

vi.mock("@/store/view", () => ({
  useViewStore: vi.fn((selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { navigate: vi.fn() }
    return selector ? selector(state) : state
  }),
}))

// ---- Theme ----------------------------------------------------------------
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}))

// ---- react-query ----------------------------------------------------------
type MockQueryResult = {
  data?: unknown
  isLoading?: boolean
}

let mockNotificationsQuery: MockQueryResult = { data: undefined, isLoading: false }
let mockWalletQuery: MockQueryResult = { data: undefined, isLoading: false }
const mockInvalidateQueries = vi.fn()

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn((opts: { queryKey: string[] }) => {
    if (opts.queryKey.includes("notifications")) return mockNotificationsQuery
    if (opts.queryKey.includes("wallet")) return mockWalletQuery
    return { data: undefined, isLoading: false }
  }),
  useMutation: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: mockInvalidateQueries,
  })),
}))

// ---- API ------------------------------------------------------------------
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({ items: [] }),
  apiPatch: vi.fn().mockResolvedValue({}),
}))

// ---- Format helpers -------------------------------------------------------
vi.mock("@/lib/format", () => ({
  formatBRL: vi.fn((v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`),
  formatRelative: vi.fn(() => "há 1 min"),
}))

// ---- Other UI -------------------------------------------------------------
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <div />,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("@/components/ui/separator", () => ({
  Separator: ({ orientation, ..._props }: { orientation?: string }) => (
    <div data-testid="separator" data-orientation={orientation} />
  ),
}))

// Sheet: only render mobile content when open=true — prevents
// duplicate WalletBalancePill when the sheet is closed.
vi.mock("@/components/ui/sheet", () => {
  const Sheet = ({ children, open }: { children: React.ReactNode; open?: boolean }) => {
    return open ? <>{children}</> : null
  }
  const SheetContent = ({ children }: { children: React.ReactNode }) => <div>{children}</div>
  const SheetHeader = ({ children }: { children: React.ReactNode }) => <div>{children}</div>
  const SheetTitle = ({ children }: { children: React.ReactNode }) => <div>{children}</div>
  return { Sheet, SheetContent, SheetHeader, SheetTitle }
})

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// ---------------------------------------------------------------------------
// SUT import
// ---------------------------------------------------------------------------

import { DashboardShell, type DashboardShellProps, type NavItem } from "../dashboard-shell"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Helper: creates a mock LucideIcon-compatible element for nav items
function mockIcon() {
  return (() => null) as unknown as NonNullable<NavItem["icon"]>
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", icon: mockIcon(), view: "client.dashboard" },
  { label: "Serviços", icon: mockIcon(), view: "client.services" },
]

const DEFAULT_PROPS: DashboardShellProps = {
  navItems: NAV_ITEMS,
  currentView: "client.dashboard",
  title: "Meu Painel",
  panelLabel: "Painel do Cliente",
  panelIcon: mockIcon(),
  user: null,
  onNavigate: vi.fn(),
  children: <div>Conteúdo</div>,
}

function renderShell(props: Partial<DashboardShellProps> = {}) {
  return render(<DashboardShell {...DEFAULT_PROPS} {...props} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthUser.current = null
  mockSessionExpiry.current = null
  mockNotificationsQuery = { data: undefined, isLoading: false }
  mockWalletQuery = { data: undefined, isLoading: false }
  // Isolamento defensivo: garante estado de sessão limpo entre testes.
  window.localStorage.clear()
})

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Accessibility (axe-core)
// ---------------------------------------------------------------------------

describe("DashboardShell — accessibility", () => {
  it("has no axe violations with CLIENT role", async () => {
    const { container } = renderShell({
      user: { role: "CLIENT", name: "Maria", email: "maria@test.com" },
    })
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations with PROVIDER role (includes wallet pill)", async () => {
    mockWalletQuery = {
      data: { balance: 150, pendingBalance: 50 },
      isLoading: false,
    }
    const { container } = renderShell({
      user: { role: "PROVIDER", name: "João", email: "joao@test.com" },
    })
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations with ADMIN role", async () => {
    const { container } = renderShell({
      user: { role: "ADMIN", name: "Admin", email: "admin@test.com" },
    })
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations when user is null (guest)", async () => {
    const { container } = renderShell({ user: null })
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DashboardShell — notification sound integration", () => {
  // ── Sound hook receives correct arguments ────────────────────────────────

  it("calls useTransactionNotificationSound with empty items when no notifications data", () => {
    mockNotificationsQuery = { data: undefined, isLoading: false }
    renderShell({ user: { role: "CLIENT" } })

    expect(mockUseTransactionNotificationSound).toHaveBeenCalledWith([], "CLIENT")
  })

  it("calls useTransactionNotificationSound with notification items from query", () => {
    const items = [
      {
        id: "1",
        type: "BOOKING_CONFIRMED",
        title: "Nova reserva",
        read: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: "2",
        type: "MESSAGE",
        title: "Nova mensagem",
        read: true,
        createdAt: new Date().toISOString(),
      },
    ]
    mockNotificationsQuery = {
      data: { items, total: 2, page: 1, limit: 10, unreadCount: 1 },
      isLoading: false,
    }
    renderShell({ user: { role: "PROVIDER" } })

    expect(mockUseTransactionNotificationSound).toHaveBeenCalledWith(items, "PROVIDER")
  })

  it("calls useTransactionNotificationSound with undefined role when user is null", () => {
    mockNotificationsQuery = { data: undefined, isLoading: false }
    renderShell({ user: null })

    expect(mockUseTransactionNotificationSound).toHaveBeenCalledWith([], undefined)
  })

  it("calls useTransactionNotificationSound with ADMIN role for admin users", () => {
    mockNotificationsQuery = { data: undefined, isLoading: false }
    renderShell({ user: { role: "ADMIN" } })

    expect(mockUseTransactionNotificationSound).toHaveBeenCalledWith([], "ADMIN")
  })

  it("updates useTransactionNotificationSound when new notifications arrive", () => {
    // Initial: no items, CLIENT role
    const items1: Array<{
      id: string
      type: string
      title: string
      read: boolean
      createdAt: string
    }> = []
    mockNotificationsQuery = {
      data: { items: items1, total: 0, page: 1, limit: 10, unreadCount: 0 },
      isLoading: false,
    }
    const { rerender } = render(
      <DashboardShell {...DEFAULT_PROPS} user={{ role: "CLIENT" }}>
        <div>Conteúdo</div>
      </DashboardShell>,
    )

    // First call should be with empty items
    expect(mockUseTransactionNotificationSound).toHaveBeenLastCalledWith([], "CLIENT")

    // New notification arrives
    const items2 = [
      {
        id: "10",
        type: "BOOKING_COMPLETED",
        title: "Serviço concluído",
        read: false,
        createdAt: new Date().toISOString(),
      },
    ]
    mockNotificationsQuery = {
      data: { items: items2, total: 1, page: 1, limit: 10, unreadCount: 1 },
      isLoading: false,
    }
    rerender(
      <DashboardShell {...DEFAULT_PROPS} user={{ role: "CLIENT" }}>
        <div>Conteúdo</div>
      </DashboardShell>,
    )

    // Should now be called with the new items
    expect(mockUseTransactionNotificationSound).toHaveBeenLastCalledWith(items2, "CLIENT")
  })

  // ── Unread count badge ───────────────────────────────────────────────────

  it("renders unread count badge when there are unread notifications", () => {
    const items = [
      {
        id: "1",
        type: "BOOKING_CONFIRMED",
        title: "Reserva",
        read: false,
        createdAt: new Date().toISOString(),
      },
    ]
    mockNotificationsQuery = {
      data: { items, total: 1, page: 1, limit: 10, unreadCount: 1 },
      isLoading: false,
    }
    renderShell({ user: { role: "CLIENT" } })

    // The bell icon badge should render the count
    expect(screen.getByText("1")).toBeDefined()
  })

  it("renders '9+' for unread count when > 9", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: String(i + 1),
      type: "BOOKING_CONFIRMED" as const,
      title: `Reserva ${i + 1}`,
      read: false,
      createdAt: new Date().toISOString(),
    }))
    mockNotificationsQuery = {
      data: { items, total: 12, page: 1, limit: 10, unreadCount: 12 },
      isLoading: false,
    }
    renderShell({ user: { role: "CLIENT" } })

    // Should show "9+" instead of the raw count
    expect(screen.getByText("9+")).toBeDefined()
  })

  // ── Title and children render ────────────────────────────────────────────

  it("renders the title and children", () => {
    renderShell({ title: "Dashboard Teste" })
    expect(screen.getByText("Dashboard Teste")).toBeDefined()
    expect(screen.getByText("Conteúdo")).toBeDefined()
  })

  it("renders subtitle when provided", () => {
    renderShell({ subtitle: "Painel principal" })
    expect(screen.getByText("Painel principal")).toBeDefined()
  })

  it("renders breadcrumbs when provided", () => {
    renderShell({
      breadcrumbs: [{ label: "Home", onClick: vi.fn() }, { label: "Dashboard" }],
    })
    // "Dashboard" also appears as a nav-item label — use getAllByText
    const breadcrumbDashboards = screen.getAllByText("Dashboard")
    expect(breadcrumbDashboards.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText("Home")).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// MuteIndicator & VibrationIndicator — topbar indicators
// ---------------------------------------------------------------------------

describe("DashboardShell — MuteIndicator & VibrationIndicator", () => {
  it("renders MuteIndicator with default 'Som ativado' title", () => {
    renderShell()
    expect(screen.getByTitle("Som ativado")).toBeInTheDocument()
  })

  it("renders VibrationIndicator with default 'Vibração ativada' title", () => {
    renderShell()
    expect(screen.getByTitle("Vibração ativada")).toBeInTheDocument()
  })

  it("both indicators render together without crashing", () => {
    renderShell()
    expect(screen.getByTitle("Som ativado")).toBeInTheDocument()
    expect(screen.getByTitle("Vibração ativada")).toBeInTheDocument()
  })

  it("shows 'Som desativado' when user has soundEnabled=false", () => {
    mockAuthUser.current = { soundEnabled: false }
    renderShell()
    expect(screen.getByTitle("Som desativado")).toBeInTheDocument()
    expect(screen.queryByTitle("Som ativado")).toBeNull()
  })

  it("shows 'Vibração desativada' when user has vibrateEnabled=false", () => {
    mockAuthUser.current = { vibrateEnabled: false }
    renderShell()
    expect(screen.getByTitle("Vibração desativada")).toBeInTheDocument()
    expect(screen.queryByTitle("Vibração ativada")).toBeNull()
  })

  it("shows 'Som ativado' when user has soundEnabled=true", () => {
    mockAuthUser.current = { soundEnabled: true }
    renderShell()
    expect(screen.getByTitle("Som ativado")).toBeInTheDocument()
  })

  it("shows 'Vibração ativada' when user has vibrateEnabled=true", () => {
    mockAuthUser.current = { vibrateEnabled: true }
    renderShell()
    expect(screen.getByTitle("Vibração ativada")).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// SessionExpiryBanner tests (countdown + renovação proativa)
// ---------------------------------------------------------------------------

describe("DashboardShell — SessionExpiryBanner", () => {
  const DAY = 24 * 60 * 60
  const now = Math.floor(Date.now() / 1000)

  it("mostra o countdown quando a sessão expira em ≤ 7 dias", () => {
    mockSessionExpiry.current = now + 3 * DAY
    renderShell({ user: { role: "CLIENT" } })
    expect(screen.getByText(/Sua sessão expira em/)).toBeDefined()
    // Banner E pill podem renderizar o countdown juntos — getAllByText.
    expect(screen.getAllByText("3 dias").length).toBeGreaterThanOrEqual(1)
  })

  it("mostra '1 dia' no singular", () => {
    mockSessionExpiry.current = now + 1 * DAY
    renderShell({ user: { role: "CLIENT" } })
    expect(screen.getAllByText("1 dia").length).toBeGreaterThanOrEqual(1)
  })

  it("NÃO mostra o banner quando a sessão expira além de 7 dias", () => {
    mockSessionExpiry.current = now + 20 * DAY
    renderShell({ user: { role: "CLIENT" } })
    expect(screen.queryByText(/Sua sessão expira em/)).toBeNull()
  })

  it("NÃO mostra o banner sem sessão autenticada (sem expiresAt)", () => {
    mockSessionExpiry.current = null
    renderShell({ user: { role: "CLIENT" } })
    // A pill do dropdown também some sem sessão.
    expect(screen.queryByText(/Sua sessão expira em/)).toBeNull()
    expect(screen.queryByTestId("session-expiry-info")).toBeNull()
  })

  it("NÃO mostra o banner quando o cookie já expirou (days = 0)", () => {
    mockSessionExpiry.current = now - 60 // já passou
    renderShell({ user: { role: "CLIENT" } })
    expect(screen.queryByText(/Sua sessão expira em/)).toBeNull()
  })

  it("o botão Renovar chama renewSession (renovação proativa NÃO-destrutiva)", () => {
    mockSessionExpiry.current = now + 2 * DAY
    renderShell({ user: { role: "CLIENT" } })
    fireEvent.click(screen.getByRole("button", { name: /Renovar/ }))
    // Renew reusa a ação dedicada do store — NUNCA fetchMe (que em erro de
    // rede marca unauthenticated e derruba o usuário para o login).
    expect(mockRenewSession).toHaveBeenCalledTimes(1)
    expect(mockFetchMe).not.toHaveBeenCalled()
  })

  it("o botão dispensar esconde o banner (dismiss local)", () => {
    mockSessionExpiry.current = now + 4 * DAY
    renderShell({ user: { role: "CLIENT" } })
    expect(screen.getByText(/Sua sessão expira em/)).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "Dispensar aviso" }))
    expect(screen.queryByText(/Sua sessão expira em/)).toBeNull()
  })

  it("o banner é acessível (role=status com o texto do countdown)", () => {
    mockSessionExpiry.current = now + 5 * DAY
    renderShell({ user: { role: "CLIENT" } })
    // Há vários role="status" no shell (indicadores etc.) — escopa pelo
    // conteúdo do banner em vez de assumir que é o único.
    const statuses = screen.getAllByRole("status")
    expect(statuses.some((el) => el.textContent?.includes("Sua sessão expira em"))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// SessionExpiryInfo tests (pill sempre visível no dropdown do usuário)
// ---------------------------------------------------------------------------

describe("DashboardShell — SessionExpiryInfo (pill do dropdown)", () => {
  const DAY = 24 * 60 * 60
  const now = Math.floor(Date.now() / 1000)

  it("mostra o countdown na pill quando há sessão (15–30d — operação normal)", () => {
    // A rotação deslizante mantém o expiry entre 15–30d; a pill mostra SEMPRE
    // (diferente do banner, que só aparece ≤7d).
    mockSessionExpiry.current = now + 20 * DAY
    renderShell({ user: { role: "CLIENT" } })
    const pill = screen.getByTestId("session-expiry-info")
    expect(pill.textContent).toContain("Sessão expira em")
    expect(pill.textContent).toContain("20 dias")
  })

  it("mostra '1 dia' na pill no singular", () => {
    mockSessionExpiry.current = now + 1 * DAY
    renderShell({ user: { role: "CLIENT" } })
    expect(screen.getByTestId("session-expiry-info").textContent).toContain("1 dia")
  })

  it("NÃO mostra a pill sem sessão autenticada", () => {
    mockSessionExpiry.current = null
    renderShell({ user: { role: "CLIENT" } })
    expect(screen.queryByTestId("session-expiry-info")).toBeNull()
  })

  it("NÃO mostra a pill quando o cookie já expirou", () => {
    mockSessionExpiry.current = now - 60
    renderShell({ user: { role: "CLIENT" } })
    expect(screen.queryByTestId("session-expiry-info")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// WalletBalancePill tests (provider-only sound + balance indicator)
// ---------------------------------------------------------------------------

describe("DashboardShell — WalletBalancePill (provider wallet)", () => {
  it("renders the wallet pill for PROVIDER role with balance", () => {
    mockWalletQuery = {
      data: { balance: 150, pendingBalance: 50 },
      isLoading: false,
    }
    renderShell({ user: { role: "PROVIDER" } })

    // The balance text appears on the button AND inside the tooltip (same instance)
    const balanceTexts = screen.getAllByText("R$ 150,00")
    expect(balanceTexts.length).toBeGreaterThanOrEqual(1)
  })

  it("does NOT render wallet pill for CLIENT role even with balance", () => {
    mockWalletQuery = {
      data: { balance: 150, pendingBalance: 50 },
      isLoading: false,
    }
    renderShell({ user: { role: "CLIENT" } })

    expect(screen.queryByText("R$ 150,00")).toBeNull()
  })

  it("does NOT render wallet pill when balance is 0", () => {
    mockWalletQuery = {
      data: { balance: 0, pendingBalance: 0 },
      isLoading: false,
    }
    renderShell({ user: { role: "PROVIDER" } })

    expect(screen.queryByText("R$ 0,00")).toBeNull()
  })

  it("calls useBalancePulse with balance and playCoin for PROVIDER", () => {
    mockWalletQuery = {
      data: { balance: 200, pendingBalance: 30 },
      isLoading: false,
    }
    renderShell({ user: { role: "PROVIDER" } })

    expect(mockUseBalancePulse).toHaveBeenCalledWith(200, mockPlayCoin)
  })

  it("shows loading skeleton when wallet query is loading", () => {
    mockWalletQuery = { data: undefined, isLoading: true }
    renderShell({ user: { role: "PROVIDER" } })

    // WalletBalancePill renders a div with "animate-pulse" class when loading
    const skeleton = document.querySelector(".animate-pulse")
    expect(skeleton).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Nav item badge tests
// ---------------------------------------------------------------------------

describe("DashboardShell — nav item badges", () => {
  it("renders badge on nav items when badge is provided", () => {
    const itemsWithBadge: NavItem[] = [
      { label: "Mensagens", icon: mockIcon(), view: "client.messages", badge: 3 },
      { label: "Dashboard", icon: mockIcon(), view: "client.dashboard" },
    ]
    renderShell({
      navItems: itemsWithBadge,
      user: { role: "CLIENT" },
    })

    // "3" appears in notifications unread badge AND in the nav badge
    const threes = screen.getAllByText("3")
    expect(threes.length).toBeGreaterThanOrEqual(1)
  })

  it("does not render badge on nav items without badge prop", () => {
    renderShell({ user: { role: "CLIENT" } })

    // Default nav items don't have badges set
    expect(screen.queryByText("3")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("DashboardShell — edge cases", () => {
  it("handles null notifications data gracefully (no crash)", () => {
    mockNotificationsQuery = { data: null, isLoading: false }
    expect(() => renderShell({ user: { role: "CLIENT" } })).not.toThrow()
  })

  it("handles undefined user gracefully (no crash)", () => {
    expect(() => renderShell({ user: undefined })).not.toThrow()
  })

  it("handles empty nav items without crashing", () => {
    expect(() => renderShell({ navItems: [], user: { role: "ADMIN" } })).not.toThrow()
  })
})
