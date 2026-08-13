/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for ProviderGeoAwarenessBadge — "solicitações ativas na região"
 * card on the provider dashboard.
 *
 * Coverage:
 *   ✅ Loading: spinner and "Analisando demanda na região…"
 *   ✅ Needs setup: "Configure sua região de atendimento" + button
 *   ✅ Has demand: count, breakdown, radius, link to agenda
 *   ✅ No demand: "Nenhuma solicitação ativa", link to settings
 *   ✅ Dismiss: click X button → returns null
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@/__tests__/test-utils"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockUseQuery = vi.hoisted(() => vi.fn())
const mockCn = vi.hoisted(() => vi.fn((...c: any[]) => c.filter(Boolean).join(" ")))
const mockNavigate = vi.hoisted(() => vi.fn())

// Mutable query state
let queryState: {
  data: Record<string, unknown> | null
  isLoading: boolean
  isFetched: boolean
} = {
  data: null,
  isLoading: false,
  isFetched: false,
}

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => mockUseQuery(options),
}))

vi.mock("@/store/view", () => ({
  useViewStore: (selector: (s: { navigate: typeof mockNavigate }) => unknown) =>
    selector({ navigate: mockNavigate }),
}))

vi.mock("@/lib/api", () => ({
  fetchRegionDemand: vi.fn(),
}))

vi.mock("@/lib/utils", () => ({
  cn: (...c: string[]) => mockCn(...c),
}))

