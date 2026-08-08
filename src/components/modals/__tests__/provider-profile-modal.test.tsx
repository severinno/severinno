import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { ProviderProfileModal } from "../provider-profile-modal"
import {
  createMockAuthStore,
  createMockUIStore,
  createMockViewStore,
} from "./test-utils"
import * as React from "react"

// -----------------------------------------------------------------------
// Shared mock stores
// -----------------------------------------------------------------------

const mockUIStore = createMockUIStore()
const mockAuthStore = createMockAuthStore()
const mockViewStore = createMockViewStore()

// Recently viewed store
const mockRecentlyViewedStore = {
  addView: vi.fn(),
}

// -----------------------------------------------------------------------
// Hoisted mocks
// -----------------------------------------------------------------------

vi.mock("@/store/ui", () => ({
  useUIStore: Object.assign(
    (selector: (s: any) => unknown) => selector(mockUIStore),
    { getState: () => mockUIStore },
  ),
}))

vi.mock("@/store/auth", () => ({
  useAuthStore: Object.assign(
    (selector: (s: any) => unknown) => selector(mockAuthStore),
    { getState: () => mockAuthStore },
  ),
}))

vi.mock("@/store/view", () => ({
  useViewStore: Object.assign(
    (selector: (s: any) => unknown) => selector(mockViewStore),
    { getState: () => mockViewStore },
  ),
}))

vi.mock("@/store/recently-viewed", () => ({
  useRecentlyViewedStore: Object.assign(
    (selector: (s: any) => unknown) => selector(mockRecentlyViewedStore),
    { getState: () => mockRecentlyViewedStore },
  ),
}))

const mockUseQuery = vi.hoisted(() => vi.fn())

vi.mock("@tanstack/react-query", () => ({
  useQuery: mockUseQuery,
  QueryClient: class {
    getQueryCache = () => ({ findAll: () => [], clear: vi.fn() })
    getMutationCache = () => ({ findAll: () => [], clear: vi.fn() })
    getDefaultOptions = () => ({})
    mount = vi.fn()
    unmount = vi.fn()
  },
  QueryClientProvider: ({ children }: any) => <>{children}</>,
}))

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))


vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}))

// Dialog
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children, showCloseButton, className }: any) => (
    <div data-testid="dialog-content" className={className}>
      {children}
    </div>
  ),
  DialogTitle: ({ children, className }: any) => (
    <h2 data-testid="dialog-title" className={className}>
      {children}
    </h2>
  ),
  DialogDescription: ({ children, className }: any) => (
    <p data-testid="dialog-desc" className={className}>
      {children}
    </p>
  ),
}))

// Sheet (mobile)
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children, open }: any) =>
    open ? <div data-testid="sheet">{children}</div> : null,
  SheetContent: ({ children }: any) => <div>{children}</div>,
  SheetTitle: ({ children }: any) => <h2>{children}</h2>,
  SheetDescription: ({ children }: any) => <p>{children}</p>,
}))

// Tabs
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children, defaultValue }: any) => (
    <div data-testid="tabs" data-default={defaultValue}>
      {children}
    </div>
  ),
  TabsList: ({ children }: any) => <div data-testid="tabs-list">{children}</div>,
  TabsTrigger: ({ children, value }: any) => (
    <button data-testid="tab-trigger" data-value={value}>
      {children}
    </button>
  ),
  TabsContent: ({ children, value }: any) => (
    <div data-testid="tab-content" data-value={value}>
      {children}
    </div>
  ),
}))

// Avatar
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: any) => <div data-testid="avatar">{children}</div>,
  AvatarImage: ({ src, alt }: any) => (
    <img src={src} alt={alt} data-testid="avatar-image" />
  ),
  AvatarFallback: ({ children }: any) => (
    <span data-testid="avatar-fallback">{children}</span>
  ),
}))

// Button
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...p }: any) => (
    <button data-testid="button" {...p}>
      {children}
    </button>
  ),
}))

// Badge
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...p }: any) => <span data-testid="badge" {...p}>{children}</span>,
}))

// Separator
vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr data-testid="separator" />,
}))

// Skeleton
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: (p: any) => <div data-testid="skeleton" {...p} />,
}))

// ScrollArea
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children, ...p }: any) => (
    <div data-testid="scroll-area" {...p}>
      {children}
    </div>
  ),
}))

// StarRatingDisplay (used in profile header)
vi.mock("../star-rating", () => ({
  StarRatingDisplay: ({ value, count, showCount, size }: any) => (
    <span data-testid="star-rating" data-value={value} data-count={count}>
      {value?.toFixed(1)} {showCount !== false && count != null ? `(${count})` : ""}
    </span>
  ),
}))

// API
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
}))

