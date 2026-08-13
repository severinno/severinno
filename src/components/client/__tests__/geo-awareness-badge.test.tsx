/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for GeoAwarenessBadge — "prestadores perto de você" card on dashboard.
 *
 * Coverage:
 *   ✅ Returns null when dismissed (X button)
 *   ✅ Shows "Compartilhe sua localização" GPS prompt when no location
 *   ✅ Shows loading spinner while fetching providers
 *   ✅ Shows "{N} prestadores encontrados" when providers > 0
 *   ✅ Shows "Nenhum prestador encontrado" when providers === 0
 *   ✅ Clicking vitrine link calls navigate("vitrine")
 *   ✅ Clicking GPS trigger fires setFromGPS
 *   ✅ Shows locating state with spinner and disabled button while browser asks permission
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup, act } from "@/__tests__/test-utils"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockUseQuery = vi.hoisted(() => vi.fn())
const mockCn = vi.hoisted(() => vi.fn((...c: any[]) => c.filter(Boolean).join(" ")))
const mockNavigate = vi.hoisted(() => vi.fn())
const mockSetFromGPS = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

// Mutable geo state
let geoState: {
  lat: number | null
  lng: number | null
  status: string
  setFromGPS: () => Promise<void>
} = {
  lat: null,
  lng: null,
  status: "idle",
  setFromGPS: mockSetFromGPS,
}

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => mockUseQuery(options),
}))

vi.mock("@/store/geo", () => ({
  useGeoStore: Object.assign(
    (selector?: (s: typeof geoState) => unknown) => (selector ? selector(geoState) : geoState),
    { getState: () => geoState },
  ),
}))

vi.mock("@/store/view", () => ({
  useViewStore: (selector: (s: { navigate: typeof mockNavigate }) => unknown) =>
    selector({ navigate: mockNavigate }),
}))

vi.mock("@/lib/api", () => ({
  fetchProviders: vi.fn(),
}))

vi.mock("@/lib/utils", () => ({
  cn: (...c: string[]) => mockCn(...c),
}))