vi.mock("lucide-react", () => ({
  Navigation: () => <span data-testid="icon-navigation" />,
  MapPin: () => <span data-testid="icon-mappin" />,
  Loader2: () => <span data-testid="icon-loading" />,
  X: () => <span data-testid="icon-x" />,
  Users: () => <span data-testid="icon-users" />,
  Settings: () => <span data-testid="icon-settings" />,
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, className, variant, size, disabled }: any) => (
    <button
      onClick={onClick}
      className={className}
      data-variant={variant}
      data-size={size}
      disabled={disabled}
      data-testid="button"
    >
      {children}
    </button>
  ),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import ProviderGeoAwarenessBadge from "../provider-geo-awareness-badge"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockQuery(overrides: {
  isLoading?: boolean
  isFetched?: boolean
  data?: Record<string, unknown> | null
}) {
  Object.assign(queryState, overrides)
  mockUseQuery.mockReturnValue({
    data: queryState.data ?? null,
    isLoading: queryState.isLoading ?? false,
    isFetched: queryState.isFetched ?? false,
    error: null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  queryState = { data: null, isLoading: false, isFetched: false }
  mockQuery({})
})

afterEach(() => {
  cleanup()
})

// ===========================================================================
// Tests
// ===========================================================================

describe("ProviderGeoAwarenessBadge — loading", () => {
  it("shows 'Analisando demanda na região…' when loading", () => {
    mockQuery({ isLoading: true, isFetched: false })

    render(<ProviderGeoAwarenessBadge />)

    expect(screen.getByText("Analisando demanda na região…")).toBeTruthy()
  })

  it("shows spinner icon while loading", () => {
    mockQuery({ isLoading: true, isFetched: false })

    render(<ProviderGeoAwarenessBadge />)

    expect(screen.getByTestId("icon-loading")).toBeTruthy()
  })

  it("shows 'Calculando solicitações ativas' while loading", () => {
    mockQuery({ isLoading: true, isFetched: false })

    render(<ProviderGeoAwarenessBadge />)

    expect(screen.getByText(/Calculando solicitações ativas/)).toBeTruthy()
  })
})

describe("ProviderGeoAwarenessBadge — needs setup", () => {
  beforeEach(() => {
    mockQuery({
      isLoading: false,
      isFetched: true,
      data: {
        total: 0,
        bookings: 0,
        quotes: 0,
        regionConfigured: false,
        providerLat: null,
        providerLng: null,
        radiusKm: null,
      },
    })
  })

  it("shows 'Configure sua região de atendimento' message", () => {
    render(<ProviderGeoAwarenessBadge />)

    expect(screen.getByText("Configure sua região de atendimento")).toBeTruthy()
  })

  it("shows Settings icon (gear) when needs setup", () => {
    render(<ProviderGeoAwarenessBadge />)

    expect(screen.getByTestId("icon-settings")).toBeTruthy()
  })

  it("renders 'Configurar região' button", () => {
    render(<ProviderGeoAwarenessBadge />)

    expect(screen.getByText("Configurar região")).toBeTruthy()
  })

  it("calls navigate('provider.settings') when button is clicked", () => {
    render(<ProviderGeoAwarenessBadge />)

    const configButton = screen.getByText("Configurar região")
    act(() => {
      configButton.click()
    })

    expect(mockNavigate).toHaveBeenCalledWith("provider.settings")
  })
})

describe("ProviderGeoAwarenessBadge — has demand", () => {
  beforeEach(() => {
    mockQuery({
      isLoading: false,
      isFetched: true,
      data: {
        total: 12,
        bookings: 8,
        quotes: 4,
        regionConfigured: true,
        providerLat: -23.5505,
        providerLng: -46.6333,
        radiusKm: 50,
      },
    })
  })

  it("shows total solicitation count", () => {
    const { container } = render(<ProviderGeoAwarenessBadge />)

    expect(container.textContent).toContain("12 solicitações ativas")
  })

  it("shows singular '1 solicitação ativa'", () => {
    mockQuery({
      isLoading: false,
      isFetched: true,
      data: {
        total: 1,
        bookings: 1,
        quotes: 0,
        regionConfigured: true,
        providerLat: -23.5505,
        providerLng: -46.6333,
        radiusKm: 30,
      },
    })

    render(<ProviderGeoAwarenessBadge />)

    expect(screen.getByText(/1 solicitação ativa/)).toBeTruthy()
  })

  it("shows booking and quote breakdown", () => {
    render(<ProviderGeoAwarenessBadge />)

    expect(screen.getByText(/8 agendamentos/)).toBeTruthy()
    expect(screen.getByText(/4 orçamentos pendentes/)).toBeTruthy()
  })

  it("shows radius info", () => {
    render(<ProviderGeoAwarenessBadge />)

    expect(screen.getByText(/Raio de 50 km/)).toBeTruthy()
  })

  it("shows 'Clique para ver na agenda' hint", () => {
    render(<ProviderGeoAwarenessBadge />)

    expect(screen.getByText(/Clique para ver na agenda/)).toBeTruthy()
  })

  it("calls navigate('provider.agenda') when clicked", () => {
    render(<ProviderGeoAwarenessBadge />)

    const link = screen.getByLabelText("Ver solicitações")
    act(() => {
      link.click()
    })

    expect(mockNavigate).toHaveBeenCalledWith("provider.agenda")
  })

  it("shows emerald color scheme when demand exists", () => {
    const { container } = render(<ProviderGeoAwarenessBadge />)

    const el = container.firstChild as HTMLElement
    expect(el.className).toContain("emerald")
  })
})

describe("ProviderGeoAwarenessBadge — no demand", () => {
  beforeEach(() => {
    mockQuery({
      isLoading: false,
      isFetched: true,
      data: {
        total: 0,
        bookings: 0,
        quotes: 0,
        regionConfigured: true,
        providerLat: -23.5505,
        providerLng: -46.6333,
        radiusKm: 50,
      },
    })
  })

  it("shows 'Nenhuma solicitação ativa' message", () => {
    render(<ProviderGeoAwarenessBadge />)

    expect(screen.getByText(/Nenhuma solicitação ativa no momento/)).toBeTruthy()
  })

  it("shows radius info when no demand", () => {
    render(<ProviderGeoAwarenessBadge />)

    expect(screen.getByText(/Raio de 50 km/)).toBeTruthy()
  })

  it("shows amber color scheme when no demand", () => {
    const { container } = render(<ProviderGeoAwarenessBadge />)

    const el = container.firstChild as HTMLElement
    expect(el.className).toContain("amber")
  })

  it("calls navigate('provider.settings') when 'Ajustar região' card is clicked", () => {
    render(<ProviderGeoAwarenessBadge />)

    const link = screen.getByLabelText("Ajustar região")
    act(() => {
      link.click()
    })

    expect(mockNavigate).toHaveBeenCalledWith("provider.settings")
  })
})

describe("ProviderGeoAwarenessBadge — dismiss", () => {
  it("returns null when dismiss button is clicked", () => {
    mockQuery({
      isLoading: false,
      isFetched: true,
      data: {
        total: 5,
        bookings: 3,
        quotes: 2,
        regionConfigured: true,
        providerLat: -23.5505,
        providerLng: -46.6333,
        radiusKm: 50,
      },
    })

    const { container } = render(<ProviderGeoAwarenessBadge />)
    expect(container.innerHTML).not.toBe("")

    const dismissButton = screen.getByLabelText("Dispensar")
    act(() => {
      dismissButton.click()
    })

    expect(container.innerHTML).toBe("")
  })
})
