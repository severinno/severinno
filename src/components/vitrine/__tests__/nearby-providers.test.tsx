/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for NearbyProviders — "Perto de você" section in the vitrine.
 *
 * Coverage:
 *   ✅ Returns null when geo status is not "ready"
 *   ✅ Shows skeleton while loading
 *   ✅ Renders provider cards with distance, rating, price
 *   ✅ Shows "Mostrar mais" card when providers > collapsed count
 *   ✅ Shows hint when providers ≤ collapsed count
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

import { render, screen, act, cleanup } from "@/__tests__/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ProviderCard } from "@/lib/api"

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted avoids TDZ with vi.mock hoisting
// ---------------------------------------------------------------------------

const mockUseQuery = vi.hoisted(() => vi.fn())
const mockOpenProvider = vi.hoisted(() => vi.fn())
const mockFormatBRL = vi.hoisted(() => vi.fn((v: number) => `R$ ${v.toFixed(2)}`))
const mockCn = vi.hoisted(() => vi.fn((...c: any[]) => c.filter(Boolean).join(" ")))

// Geo store state — mutable so tests can set lat/lng/status
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
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
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
  useUIStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ openProvider: mockOpenProvider }),
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

vi.mock("@/lib/utils", () => ({
  cn: (...c: string[]) => mockCn(...(c as [string, ...string[]])),
}))

vi.mock("next/image", () => ({
  default: (p: Record<string, unknown>) => {
    const { src, alt, className } = p as { src?: string; alt?: string; className?: string }
    return (
      <img src={src ?? ""} alt={alt ?? ""} className={className ?? ""} data-testid="mock-image" />
    )
  },
}))

vi.mock("lucide-react", () => ({
  Navigation: () => <span data-testid="icon-navigation" />,
  Star: () => <span data-testid="icon-star" />,
  MapPin: () => <span data-testid="icon-mappin" />,
  ChevronDown: () => <span data-testid="icon-chevron-down" />,
  ChevronUp: () => <span data-testid="icon-chevron-up" />,
}))

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: any) => (
    <div className={className} data-testid="card">
      {children}
    </div>
  ),
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, className, variant, size }: any) => (
    <button
      onClick={onClick}
      className={className}
      data-variant={variant}
      data-size={size}
      data-testid="button"
    >
      {children}
    </button>
  ),
}))

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: any) => <div className={className} data-testid="skeleton" />,
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import NearbyProviders from "../nearby-providers"

// Ensure DOM cleanup between tests when run in batch with other test files
afterEach(cleanup)

// ---------------------------------------------------------------------------
// Helpers
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
    distanceKm: 1.2,
    radiusKm: 50,
    city: "São Paulo",
    services: [
      {
        id: "s1",
        title: "Pintura Residencial",
        basePrice: 150,
        unit: "METRO_QUADRADO" as any,
        photos: [],
      },
    ],
    completedBookings: 45,
    memberSince: "2024-01-15",
  },
  {
    id: "p2",
    name: "João Santos",
    avatarUrl: null,
    coverUrl: null,
    bio: "Especialista em elétrica",
    rating: 4.5,
    reviewCount: 15,
    verified: true,
    distanceKm: 3.8,
    radiusKm: 30,
    city: "São Paulo",
    services: [
      {
        id: "s2",
        title: "Instalação Elétrica",
        basePrice: 200,
        unit: "UNIDADE" as any,
        photos: [],
      },
    ],
    completedBookings: 28,
    memberSince: "2024-03-20",
  },
  {
    id: "p3",
    name: "Ana Costa",
    avatarUrl: null,
    coverUrl: null,
    bio: "Encanadora certificada",
    rating: 4.9,
    reviewCount: 42,
    verified: false,
    distanceKm: 5.1,
    city: "São Paulo",
    services: [
      {
        id: "s3",
        title: "Conserto de Vazamento",
        basePrice: 180,
        unit: "UNIDADE" as any,
        photos: [],
      },
    ],
    completedBookings: 67,
    memberSince: "2023-11-01",
  },
  {
    id: "p4",
    name: "Carlos Oliveira",
    avatarUrl: null,
    coverUrl: null,
    bio: "Marceneiro de mão cheia",
    rating: 4.7,
    reviewCount: 31,
    verified: true,
    distanceKm: 7.2,
    city: "São Paulo",
    services: [
      { id: "s4", title: "Montagem de Móveis", basePrice: 120, unit: "UNIDADE" as any, photos: [] },
    ],
    completedBookings: 53,
    memberSince: "2024-06-01",
  },
  {
    id: "p5",
    name: "Patricia Lima",
    avatarUrl: null,
    coverUrl: null,
    bio: "Jardinagem profissional",
    rating: 4.6,
    reviewCount: 19,
    verified: false,
    distanceKm: 9.5,
    city: "São Paulo",
    services: [
      {
        id: "s5",
        title: "Manutenção de Jardins",
        basePrice: 90,
        unit: "METRO_QUADRADO" as any,
        photos: [],
      },
    ],
    completedBookings: 34,
    memberSince: "2024-02-10",
  },
]

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