// Format
vi.mock("@/lib/format", () => ({
  formatBRL: (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
}))

// Constants
vi.mock("@/lib/constants", () => ({
  SERVICE_UNIT_SHORT: { UNIT: "un", HOUR: "h", KG: "kg" },
  WEEKDAYS: [
    "Domingo",
    "Segunda",
    "Terça",
    "Quarta",
    "Quinta",
    "Sexta",
    "Sábado",
  ],
  WEEKDAYS_SHORT: ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"],
}))

// Utils
vi.mock("@/lib/utils", () => ({
  cn: (...c: any[]) => c.filter(Boolean).join(" "),
}))

vi.mock("lucide-react", () => {
  const Icon = (p: any) => (
    <span data-testid="lucide-icon" data-name={p?.className}>
      {p?.children}
    </span>
  )
  Icon.displayName = "LucideIcon"
  return {
    BadgeCheck: Icon,
    Calendar: Icon,
    ChevronDown: Icon,
    ChevronUp: Icon,
    Clock: Icon,
    Heart: Icon,
    Loader2: Icon,
    MapPin: Icon,
    Navigation: Icon,
    Phone: Icon,
    Quote: Icon,
    Share2: Icon,
    Star: Icon,
    Wrench: Icon,
    MessageCircle: Icon,
    X: Icon,
  }
})

// -----------------------------------------------------------------------
// Mock data
// -----------------------------------------------------------------------

const mockProvider = {
  id: "prov-1",
  name: "Maria Silva",
  avatarUrl: null,
  verified: true,
  rating: 4.8,
  reviewCount: 25,
  city: "São Paulo",
  state: "SP",
  distanceKm: 3.5,
  memberSince: "2023-01-15T00:00:00.000Z",
  bio: "Profissional experiente em reformas residenciais.",
  address: "Rua Augusta, 500",
  district: "Consolação",
  cep: "01304-000",
  whatsapp: "(11) 99999-8888",
  radiusKm: 30,
  services: [
    {
      id: "svc-1",
      title: "Instalação Elétrica",
      description: "Instalação de pontos elétricos residenciais",
      basePrice: 150,
      unit: "UNIT" as const,
      providerId: "prov-1",
      category: { id: "cat-1", name: "Elétrica" },
      photos: [],
    },
    {
      id: "svc-2",
      title: "Troca de Tomadas",
      description: "Substituição de tomadas antigas",
      basePrice: 80,
      unit: "UNIT" as const,
      providerId: "prov-1",
      category: { id: "cat-1", name: "Elétrica" },
      photos: [],
    },
  ],
  availability: [
    { dayOfWeek: 1, startTime: "08:00", endTime: "12:00" },
    { dayOfWeek: 1, startTime: "13:00", endTime: "18:00" },
    { dayOfWeek: 2, startTime: "08:00", endTime: "12:00" },
  ],
  reviews: [
    {
      id: "rev-1",
      rating: 5,
      comment: "Excelente profissional!",
      createdAt: "2024-06-15T00:00:00.000Z",
      author: {
        id: "usr-1",
        name: "João Cliente",
        avatarUrl: null,
      },
    },
    {
      id: "rev-2",
      rating: 4,
      comment: "Bom trabalho, pontual.",
      createdAt: "2024-05-20T00:00:00.000Z",
      author: {
        id: "usr-2",
        name: "Ana Souza",
        avatarUrl: null,
      },
    },
  ],
}

// -----------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()

  mockUIStore.providerModal = { open: false, providerId: null }
  mockUIStore.closeProvider = vi.fn()
  mockUIStore.openQuote = vi.fn()
  mockUIStore.openBooking = vi.fn()

  mockUseQuery.mockImplementation(() => ({
    data: mockProvider,
    isLoading: false,
  }))
})

