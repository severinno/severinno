/**
 * Accessibility (axe-core) tests for vitrine sections.
 *
 * Tests the main marketing page sections that are visible to visitors.
 * Components that render complex SVG/CSS animations (Hero, HowItWorks)
 * are skipped because axe-core hangs on them in jsdom.
 */

// Load comprehensive lucide-react mock (49 icons) before component imports.
// This replaces the global vitest.setup.tsx's 4-icon mock for axe-core tests.
import "./vitrine-a11y-setup"

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, cleanup } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"
import * as React from "react"

// ============================================================================
// Mutable state for store mocks — set these before render in specific tests
// ============================================================================

let mockCompareIds: string[] = []
let mockRecentlyViewedItems: any[] = []

// ============================================================================
// Shared mocks
// ============================================================================

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn((opts: { queryKey: string[] }) => {
    const key = opts.queryKey?.[0] ?? ""
    if (key === "public-stats" || key === "hero-activity") {
      return {
        data: {
          providers: 150,
          services: 320,
          reviews: 1200,
          completedBookings: 850,
          avgRating: 4.8,
          totalUsers: 5000,
          recentSignups24h: 12,
          activities: [],
          browsingNow: 23,
          quotesToday: 45,
        },
        isLoading: false,
      }
    }
    if (key === "stats") {
      return {
        data: {
          providers: 150,
          services: 320,
          reviews: 1200,
          completedBookings: 850,
          avgRating: 4.8,
        },
        isLoading: false,
      }
    }
    if (key === "vitrine-testimonials") {
      return {
        data: {
          items: [
            {
              id: "rev-1",
              rating: 5,
              comment: "Excelente profissional, super recomendo!",
              createdAt: "2025-12-01T10:00:00Z",
              clientName: "Ana Oliveira",
              clientAvatar: null,
              providerName: "João Silva",
              providerAvatar: null,
              serviceTitle: "Consulta básica",
            },
            {
              id: "rev-2",
              rating: 4,
              comment: "Bom atendimento, preço justo.",
              createdAt: "2025-11-20T14:30:00Z",
              clientName: "Carlos Santos",
              clientAvatar: null,
              providerName: "Maria Lima",
              providerAvatar: null,
              serviceTitle: "Limpeza simples",
            },
          ],
          total: 2,
          avgRating: 4.5,
        },
        isLoading: false,
      }
    }
    return { data: undefined, isLoading: false }
  }),
  useMutation: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({ favorited: false }),
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}))

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children }: any) => <>{children}</>,
    span: ({ children, ..._p }: any) => <span>{children}</span>,
    p: ({ children, ..._p }: any) => <p>{children}</p>,
    button: ({ children, ..._p }: any) => <button type="button">{children}</button>,
    path: ({ ..._p }: any) => <path />,
    line: ({ ..._p }: any) => <line />,
    header: ({ children, ..._p }: any) => <header>{children}</header>,
    h2: ({ children, ..._p }: any) => <h2>{children}</h2>,
    li: ({ children, ..._p }: any) => <li>{children}</li>,
    ul: ({ children, ..._p }: any) => <ul>{children}</ul>,
    a: ({ children, ..._p }: any) => <a {..._p}>{children}</a>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useScroll: () => ({ scrollYProgress: { get: () => 0, onChange: vi.fn() } }),
  useTransform: () => ({ get: () => 0 }),
}))

vi.mock("@/store/ui", () => ({
  useUIStore: vi.fn((selector) => {
    const state = { openAuth: vi.fn(), openQuote: vi.fn(), openProvider: vi.fn() }
    return selector ? selector(state) : state
  }),
}))

vi.mock("@/store/view", () => ({
  useViewStore: vi.fn((selector) => {
    const state = { navigate: vi.fn() }
    return selector ? selector(state) : state
  }),
}))

vi.mock("@/store/geo", () => ({
  useGeoStore: vi.fn((selector) => {
    const state = { city: null, status: "idle", setFromGPS: vi.fn(), setFromCEP: vi.fn() }
    return selector ? selector(state) : state
  }),
}))

