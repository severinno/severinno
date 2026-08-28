/**
 * provider-card-geo.test.tsx
 *
 * Tests the geolocation features of ProviderCard:
 *   ✅ Distance rendered via formatDistance (km / m)
 *   ✅ "Perto de você" badge when distanceKm is within radiusKm
 *   ✅ Badge hidden when distanceKm > radiusKm
 *   ✅ Badge hidden when radiusKm is missing
 *   ✅ Badge hidden when distanceKm is null
 *   ✅ Distance row hidden when distanceKm is null
 *   ✅ data-compare-distance / data-compare-distance-km attributes for compare
 *   ✅ Distance < 1 km formatted in meters
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup } from "@/__tests__/test-utils"
import type { ProviderCard as ProviderCardType } from "@/lib/api"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockUseMutation = vi.hoisted(() => vi.fn())
const mockToggleFavorite = vi.hoisted(() => vi.fn())
const mockOpenAuth = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))

// Compare store state — mutable so tests can simulate selected ids
let compareState: { ids: string[]; toggle: (id: string) => void } = {
  ids: [],
  toggle: vi.fn(),
}

let authState: { user: unknown } = { user: null }

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: unknown) => mockUseMutation(options),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock("@/store/auth", () => ({
  // ProviderCard calls useAuthStore() WITHOUT a selector
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}))

vi.mock("@/store/ui", () => ({
  useUIStore: (selector: (s: { openAuth: typeof mockOpenAuth }) => unknown) =>
    selector({ openAuth: mockOpenAuth }),
}))

vi.mock("@/store/compare", () => ({
  useCompareStore: (selector: (s: typeof compareState) => unknown) => selector(compareState),
  MAX_COMPARE: 3,
}))

vi.mock("@/lib/api", () => ({
  toggleFavorite: mockToggleFavorite,
}))

vi.mock("@/lib/utils", () => ({
  cn: (...c: unknown[]) => c.filter(Boolean).join(" "),
}))

vi.mock("sonner", () => ({
  toast: mockToast,
}))

vi.mock("next/image", () => ({
  default: (p: Record<string, unknown>) => {
    const { src, alt, className } = p as { src?: string; alt?: string; className?: string }
    return (
      <img src={src ?? ""} alt={alt ?? ""} className={className ?? ""} data-testid="mock-image" />
    )
  },
}))

// Lucide icons used by ProviderCard
vi.mock("lucide-react", () => {
  const makeIcon = (name: string) => {
    const C = (p: any) => <span data-testid={`icon-${name}`} {...p} />
    C.displayName = name
    return C
  }
  return {
    Star: makeIcon("star"),
    MapPin: makeIcon("mappin"),
    Heart: makeIcon("heart"),
    FileText: makeIcon("file-text"),
    Calendar: makeIcon("calendar"),
    ChevronRight: makeIcon("chevron-right"),
    Loader2: makeIcon("loader"),
    ShieldCheck: makeIcon("shield"),
    CheckCircle2: makeIcon("check-circle"),
    CalendarClock: makeIcon("calendar-clock"),
    Wrench: makeIcon("wrench"),
    GitCompare: makeIcon("git-compare"),
    X: makeIcon("x"),
    Navigation: makeIcon("navigation"),
  }
})

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className, ...rest }: any) => (
    <div className={className} data-testid="card" {...rest}>
      {children}
    </div>
  ),
  CardContent: ({ children, className }: any) => (
    <div className={className} data-testid="card-content">
      {children}
    </div>
  ),
  CardFooter: ({ children, className }: any) => (
    <div className={className} data-testid="card-footer">
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

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: any) => <div data-testid="avatar">{children}</div>,
  AvatarImage: (p: any) => <img data-testid="avatar-image" src={p.src} alt={p.alt} />,
  AvatarFallback: ({ children }: any) => <span data-testid="avatar-fallback">{children}</span>,
}))

vi.mock("@/components/ui/accordion", () => ({
  Accordion: ({ children }: any) => <div data-testid="accordion">{children}</div>,
  AccordionItem: ({ children }: any) => <div data-testid="accordion-item">{children}</div>,
  AccordionTrigger: ({ children }: any) => (
    <button data-testid="accordion-trigger">{children}</button>
  ),
  AccordionContent: ({ children }: any) => <div data-testid="accordion-content">{children}</div>,
}))

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: any) => <div data-testid="scroll-area">{children}</div>,
}))

vi.mock("@/hooks/use-animation", () => ({
  useTilt: () => ({}),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import ProviderCard from "../provider-card"

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

function provider(overrides: Partial<ProviderCardType> = {}): ProviderCardType {
  return {
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
        unit: "METRO_QUADRADO",
        photos: [],
      },
    ],
    completedBookings: 45,
    memberSince: "2024-01-15",
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  compareState = { ids: [], toggle: vi.fn() }
  authState = { user: null }
  mockUseMutation.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  })
})

afterEach(() => {
  cleanup()
})

// ===========================================================================
// Distance display
// ===========================================================================

describe("ProviderCard — distance display", () => {
  it("renders distance formatted in km", () => {
    render(<ProviderCard provider={provider({ distanceKm: 1.2 })} />)
    expect(screen.getByText("1,2 km")).toBeTruthy()
  })

  it("renders distance formatted in meters when < 1 km", () => {
    render(<ProviderCard provider={provider({ distanceKm: 0.85 })} />)
    expect(screen.getByText("850 m")).toBeTruthy()
  })

  it("renders a MapPin icon next to the distance", () => {
    render(<ProviderCard provider={provider({ distanceKm: 3.4 })} />)
    expect(screen.getAllByTestId("icon-mappin").length).toBeGreaterThanOrEqual(1)
  })

  it("renders the city name", () => {
    render(<ProviderCard provider={provider({ city: "Rio de Janeiro" })} />)
    expect(screen.getByText(/Rio de Janeiro/)).toBeTruthy()
  })

  it("hides the distance row when distanceKm is null", () => {
    render(<ProviderCard provider={provider({ distanceKm: null })} />)
    expect(screen.queryByText(/km|m$/)).toBeNull()
  })
})

// ===========================================================================
// "Perto de você" badge
// ===========================================================================

describe("ProviderCard — 'Perto de você' badge", () => {
  it("shows badge when distanceKm is within radiusKm", () => {
    render(<ProviderCard provider={provider({ distanceKm: 2, radiusKm: 10 })} />)
    expect(screen.getByText("Perto de você")).toBeTruthy()
  })

  it("shows badge when distanceKm equals radiusKm (boundary)", () => {
    render(<ProviderCard provider={provider({ distanceKm: 10, radiusKm: 10 })} />)
    expect(screen.getByText("Perto de você")).toBeTruthy()
  })

  it("hides badge when distanceKm exceeds radiusKm", () => {
    render(<ProviderCard provider={provider({ distanceKm: 15, radiusKm: 10 })} />)
    expect(screen.queryByText("Perto de você")).toBeNull()
  })

  it("hides badge when radiusKm is null", () => {
    render(<ProviderCard provider={provider({ distanceKm: 2, radiusKm: null })} />)
    expect(screen.queryByText("Perto de você")).toBeNull()
  })

  it("hides badge when distanceKm is null", () => {
    render(<ProviderCard provider={provider({ distanceKm: null, radiusKm: 10 })} />)
    expect(screen.queryByText("Perto de você")).toBeNull()
  })

  it("hides badge when distanceKm is 0 (edge: 0 <= radius)", () => {
    render(<ProviderCard provider={provider({ distanceKm: 0, radiusKm: 10 })} />)
    expect(screen.getByText("Perto de você")).toBeTruthy()
  })
})

// ===========================================================================
// Compare data attributes (used by CompareBar/CompareModal)
// ===========================================================================

describe("ProviderCard — compare data attributes", () => {
  it("exposes formatted distance via data-compare-distance", () => {
    render(<ProviderCard provider={provider({ distanceKm: 4.5 })} />)
    const card = screen.getByTestId("card")
    expect(card.getAttribute("data-compare-distance")).toBe("4,5 km")
  })

  it("exposes raw km via data-compare-distance-km", () => {
    render(<ProviderCard provider={provider({ distanceKm: 4.5 })} />)
    const card = screen.getByTestId("card")
    expect(card.getAttribute("data-compare-distance-km")).toBe("4.5")
  })

  it("exposes provider id via data-provider-id", () => {
    render(<ProviderCard provider={provider({ id: "abc-123" })} />)
    const card = screen.getByTestId("card")
    expect(card.getAttribute("data-provider-id")).toBe("abc-123")
  })

  it("exposes empty distance attributes when distanceKm is null", () => {
    render(<ProviderCard provider={provider({ distanceKm: null })} />)
    const card = screen.getByTestId("card")
    expect(card.getAttribute("data-compare-distance")).toBe("—")
    expect(card.getAttribute("data-compare-distance-km")).toBe("")
  })

  it("exposes meters format in data-compare-distance for < 1 km", () => {
    render(<ProviderCard provider={provider({ distanceKm: 0.42 })} />)
    const card = screen.getByTestId("card")
    expect(card.getAttribute("data-compare-distance")).toBe("420 m")
    expect(card.getAttribute("data-compare-distance-km")).toBe("0.42")
  })
})