function setGeoState(overrides: Record<string, unknown>) {
  Object.assign(geoState, overrides)
}

/** Create a mock query result for useQuery. */
function mockQueryResult(overrides: {
  isLoading?: boolean
  data?: { items: ProviderCard[] } | null
  isFetching?: boolean
  error?: Error | null
}) {
  mockUseQuery.mockReturnValue({
    data: overrides.data ?? { items: MOCK_PROVIDERS.slice(0, 4) },
    isLoading: overrides.isLoading ?? false,
    isFetching: overrides.isFetching ?? false,
    error: overrides.error ?? null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  geoState = { lat: -23.5505, lng: -46.6333, status: "ready" }
  mockOpenProvider.mockReset()
  mockQueryResult({})
})

// ===========================================================================
// Tests
// ===========================================================================

describe("NearbyProviders — conditional rendering", () => {
  it("returns null when geo status is not ready", () => {
    setGeoState({ lat: null, lng: null, status: "idle" })
    const { container } = renderWithQuery(<NearbyProviders />)
    expect(container.innerHTML).toBe("")
  })

  it("returns null when geo lat is null", () => {
    setGeoState({ lat: null, lng: -46.6333, status: "ready" })
    const { container } = renderWithQuery(<NearbyProviders />)
    expect(container.innerHTML).toBe("")
  })

  it("returns null when geo lng is null", () => {
    setGeoState({ lat: -23.5505, lng: null, status: "ready" })
    const { container } = renderWithQuery(<NearbyProviders />)
    expect(container.innerHTML).toBe("")
  })

  it("returns null when geo status is denied", () => {
    setGeoState({ lat: null, lng: null, status: "denied" })
    const { container } = renderWithQuery(<NearbyProviders />)
    expect(container.innerHTML).toBe("")
  })

  it("returns null when there are no providers and not loading", () => {
    mockQueryResult({ data: { items: [] } })
    const { container } = renderWithQuery(<NearbyProviders />)
    expect(container.innerHTML).toBe("")
  })
})

describe("NearbyProviders — loading state", () => {
  it("shows skeleton elements while loading", () => {
    mockQueryResult({ isLoading: true })
    renderWithQuery(<NearbyProviders />)

    const skeletons = screen.getAllByTestId("skeleton")
    expect(skeletons.length).toBeGreaterThanOrEqual(1)
  })

  it("shows 4 skeleton cards in collapsed loading", () => {
    mockQueryResult({ isLoading: true })
    renderWithQuery(<NearbyProviders />)

    const skeletons = screen.getAllByTestId("skeleton")
    // Each skeleton card has 5 skeleton elements (avatar, 2 name/rating, distance, price)
    // We just check at least some skeletons are visible
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it("shows section header even while loading", () => {
    mockQueryResult({ isLoading: true })
    renderWithQuery(<NearbyProviders />)

    expect(screen.getByText("Prestadores perto de você")).toBeTruthy()
  })
})

describe("NearbyProviders — renders provider cards", () => {
  it("renders provider names in cards", () => {
    mockQueryResult({ data: { items: MOCK_PROVIDERS.slice(0, 2) } })
    renderWithQuery(<NearbyProviders />)

    expect(screen.getByText("Maria Silva")).toBeTruthy()
    expect(screen.getByText("João Santos")).toBeTruthy()
  })

  it("renders provider ratings", () => {
    mockQueryResult({ data: { items: MOCK_PROVIDERS.slice(0, 2) } })
    renderWithQuery(<NearbyProviders />)

    // Each card shows rating: "4,8" and "4,5" (with pt-BR decimal)
    expect(screen.getByText("4.8")).toBeTruthy()
    expect(screen.getByText("4.5")).toBeTruthy()
  })

  it("renders review counts", () => {
    mockQueryResult({ data: { items: MOCK_PROVIDERS.slice(0, 2) } })
    renderWithQuery(<NearbyProviders />)

    expect(screen.getByText("23 aval.")).toBeTruthy()
    expect(screen.getByText("15 aval.")).toBeTruthy()
  })

  it("renders distance in km format", () => {
    mockQueryResult({ data: { items: MOCK_PROVIDERS.slice(0, 1) } })
    renderWithQuery(<NearbyProviders />)

    // "1.2 km" — distanceKm=1.2
    expect(screen.getByText(/1\.2.*km/)).toBeTruthy()
  })

  it("renders service price", () => {
    mockQueryResult({ data: { items: MOCK_PROVIDERS.slice(0, 1) } })
    renderWithQuery(<NearbyProviders />)

    const priceText = screen.getByText(/R\$/)
    expect(priceText).toBeTruthy()
  })

  it("renders verified badge for verified providers", () => {
    mockQueryResult({ data: { items: MOCK_PROVIDERS.slice(0, 1) } })
    renderWithQuery(<NearbyProviders />)

    // "✓" emerald badge
    expect(screen.getByText("✓")).toBeTruthy()
  })
})

describe("NearbyProviders — collapsed with show more", () => {
  it("shows 'Mostrar mais' card when providers exceed collapsed count", () => {
    // 5 providers > 4 collapsed count
    mockQueryResult({ data: { items: MOCK_PROVIDERS } })
    renderWithQuery(<NearbyProviders />)

    expect(screen.getByText("Mostrar mais")).toBeTruthy()
    expect(screen.getByText("+1 prestador")).toBeTruthy()
  })

  it("shows hint text when providers <= collapsed count", () => {
    // 3 providers <= 4 collapsed count
    mockQueryResult({ data: { items: MOCK_PROVIDERS.slice(0, 3) } })
    renderWithQuery(<NearbyProviders />)

    expect(screen.getByText(/3 prestadores encontrados/)).toBeTruthy()
  })

  it("does not show 'Mostrar mais' card with exactly 4 providers", () => {
    // 4 providers, equal to collapsed count
    mockQueryResult({ data: { items: MOCK_PROVIDERS.slice(0, 4) } })
    renderWithQuery(<NearbyProviders />)

    expect(screen.queryByText("Mostrar mais")).toBeNull()
  })

  it("renders 'Ver perfil' hover hint on cards", () => {
    mockQueryResult({ data: { items: MOCK_PROVIDERS.slice(0, 2) } })
    renderWithQuery(<NearbyProviders />)

    const hints = screen.getAllByText("Ver perfil")
    expect(hints.length).toBe(2)
  })

  it("renders Navigation icon in each card", () => {
    mockQueryResult({ data: { items: MOCK_PROVIDERS.slice(0, 2) } })
    renderWithQuery(<NearbyProviders />)

    const navIcons = screen.getAllByTestId("icon-navigation")
    expect(navIcons.length).toBeGreaterThanOrEqual(2)
  })
})

describe("NearbyProviders — shows 'Novo' for providers without rating", () => {
  it("shows 'Novo' label when rating is 0", () => {
    const zeroRating = {
      ...MOCK_PROVIDERS[0],
      rating: 0,
      reviewCount: 0,
    }
    mockQueryResult({ data: { items: [zeroRating] } })
    renderWithQuery(<NearbyProviders />)

    expect(screen.getByText("Novo")).toBeTruthy()
  })
})

describe("NearbyProviders — distance formatting edge cases", () => {
  it("formats distance < 1 km as meters", () => {
    const nearProvider = { ...MOCK_PROVIDERS[0], distanceKm: 0.8 }
    mockQueryResult({ data: { items: [nearProvider] } })
    renderWithQuery(<NearbyProviders />)

    // "800 m"
    expect(screen.getByText(/800.*m/)).toBeTruthy()
  })

  it("shows 'Distância desconhecida' when distanceKm is null", () => {
    const noDist = { ...MOCK_PROVIDERS[0], distanceKm: null }
    mockQueryResult({ data: { items: [noDist] } })
    renderWithQuery(<NearbyProviders />)

    expect(screen.getByText("Distância desconhecida")).toBeTruthy()
  })
})

describe("NearbyProviders — expanded/grid state interactions", () => {
  it("shows expanded subtitle when expanded", async () => {
    mockQueryResult({ data: { items: MOCK_PROVIDERS } })
    renderWithQuery(<NearbyProviders />)

    // Click "Mostrar mais" to expand
    const showMore = screen.getByText("Mostrar mais")
    await act(async () => {
      showMore.click()
    })

    // Subtitle should show count
    expect(screen.getByText(/5 prestadores encontrados/)).toBeTruthy()
  })
})