vi.mock("@/store/auth", () => ({
  useAuthStore: vi.fn((selector) => {
    const state = { user: null, status: "unauthenticated", logout: vi.fn() }
    return selector ? selector(state) : state
  }),
}))

vi.mock("@/store/compare", () => ({
  useCompareStore: vi.fn((selector: any) => {
    const state = {
      ids: mockCompareIds,
      toggle: vi.fn(),
      clear: vi.fn(),
      remove: vi.fn(),
      openCompare: vi.fn(),
    }
    return selector ? selector(state) : state
  }),
  MAX_COMPARE: 4,
}))

vi.mock("@/store/recently-viewed", () => ({
  useRecentlyViewedStore: vi.fn((selector: any) => {
    const state = { items: mockRecentlyViewedItems, clear: vi.fn() }
    return selector ? selector(state) : state
  }),
}))

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}))

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn().mockResolvedValue({}),
  toggleFavorite: vi.fn().mockResolvedValue({ favorited: true }),
}))

vi.mock("@/hooks/use-animation", () => ({
  useCountUp: () => ({ ref: { current: null }, value: 0 }),
  useScrollReveal: () => ({ ref: { current: null }, visible: true }),
  useTilt: () => ({ ref: { current: null } }),
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, asChild, ...p }: any) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, { ...p })
    }
    return <button {...p}>{children}</button>
  },
}))

vi.mock("@/components/ui/input", () => ({
  Input: (p: any) => <input {...p} />,
}))

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: any) => <div data-testid="skeleton" className={className} />,
}))

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...p }: any) => <span {...p}>{children}</span>,
}))

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className, ...p }: any) => (
    <div data-testid="card" className={className} {...p}>
      {children}
    </div>
  ),
  CardContent: ({ children, className }: any) => <div className={className}>{children}</div>,
  CardFooter: ({ children, className }: any) => <div className={className}>{children}</div>,
  CardHeader: ({ children, className }: any) => <div className={className}>{children}</div>,
  CardTitle: ({ children, className }: any) => <h3 className={className}>{children}</h3>,
}))

vi.mock("@/components/ui/accordion", () => ({
  Accordion: ({ children }: any) => <div>{children}</div>,
  AccordionContent: ({ children }: any) => <div>{children}</div>,
  AccordionItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
  AccordionTrigger: ({ children }: any) => <button type="button">{children}</button>,
}))

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
  TooltipProvider: ({ children }: any) => <>{children}</>,
}))

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children }: any) => <div>{children}</div>,
  AvatarImage: (p: any) => <img {...p} />,
  AvatarFallback: ({ children }: any) => <span>{children}</span>,
}))

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: any) => <div>{children}</div>,
}))

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}))

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...p }: any) => <label {...p}>{children}</label>,
}))

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, ...p }: any) => (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange?.(!checked)}
      {...p}
    />
  ),
}))

vi.mock("@/components/ui/slider", () => ({
  Slider: ({ value, onValueChange, ...p }: any) => (
    <div role="slider" aria-valuenow={value?.[0]} {...p} />
  ),
}))

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <>{children}</>,
  SelectTrigger: ({ children, ...p }: any) => <button {...p}>{children}</button>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children, value, ...p }: any) => (
    <option value={value} {...p}>
      {children}
    </option>
  ),
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
}))

vi.mock("@/components/ui/radio-group", () => ({
  RadioGroup: ({ children, value, ...p }: any) => (
    <div role="radiogroup" {...p}>
      {children}
    </div>
  ),
  RadioGroupItem: (p: any) => <input type="radio" {...p} />,
}))

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <>{children}</>,
  DropdownMenuItem: ({ children, onSelect, ...p }: any) => (
    <button type="button" onClick={onSelect} {...p}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: any) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}))

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: any) => <>{children}</>,
  SheetTrigger: ({ children }: any) => <>{children}</>,
  SheetContent: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  SheetHeader: ({ children }: any) => <>{children}</>,
  SheetTitle: ({ children }: any) => <h2>{children}</h2>,
}))

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <>{children}</>,
  PopoverAnchor: ({ children }: any) => <>{children}</>,
  PopoverContent: ({ children }: any) => <>{children}</>,
}))