vi.mock("lucide-react", () => ({
  Navigation: () => <span data-testid="icon-navigation" />,
  MapPin: () => <span data-testid="icon-mappin" />,
  Loader2: () => <span data-testid="icon-loading" />,
  X: () => <span data-testid="icon-x" />,
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

import GeoAwarenessBadge from "../geo-awareness-badge"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setGeo(overrides: Partial<typeof geoState>) {
  Object.assign(geoState, overrides)
}

function mockQuery(overrides: {
  isLoading?: boolean
  isFetched?: boolean
  data?: { total: number; items: any[] } | null
}) {
  mockUseQuery.mockReturnValue({
    data: overrides.data ?? null,
    isLoading: overrides.isLoading ?? false,
    isFetched: overrides.isFetched ?? false,
    error: null,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  geoState = { lat: null, lng: null, status: "idle", setFromGPS: mockSetFromGPS }
  mockQuery({})
})

afterEach(() => {
  cleanup()
})

// ===========================================================================
// Tests
// ===========================================================================

describe("GeoAwarenessBadge — without GPS", () => {
  it("shows GPS prompt when status is idle", () => {
    render(<GeoAwarenessBadge />)

    expect(screen.getByText("Encontre prestadores perto de você")).toBeTruthy()
    expect(screen.getByText(/Compartilhe sua localização/)).toBeTruthy()
  })

  it("shows GPS prompt when status is denied", () => {
    setGeo({ lat: null, lng: null, status: "denied" })
    render(<GeoAwarenessBadge />)

    expect(screen.getByText(/Compartilhe sua localização/)).toBeTruthy()
  })

  it("renders 'Compartilhar localização' button", () => {
    render(<GeoAwarenessBadge />)

    expect(screen.getByText("Compartilhar localização")).toBeTruthy()
  })

  it("renders 'Ver vitrine' link when no GPS", () => {
    render(<GeoAwarenessBadge />)

    expect(screen.getByText("Ver vitrine")).toBeTruthy()
  })

  it("calls setFromGPS when GPS button is clicked", async () => {
    render(<GeoAwarenessBadge />)

    const gpsButton = screen.getByText("Compartilhar localização")
    await act(async () => {
      gpsButton.click()
    })

    expect(mockSetFromGPS).toHaveBeenCalled()
  })

  it("calls navigate('vitrine') when vitrine link is clicked", () => {
    render(<GeoAwarenessBadge />)

    const vitrineLink = screen.getByText("Ver vitrine")
    act(() => {
      vitrineLink.click()
    })

    expect(mockNavigate).toHaveBeenCalledWith("vitrine")
  })
})

describe("GeoAwarenessBadge — locating state", () => {
  it("shows 'Obtendo sua localização…' when status is locating", () => {
    setGeo({ lat: null, lng: null, status: "locating" })
    render(<GeoAwarenessBadge />)

    expect(screen.getByText("Obtendo sua localização…")).toBeTruthy()
  })

  it("shows 'Aguardando permissão do navegador' text", () => {
    setGeo({ lat: null, lng: null, status: "locating" })
    render(<GeoAwarenessBadge />)

    expect(screen.getByText(/Aguardando permissão do navegador/)).toBeTruthy()
  })

  it("renders spinner icon while locating", () => {
    setGeo({ lat: null, lng: null, status: "locating" })
    render(<GeoAwarenessBadge />)

    // Should show two spinners: one in the text area, one inside the disabled button
    const spinners = screen.getAllByTestId("icon-loading")
    expect(spinners.length).toBeGreaterThanOrEqual(1)
  })

  it("disables the GPS button while locating", () => {
    setGeo({ lat: null, lng: null, status: "locating" })
    render(<GeoAwarenessBadge />)

    const buttons = screen.getAllByTestId("button")
    const gpsButton = buttons.find((b) => b.textContent?.includes("Aguardando"))
    expect(gpsButton).toBeTruthy()
    expect(gpsButton).toBeDisabled()
  })

  it("keeps 'Ver vitrine' link active while locating", () => {
    setGeo({ lat: null, lng: null, status: "locating" })
    render(<GeoAwarenessBadge />)

    const vitrineLink = screen.getByText("Ver vitrine")
    expect(vitrineLink).toBeTruthy()
    act(() => {
      vitrineLink.click()
    })
    expect(mockNavigate).toHaveBeenCalledWith("vitrine")
  })
})

describe("GeoAwarenessBadge — loading state", () => {
  it("shows loading text while fetching", () => {
    setGeo({ lat: -23.5505, lng: -46.6333, status: "ready" })
    mockQuery({ isLoading: true, isFetched: false })

    render(<GeoAwarenessBadge />)

    expect(screen.getByText(/Buscando prestadores na sua região/)).toBeTruthy()
  })

  it("shows spinner icon while loading", () => {
    setGeo({ lat: -23.5505, lng: -46.6333, status: "ready" })
    mockQuery({ isLoading: true, isFetched: false })

    render(<GeoAwarenessBadge />)

    expect(screen.getByTestId("icon-loading")).toBeTruthy()
  })

  it("shows radius text while loading", () => {
    setGeo({ lat: -23.5505, lng: -46.6333, status: "ready" })
    mockQuery({ isLoading: true, isFetched: false })

    render(<GeoAwarenessBadge />)

    expect(screen.getByText(/raio de 50 km/)).toBeTruthy()
  })
})

describe("GeoAwarenessBadge — with providers found", () => {
  it("shows provider count when providers > 0", () => {
    setGeo({ lat: -23.5505, lng: -46.6333, status: "ready" })
    mockQuery({ isLoading: false, isFetched: true, data: { total: 12, items: [] } })

    render(<GeoAwarenessBadge />)

    expect(screen.getByText(/12 prestadores encontrados/)).toBeTruthy()
  })

  it("shows singular '1 prestador encontrado'", () => {
    setGeo({ lat: -23.5505, lng: -46.6333, status: "ready" })
    mockQuery({ isLoading: false, isFetched: true, data: { total: 1, items: [] } })

    render(<GeoAwarenessBadge />)

    expect(screen.getByText(/1 prestador encontrado/)).toBeTruthy()
  })

  it("shows clickable link when providers found", () => {
    setGeo({ lat: -23.5505, lng: -46.6333, status: "ready" })
    mockQuery({ isLoading: false, isFetched: true, data: { total: 5, items: [] } })

    render(<GeoAwarenessBadge />)

    expect(screen.getByText(/Clique para ver na vitrine/)).toBeTruthy()
  })

  it("calls navigate('vitrine') when provider card is clicked", () => {
    setGeo({ lat: -23.5505, lng: -46.6333, status: "ready" })
    mockQuery({ isLoading: false, isFetched: true, data: { total: 5, items: [] } })

    render(<GeoAwarenessBadge />)

    const link = screen.getByLabelText("Ver prestadores na vitrine")
    act(() => {
      link.click()
    })

    expect(mockNavigate).toHaveBeenCalledWith("vitrine")
  })

  it("shows emerald color scheme when providers found", () => {
    setGeo({ lat: -23.5505, lng: -46.6333, status: "ready" })
    mockQuery({ isLoading: false, isFetched: true, data: { total: 5, items: [] } })

    const { container } = render(<GeoAwarenessBadge />)

    // Emerald border indicates providers found
    const el = container.firstChild as HTMLElement
    expect(el.className).toContain("emerald")
  })
})

describe("GeoAwarenessBadge — no providers found", () => {
  it("shows 'Nenhum prestador' when total is 0", () => {
    setGeo({ lat: -23.5505, lng: -46.6333, status: "ready" })
    mockQuery({ isLoading: false, isFetched: true, data: { total: 0, items: [] } })

    render(<GeoAwarenessBadge />)

    expect(screen.getByText(/Nenhum prestador encontrado/)).toBeTruthy()
  })

  it("shows amber color scheme when no providers", () => {
    setGeo({ lat: -23.5505, lng: -46.6333, status: "ready" })
    mockQuery({ isLoading: false, isFetched: true, data: { total: 0, items: [] } })

    const { container } = render(<GeoAwarenessBadge />)

    const el = container.firstChild as HTMLElement
    expect(el.className).toContain("amber")
  })

  it("calls navigate('vitrine') when 'Nenhum prestador' card is clicked", () => {
    setGeo({ lat: -23.5505, lng: -46.6333, status: "ready" })
    mockQuery({ isLoading: false, isFetched: true, data: { total: 0, items: [] } })

    render(<GeoAwarenessBadge />)

    const link = screen.getByLabelText("Ver vitrine")
    act(() => {
      link.click()
    })

    expect(mockNavigate).toHaveBeenCalledWith("vitrine")
  })
})

describe("GeoAwarenessBadge — dismiss", () => {
  it("returns null when dismiss button is clicked", () => {
    setGeo({ lat: -23.5505, lng: -46.6333, status: "ready" })
    mockQuery({ isLoading: false, isFetched: true, data: { total: 5, items: [] } })

    const { container } = render(<GeoAwarenessBadge />)
    expect(container.innerHTML).not.toBe("")

    const dismissButton = screen.getByLabelText("Dispensar")
    act(() => {
      dismissButton.click()
    })

    expect(container.innerHTML).toBe("")
  })
})