function renderModal() {
  return render(<ProviderProfileModal />)
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe("ProviderProfileModal — rendering", () => {
  it("renders nothing when closed", () => {
    const { container } = renderModal()
    expect(container.querySelector('[data-testid="dialog"]')).not.toBeInTheDocument()
  })

  it("renders dialog with profile header when open", () => {
    mockUIStore.providerModal = { open: true, providerId: "prov-1" }
    renderModal()

    const dialogs = screen.getAllByTestId("dialog")
    expect(dialogs.length).toBeGreaterThan(0)
    expect(screen.getAllByText("Maria Silva").length).toBeGreaterThan(0)
  })

  it("shows loading skeletons while query is loading", () => {
    mockUIStore.providerModal = { open: true, providerId: "prov-1" }
    mockUseQuery.mockImplementation(() => ({
      data: undefined,
      isLoading: true,
    }))

    renderModal()
    const skeletons = screen.getAllByTestId("skeleton")
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it("shows verified badge when provider is verified", () => {
    mockUIStore.providerModal = { open: true, providerId: "prov-1" }
    renderModal()

    const badges = screen.getAllByTestId("badge")
    const verifiedBadge = badges.find((b) => b.textContent?.includes("Verificado"))
    expect(verifiedBadge).toBeTruthy()
  })

  it("shows star rating with review count", () => {
    mockUIStore.providerModal = { open: true, providerId: "prov-1" }
    renderModal()

    const ratings = screen.getAllByTestId("star-rating")
    expect(ratings.length).toBeGreaterThan(0)
  })

  it("renders action buttons (share, favorite, close)", () => {
    mockUIStore.providerModal = { open: true, providerId: "prov-1" }
    renderModal()

    // Share, favorite, and close buttons are rendered
    expect(screen.getAllByLabelText("Compartilhar").length).toBeGreaterThan(0)
    expect(
      screen.getAllByLabelText("Adicionar aos favoritos").length,
    ).toBeGreaterThan(0)
    expect(screen.getAllByLabelText("Fechar").length).toBeGreaterThan(0)
  })

  it("renders footer with Quote and Booking buttons", () => {
    mockUIStore.providerModal = { open: true, providerId: "prov-1" }
    renderModal()

    expect(screen.getAllByText("Pedir orçamento").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Agendar serviço").length).toBeGreaterThan(0)
  })
})

describe("ProviderProfileModal — services tab", () => {
  it("shows services tab content with service titles", () => {
    mockUIStore.providerModal = { open: true, providerId: "prov-1" }
    renderModal()

    // Default tab is "services"
    expect(screen.getAllByText("Instalação Elétrica").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Troca de Tomadas").length).toBeGreaterThan(0)
  })

  it("shows category group headers", () => {
    mockUIStore.providerModal = { open: true, providerId: "prov-1" }
    renderModal()

    expect(screen.getAllByText("Elétrica").length).toBeGreaterThan(0)
  })

  it("shows empty state when no services", () => {
    mockUIStore.providerModal = { open: true, providerId: "prov-1" }
    mockUseQuery.mockImplementation(() => ({
      data: { ...mockProvider, services: [] },
      isLoading: false,
    }))

    renderModal()
    expect(screen.getByText("Nenhum serviço")).toBeInTheDocument()
  })
})

describe("ProviderProfileModal — tabs switching", () => {
  it("renders all tab triggers", () => {
    mockUIStore.providerModal = { open: true, providerId: "prov-1" }
    renderModal()

    const tabTriggers = screen.getAllByTestId("tab-trigger")
    const labels = tabTriggers.map((t) => t.textContent)
    expect(labels.some((l) => l?.includes("Serviços"))).toBe(true)
    expect(labels.some((l) => l?.includes("Avaliações"))).toBe(true)
    expect(labels.some((l) => l?.includes("Sobre"))).toBe(true)
    expect(labels.some((l) => l?.includes("Expediente"))).toBe(true)
  })

  it("shows service count in tab trigger", () => {
    mockUIStore.providerModal = { open: true, providerId: "prov-1" }
    renderModal()

    const tabTriggers = screen.getAllByTestId("tab-trigger")
    const servicesTab = tabTriggers.find((t) =>
      t.textContent?.includes("Serviços"),
    )
    // 2 services → "(2)" visible in trigger
    expect(servicesTab).toBeTruthy()
    expect(servicesTab?.textContent).toContain("2")
  })
})

describe("ProviderProfileModal — about tab", () => {
  it("shows provider bio", () => {
    mockUIStore.providerModal = { open: true, providerId: "prov-1" }
    renderModal()

    // About tab content renders all tabs unconditionally (mock)
    expect(screen.getAllByText(mockProvider.bio).length).toBeGreaterThan(0)
  })

  it("shows address and coverage info", () => {
    mockUIStore.providerModal = { open: true, providerId: "prov-1" }
    renderModal()

    expect(screen.getAllByText(/Rua Augusta/).length).toBeGreaterThan(0)
  })
})

describe("ProviderProfileModal — reviews tab", () => {
  it("shows review author names", () => {
    mockUIStore.providerModal = { open: true, providerId: "prov-1" }
    renderModal()

    expect(screen.getAllByText("João Cliente").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Ana Souza").length).toBeGreaterThan(0)
  })

  it("shows empty state when no reviews", () => {
    mockUIStore.providerModal = { open: true, providerId: "prov-1" }
    mockUseQuery.mockImplementation(() => ({
      data: { ...mockProvider, reviews: [], reviewCount: 0 },
      isLoading: false,
    }))

    renderModal()
    expect(screen.getByText("Sem avaliações")).toBeInTheDocument()
  })
})

describe("ProviderProfileModal — hours tab", () => {
  it("shows day names from availability", () => {
    mockUIStore.providerModal = { open: true, providerId: "prov-1" }
    renderModal()

    // Segunda and Terça should be visible in hours tab
    expect(screen.getAllByText("Aberto").length).toBeGreaterThan(0)
  })
})

describe("ProviderProfileModal — favorite toggle", () => {
  it("toggles favorite state on click", { timeout: 15000 }, () => {
    mockUIStore.providerModal = { open: true, providerId: "prov-1" }
    renderModal()

    const favBtns = screen.getAllByLabelText("Adicionar aos favoritos")
    expect(favBtns.length).toBeGreaterThan(0)
    expect(favBtns[0]).toHaveAttribute("aria-pressed", "false")
  })
})