vi.mock("@/components/ui/command", () => ({
  Command: ({ children, ...p }: any) => <div {...p}>{children}</div>,
  CommandInput: ({ value, onValueChange, ...p }: any) => (
    <input value={value} onChange={(e) => onValueChange?.(e.target.value)} {...p} />
  ),
  CommandList: ({ children }: any) => <>{children}</>,
  CommandEmpty: ({ children }: any) => <>{children}</>,
  CommandGroup: ({ children, heading }: any) => (
    <fieldset>
      <legend>{heading}</legend>
      {children}
    </fieldset>
  ),
  CommandItem: ({ children, onSelect, ...p }: any) => (
    <button type="button" onClick={onSelect} {...p}>
      {children}
    </button>
  ),
}))

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: any) => <>{children}</>,
  AlertDialogTrigger: ({ children }: any) => <>{children}</>,
  AlertDialogContent: ({ children }: any) => <>{children}</>,
  AlertDialogHeader: ({ children }: any) => <>{children}</>,
  AlertDialogFooter: ({ children }: any) => <>{children}</>,
  AlertDialogTitle: ({ children }: any) => <h3>{children}</h3>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogAction: ({ children, onClick, ...p }: any) => (
    <button type="button" onClick={onClick} {...p}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: any) => <button type="button">{children}</button>,
}))

vi.mock("next/image", () => ({
  __esModule: true,
  default: (p: any) => {
    // Filter Next.js-only boolean props that aren't valid HTML img attributes
    const { fill, priority, ...safe } = p
    return <img {...safe} />
  },
}))

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock("@/lib/utils", () => ({
  cn: (...c: any[]) => c.filter(Boolean).join(" "),
}))

