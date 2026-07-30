/**
 * Tests for ProviderSpotlightGeo — "Prestadores próximos" section.
 *
 * Coverage:
 *   ✅ Returns null without location
 *   ✅ Returns null without providers (not loading)
 *   ✅ Shows skeletons while loading
 *   ✅ Renders desktop grid (sm+) with SpotlightCards
 *   ✅ Renders mobile carousel (sm-)
 *   ✅ Badge "Perto de você" with radiusKm
 *   ✅ Badge fallback to 2km when radiusKm unavailable
 *   ✅ Action buttons call callbacks
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, act, cleanup } from "@/__tests__/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ProviderCard } from "@/lib/api"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockUseQuery = vi.hoisted(() => vi.fn())
const mockFormatBRL = vi.hoisted(() => vi.fn((v: number) => `R$ ${v.toFixed(2)}`))
const mockFormatDistance = vi.hoisted(() =>
  vi.fn((d: number | null | undefined) => (d != null ? `${d.toFixed(1)} km` : "—")),
)
const mockCn = vi.hoisted(() => vi.fn((...c: any[]) => c.filter(Boolean).join(" ")))

let geoState: Record<string, unknown> = {
  lat: -23.5505,
  lng: -46.6333,
  status: "ready",
}

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => mockUseQuery(options),
  QueryClient: class {},
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("@/store/geo", () => ({
  useGeoStore: Object.assign(
    (selector?: (s: typeof geoState) => unknown) => (selector ? selector(geoState) : geoState),
    {
      getState: () => geoState,
      setState: (p: Record<string, unknown>) => Object.assign(geoState, p),
    },
  ),
}))

vi.mock("@/store/ui", () => ({
  useUIStore: () => ({ openProvider: vi.fn() }),
}))

vi.mock("@/lib/api", () => ({
  fetchProviders: vi.fn(),
  fetchGeoSearch: vi.fn(),
  fetchGeoSearchStructured: vi.fn(),
  fetchReverseGeo: vi.fn(),
  fetchCep: vi.fn(),
}))

vi.mock("@/lib/format", () => ({
  formatBRL: (v: number) => mockFormatBRL(v),
}))

vi.mock("@/lib/geo-client", () => ({
  formatDistance: (d: number | null | undefined) => mockFormatDistance(d),
}))

vi.mock("@/lib/utils", () => ({
  cn: (...c: string[]) => mockCn(...c),
}))

vi.mock("lucide-react", () => ({
  MapPin: () => <span data-testid="icon-mappin" />,
  Navigation: () => <span data-testid="icon-navigation" />,
  Star: () => <span data-testid="icon-star" />,
  Loader2: () => <span data-testid="icon-loading" />,
  ChevronRight: () => <span data-testid="icon-chevron-right" />,
  Wrench: () => <span data-testid="icon-wrench" />,
}))

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: any) => <div data-testid="avatar">{children}</div>,
  AvatarImage: (p: any) => <img data-testid="avatar-image" src={p.src} alt={p.alt} />,
  AvatarFallback: ({ children }: any) => <span data-testid="avatar-fallback">{children}</span>,
}))

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: any) => (
    <span className={className} data-testid="badge">
      {children}
    </span>
  ),
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, className }: any) => (
    <button onClick={onClick} className={className} data-testid="button">
      {children}
    </button>
  ),
}))

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: any) => <div className={className} data-testid="skeleton" />,
}))

vi.mock("@/components/ui/carousel", () => ({
  Carousel: ({ children }: any) => <div data-testid="carousel">{children}</div>,
  CarouselContent: ({ children }: any) => <div data-testid="carousel-content">{children}</div>,
  CarouselItem: ({ children }: any) => <div data-testid="carousel-item">{children}</div>,
  CarouselNext: () => <button data-testid="carousel-next">Next</button>,
  CarouselPrevious: () => <button data-testid="carousel-prev">Prev</button>,
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import ProviderSpotlightGeo from "../provider-spotlight-geo"

// Ensure DOM cleanup between tests when run in batch

import { afterEach } from "vitest"

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_PROVIDERS: ProviderCard[] = [
  {
    id: "p1",
    name: "Maria Silva",
    avatarUrl: null,
    coverUrl: null,
    bio: "Profissional experiente",
    rating: 4.8,
    reviewCount: 23,
    verified: true,
    distanceKm: 1.5, // within radiusKm=50 → perto
    radiusKm: 50,
    city: "São Paulo",
    services: [{ id: "s1", title: "Pintura", basePrice: 150, unit: "UNIDADE" as any, photos: [] }],
    completedBookings: 45,
    memberSince: "2024-01-15",
  },
  {
    id: "p2",
    name: "João Santos",
    avatarUrl: null,
    coverUrl: null,
    bio: "Eletricista",
    rating: 4.5,
    reviewCount: 15,
    verified: true,
    distanceKm: 8.2,
    radiusKm: 10, // 8.2 < 10 → perto
    city: "São Paulo",
    services: [
      { id: "s2", title: "Instalação", basePrice: 200, unit: "UNIDADE" as any, photos: [] },
    ],
    completedBookings: 28,
    memberSince: "2024-03-20",
  },
  {
    id: "p3",
    name: "Ana Costa",
    avatarUrl: null,
    coverUrl: null,
    bio: "Encanadora",
    rating: 4.9,
    reviewCount: 42,
    verified: false,
    distanceKm: 35,
    radiusKm: 30, // 35 > 30 → NOT perto
    city: "São Paulo",
    services: [{ id: "s3", title: "Conserto", basePrice: 180, unit: "UNIDADE" as any, photos: [] }],
    completedBookings: 67,
    memberSince: "2023-11-01",
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

function setGeoState(overrides: Record<string, unknown>) {
  Object.assign(geoState, overrides)
}

function mockQueryResult(overrides: {
  isLoading?: boolean
  data?: { items: ProviderCard[] } | null
}) {
  mockUseQuery.mockReturnValue({
    data: overrides.data ?? { items: MOCK_PROVIDERS },
    isLoading: overrides.isLoading ?? false,
    isFetching: false,
    error: null,
  })
}

const callbacks = {
  onQuote: vi.fn(),
  onBook: vi.fn(),
  onView: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  geoState = { lat: -23.5505, lng: -46.6333, status: "ready" }
  mockQueryResult({})
})

// ===========================================================================
// Tests
// ===========================================================================

describe("ProviderSpotlightGeo — conditional rendering", () => {
  it("returns null when geo status is not ready", () => {
    setGeoState({ lat: null, lng: null, status: "idle" })
    const { container } = renderWithQuery(<ProviderSpotlightGeo />)
    expect(container.innerHTML).toBe("")
  })

  it("returns null when lat is null", () => {
    setGeoState({ lat: null, status: "ready" })
    const { container } = renderWithQuery(<ProviderSpotlightGeo />)
    expect(container.innerHTML).toBe("")
  })

  it("returns null when lng is null", () => {
    setGeoState({ lng: null, status: "ready" })
    const { container } = renderWithQuery(<ProviderSpotlightGeo />)
    expect(container.innerHTML).toBe("")
  })

  it("returns null when no providers and not loading", () => {
    mockQueryResult({ data: { items: [] } })
    const { container } = renderWithQuery(<ProviderSpotlightGeo />)
    expect(container.innerHTML).toBe("")
  })
})

describe("ProviderSpotlightGeo — loading state", () => {
  it("shows skeleton elements while loading", () => {
    mockQueryResult({ isLoading: true })
    renderWithQuery(<ProviderSpotlightGeo />)

    const skeletons = screen.getAllByTestId("skeleton")
    expect(skeletons.length).toBeGreaterThanOrEqual(1)
  })

  it("shows header text while loading", () => {
    mockQueryResult({ isLoading: true })
    renderWithQuery(<ProviderSpotlightGeo />)

    expect(screen.getByText("Prestadores próximos")).toBeTruthy()
    expect(screen.getByText("Buscando na sua região…")).toBeTruthy()
  })
})

describe("ProviderSpotlightGeo — renders provider cards", () => {
  it("renders provider names in cards (desktop grid + mobile carousel)", () => {
    renderWithQuery(
      <ProviderSpotlightGeo
        onQuote={callbacks.onQuote}
        onBook={callbacks.onBook}
        onView={callbacks.onView}
      />,
    )

    // Each provider renders twice: desktop grid + mobile carousel
    expect(screen.getAllByText("Maria Silva").length).toBe(2)
    expect(screen.getAllByText("João Santos").length).toBe(2)
    expect(screen.getAllByText("Ana Costa").length).toBe(2)
  })

  it("renders 'a partir de R$' price hint", () => {
    renderWithQuery(
      <ProviderSpotlightGeo
        onQuote={callbacks.onQuote}
        onBook={callbacks.onBook}
        onView={callbacks.onView}
      />,
    )

    // All 3 providers × 2 layouts (grid + carousel) = 6 price hints
    const priceTexts = screen.getAllByText(/a partir de/)
    expect(priceTexts.length).toBe(6)
  })

  it("renders action buttons (Orçamento + Agendar) for each card", () => {
    renderWithQuery(
      <ProviderSpotlightGeo
        onQuote={callbacks.onQuote}
        onBook={callbacks.onBook}
        onView={callbacks.onView}
      />,
    )

    const buttons = screen.getAllByTestId("button")
    // Each card has 2 buttons (Orçamento, Agendar) × 3 cards = 6
    expect(buttons.length).toBeGreaterThanOrEqual(6)
  })

  it("shows distance hint at the bottom", () => {
    renderWithQuery(<ProviderSpotlightGeo />)

    expect(screen.getByText(/raio de até 100 km/)).toBeTruthy()
  })
})

describe("ProviderSpotlightGeo — badge Perto de você", () => {
  it("shows badge when distanceKm ≤ radiusKm (p1: 1.5 ≤ 50)", () => {
    renderWithQuery(<ProviderSpotlightGeo />)

    // Maria Silva: 1.5km ≤ 50km → badge
    const badges = screen.getAllByTestId("badge")
    const pertoBadges = badges.filter((b) => b.textContent?.includes("Perto de você"))
    expect(pertoBadges.length).toBeGreaterThanOrEqual(1)
  })

  it("shows badge when distanceKm ≤ radiusKm (p2: 8.2 ≤ 10)", () => {
    renderWithQuery(<ProviderSpotlightGeo />)

    // João Santos: 8.2km ≤ 10km → badge
    const badges = screen.getAllByText("Perto de você")
    expect(badges.length).toBeGreaterThanOrEqual(1)
  })

  it("does NOT show badge when distanceKm > radiusKm (p3: 35 > 30)", () => {
    renderWithQuery(<ProviderSpotlightGeo />)

    // Ana Costa: 35km > 30km → no badge
    // Maria (1.5 ≤ 50) + João (8.2 ≤ 10) + each appears in 2 layouts = 4 badges
    const badges = screen.getAllByText("Perto de você")
    expect(badges.length).toBe(4)
  })

  it("falls back to 2km threshold when radiusKm is undefined", () => {
    const noRadius = MOCK_PROVIDERS.map((p) => ({ ...p, radiusKm: undefined }))
    // Set p1 at 1.5km (still perto), p2 at 8.2km (NOT perto with <2 fallback)
    mockQueryResult({ data: { items: noRadius } })
    renderWithQuery(<ProviderSpotlightGeo />)

    // Only p1 (1.5km < 2) has badge — appears in both layouts = 2 badges
    // p2 (8.2km) and p3 (35km) should NOT have badges
    const badges = screen.getAllByText("Perto de você")
    expect(badges.length).toBe(2)
  })
})

describe("ProviderSpotlightGeo — callback actions", () => {
  it("calls onQuote when Orçamento button is clicked", async () => {
    renderWithQuery(
      <ProviderSpotlightGeo
        onQuote={callbacks.onQuote}
        onBook={callbacks.onBook}
        onView={callbacks.onView}
      />,
    )

    // Find first Orçamento button and click
    const quoteButtons = screen.getAllByText("Orçamento")
    await act(async () => {
      quoteButtons[0].click()
    })

    expect(callbacks.onQuote).toHaveBeenCalledWith("p1")
  })

  it("calls onBook when Agendar button is clicked", async () => {
    renderWithQuery(
      <ProviderSpotlightGeo
        onQuote={callbacks.onQuote}
        onBook={callbacks.onBook}
        onView={callbacks.onView}
      />,
    )

    const bookButtons = screen.getAllByText("Agendar")
    await act(async () => {
      bookButtons[0].click()
    })

    expect(callbacks.onBook).toHaveBeenCalledWith("p1")
  })

  it("calls onView when provider name area is clicked", async () => {
    renderWithQuery(
      <ProviderSpotlightGeo
        onQuote={callbacks.onQuote}
        onBook={callbacks.onBook}
        onView={callbacks.onView}
      />,
    )

    // Click on the first provider's name area (button wrapping Avatar + name)
    const viewButtons = screen.getAllByLabelText(/Ver perfil de/)
    await act(async () => {
      viewButtons[0].click()
    })

    expect(callbacks.onView).toHaveBeenCalledWith("p1")
  })
})