vi.mock("@/lib/format", () => ({
  formatBRL: (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`,
  formatRelative: (d: Date) => "há 2 dias",
}))

vi.mock("@/lib/geo-client", () => ({
  formatDistance: (km: number) => `${km.toFixed(1)} km`,
}))

vi.mock("@/lib/constants", () => ({
  SERVICE_UNIT_SHORT: { unit: "un", hour: "h", session: "sessão" },
  ROLE_LABELS: { CLIENT: "Cliente", PROVIDER: "Prestador", ADMIN: "Admin" },
}))

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: any) => <>{children}</>,
  CollapsibleTrigger: ({ children }: any) => <>{children}</>,
  CollapsibleContent: ({ children }: any) => <>{children}</>,
}))

vi.mock("embla-carousel-autoplay", () => ({
  __esModule: true,
  default: () => ({ stop: vi.fn(), play: vi.fn() }),
}))

vi.mock("@/components/ui/carousel", () => ({
  Carousel: ({ children }: any) => <>{children}</>,
  CarouselContent: ({ children }: any) => <>{children}</>,
  CarouselItem: ({ children }: any) => <>{children}</>,
}))

// Global fetch for CtaBanner's usePublicStats custom hook
vi.stubGlobal(
  "fetch",
  vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        providers: 150,
        services: 320,
        reviews: 1200,
        completedBookings: 850,
        avgRating: 4.8,
        totalUsers: 5000,
        recentSignups24h: 12,
      }),
  }),
)

// ============================================================================
// Sample provider data for ProviderCard tests
// ============================================================================

const sampleProvider = {
  id: "prov-1",
  name: "João Silva",
  city: "São Paulo",
  bio: "Profissional experiente com mais de 10 anos de atuação.",
  rating: 4.8,
  reviewCount: 42,
  verified: true,
  distanceKm: 5.2,
  completedBookings: 150,
  avatarUrl: "",
  coverUrl: "",
  memberSince: "2023-01-15T00:00:00Z",
  basePrice: 150,
  services: [
    {
      id: "svc-1",
      title: "Consulta básica",
      basePrice: 150,
      unit: "unit",
      category: { id: "cat-1", name: "Consultas" },
    },
    {
      id: "svc-2",
      title: "Acompanhamento mensal",
      basePrice: 300,
      unit: "session",
      category: { id: "cat-1", name: "Consultas" },
    },
    {
      id: "svc-3",
      title: "Limpeza simples",
      basePrice: 80,
      unit: "unit",
      category: { id: "cat-2", name: "Limpeza" },
    },
  ],
}

// ============================================================================
// Hero — SKIPPED (axe hangs in jsdom)
// ============================================================================

describe("Hero — accessibility", () => {
  it.skip("has no axe violations", async () => {
    const Hero = (await import("../hero")).default
    const { container } = render(<Hero query="" onQueryChange={vi.fn()} />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  }, 15_000)
})

// ============================================================================
// FAQ
// ============================================================================

describe("FAQ — accessibility", () => {
  it("has no axe violations", async () => {
    const FAQ = (await import("../faq")).default
    const { container } = render(<FAQ />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  }, 15_000)
})

// ============================================================================
// ProviderCard
// ============================================================================

describe("ProviderCard — accessibility", () => {
  it("has no axe violations (not favorited, default compare)", async () => {
    const ProviderCard = (await import("../provider-card")).default
    const { container } = render(<ProviderCard provider={sampleProvider as any} />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  }, 15_000)
})

// ============================================================================
// HowItWorks — SKIPPED (axe hangs in jsdom)
// ============================================================================

describe("HowItWorks — accessibility", () => {
  it.skip("has no axe violations (desktop + mobile render)", async () => {
    const HowItWorks = (await import("../how-it-works")).default
    const { container } = render(<HowItWorks />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  }, 15_000)
})

// ============================================================================
// WhySeverinno
// ============================================================================

describe("WhySeverinno — accessibility", () => {
  it("has no axe violations (stats + feature grid + guarantee strip)", async () => {
    const WhySeverinno = (await import("../why-severinno")).default
    const { container } = render(<WhySeverinno />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  }, 15_000)
})

// ============================================================================
// Testimonials
// ============================================================================

describe("Testimonials — accessibility", () => {
  it("has no axe violations (with review data + carousel)", async () => {
    const Testimonials = (await import("../testimonials")).default
    const { container } = render(<Testimonials />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  }, 15_000)
})

// ============================================================================
// CompareBar — uses mutable mockCompareIds
// ============================================================================

describe("CompareBar — accessibility", () => {
  afterEach(() => {
    mockCompareIds = []
  })

  it("has no axe violations (with 2 providers selected)", async () => {
    mockCompareIds = ["prov-1", "prov-2"]

    const CompareBar = (await import("../compare-bar")).default
    const { container } = render(<CompareBar />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  }, 15_000)
})

// ============================================================================
// RecentlyViewed — uses mutable mockRecentlyViewedItems
// ============================================================================

describe("RecentlyViewed — accessibility", () => {
  afterEach(() => {
    mockRecentlyViewedItems = []
  })

  it("has no axe violations (with 3 viewed providers)", async () => {
    mockRecentlyViewedItems = [
      {
        id: "prov-1",
        name: "João Silva",
        rating: 4.8,
        reviewCount: 42,
        city: "São Paulo",
        distanceKm: 3.5,
        avatarUrl: null,
        basePrice: 150,
        services: [{ title: "Consulta básica", basePrice: 150 }],
      },
      {
        id: "prov-2",
        name: "Maria Oliveira",
        rating: 4.5,
        reviewCount: 28,
        city: "São Paulo",
        distanceKm: 7.2,
        avatarUrl: null,
        basePrice: 200,
        services: [{ title: "Limpeza completa", basePrice: 200 }],
      },
      {
        id: "prov-3",
        name: "Carlos Santos",
        rating: 4.2,
        reviewCount: 15,
        city: "São Bernardo",
        distanceKm: 12.0,
        avatarUrl: null,
        basePrice: 80,
        services: [{ title: "Pintura de parede", basePrice: 80 }],
      },
    ]

    const RecentlyViewed = (await import("../recently-viewed")).RecentlyViewed
    const { container } = render(<RecentlyViewed />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  }, 15_000)
})

// ============================================================================
// CtaBanner
// ============================================================================

describe("CtaBanner — accessibility", () => {
  it("has no axe violations for visitor (default tab)", async () => {
    const CtaBanner = (await import("../cta-banner")).default
    const { container } = render(<CtaBanner />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  }, 15_000)
})
