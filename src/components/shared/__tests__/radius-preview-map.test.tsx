/**
 * radius-preview-map.test.tsx
 *
 * Tests RadiusPreviewMap — the provider's service-radius visual editor.
 *
 * Coverage:
 *   ✅ Empty state: "Localização não definida" when no lat/lng
 *   ✅ GPS button rendered by default, hidden with showLocationControls=false
 *   ✅ GPS button disabled while locating (spinner)
 *   ✅ Slider disabled without a location
 *   ✅ Radius label + info text reflect the current radius
 *   ✅ onRadiusChange fires when the slider changes
 *   ✅ Map renders when lat/lng are provided
 *   ✅ accuracyM (precisão do GPS) flui para o mapa (círculo pontilhado)
 *   ✅ Slider has an accessible label
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup, waitFor } from "@/__tests__/test-utils"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockCn = vi.hoisted(() => vi.fn((...c: unknown[]) => c.filter(Boolean).join(" ")))
const mockSlider = vi.hoisted(() => vi.fn())
const mockMapInner = vi.hoisted(() => vi.fn())

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

vi.mock("@/lib/utils", () => ({
  cn: (...c: unknown[]) => mockCn(...c),
}))

vi.mock("next/dynamic", () => ({
  default: () => (p: Record<string, unknown>) => mockMapInner(p),
}))

vi.mock("lucide-react", () => {
  const makeIcon = (name: string) => {
    const C = () => <span data-testid={`icon-${name}`} />
    C.displayName = name
    return C
  }
  return {
    Navigation: makeIcon("navigation"),
    MapPin: makeIcon("mappin"),
    Loader2: makeIcon("loading"),
  }
})

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, className }: any) => (
    <label className={className} data-testid="label">
      {children}
    </label>
  ),
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

vi.mock("@/components/ui/slider", () => ({
  Slider: (p: any) => mockSlider(p),
}))

// O setup global (vitrine) mocka @/lib/api sem apiGet — aqui o refino de
// densidade passa por apiGet, então este arquivo define o mock próprio.
vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import RadiusPreviewMap from "../radius-preview-map"
import { apiGet } from "@/lib/api"
import { clearDensityCache } from "@/lib/geo-density"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockSlider.mockImplementation(({ value, onValueChange, disabled, ...rest }: any) => (
    <input
      type="range"
      value={value?.[0]}
      disabled={disabled}
      data-testid="slider"
      onChange={(e) => onValueChange?.([Number(e.target.value)])}
      {...rest}
    />
  ))
})

afterEach(() => {
  cleanup()
})

// ===========================================================================
// Empty state (no location)
// ===========================================================================

describe("RadiusPreviewMap — empty state", () => {
  it("shows 'Localização não definida' when lat/lng are absent", () => {
    render(<RadiusPreviewMap />)
    expect(screen.getByText("Localização não definida")).toBeTruthy()
  })

  it("shows the GPS button by default", () => {
    render(<RadiusPreviewMap />)
    expect(screen.getByText("Usar minha localização")).toBeTruthy()
  })

  it("hides the GPS button when showLocationControls=false", () => {
    render(<RadiusPreviewMap showLocationControls={false} />)
    expect(screen.queryByText("Usar minha localização")).toBeNull()
  })

  it("does not render the map without a location", () => {
    render(<RadiusPreviewMap />)
    expect(mockMapInner).not.toHaveBeenCalled()
  })

  it("disables the radius slider without a location", () => {
    render(<RadiusPreviewMap />)
    expect((screen.getByTestId("slider") as HTMLInputElement).disabled).toBe(true)
  })
})

// ===========================================================================
// Radius display and slider
// ===========================================================================

describe("RadiusPreviewMap — radius slider", () => {
  it("shows the default radius (10 km) in the header", () => {
    render(<RadiusPreviewMap lat={-23.5505} lng={-46.6333} />)
    // "10 km" appears in the header AND the info text
    expect(screen.getAllByText("10 km").length).toBeGreaterThanOrEqual(1)
  })

  it("honors initialRadius prop", () => {
    render(<RadiusPreviewMap lat={-23.5505} lng={-46.6333} initialRadius={25} />)
    expect(screen.getAllByText("25 km").length).toBeGreaterThanOrEqual(1)
  })

  it("updates the radius label when the slider changes", () => {
    render(<RadiusPreviewMap lat={-23.5505} lng={-46.6333} initialRadius={10} />)

    const slider = screen.getByTestId("slider") as HTMLInputElement
    fireEvent.change(slider, { target: { value: "42" } })

    expect(screen.getAllByText("42 km").length).toBeGreaterThanOrEqual(1)
  })

  it("calls onRadiusChange when the slider changes", () => {
    const onRadiusChange = vi.fn()
    render(
      <RadiusPreviewMap
        lat={-23.5505}
        lng={-46.6333}
        initialRadius={10}
        onRadiusChange={onRadiusChange}
      />,
    )

    const slider = screen.getByTestId("slider") as HTMLInputElement
    fireEvent.change(slider, { target: { value: "60" } })

    expect(onRadiusChange).toHaveBeenCalledWith(60)
  })

  it("exposes an accessible label on the slider", () => {
    render(<RadiusPreviewMap lat={-23.5505} lng={-46.6333} />)
    expect(screen.getByLabelText("Raio de atendimento em quilômetros")).toBeTruthy()
  })

  it("shows radius ticks (1 / 50 / 100 km)", () => {
    render(<RadiusPreviewMap lat={-23.5505} lng={-46.6333} />)
    expect(screen.getByText("1 km")).toBeTruthy()
    expect(screen.getByText("50 km")).toBeTruthy()
    expect(screen.getByText("100 km")).toBeTruthy()
  })

  it("reflects the radius in the info text", () => {
    render(<RadiusPreviewMap lat={-23.5505} lng={-46.6333} initialRadius={15} />)
    expect(screen.getByText(/raio de até/)).toBeTruthy()
    expect(screen.getAllByText(/15 km/).length).toBeGreaterThanOrEqual(1)
  })
})

// ===========================================================================
// Map rendering with location
// ===========================================================================

describe("RadiusPreviewMap — map rendering", () => {
  it("renders the map when lat/lng are provided", () => {
    render(<RadiusPreviewMap lat={-23.5505} lng={-46.6333} initialRadius={10} />)
    expect(mockMapInner).toHaveBeenCalledTimes(1)
    const props = mockMapInner.mock.calls[0][0] as { lat: number; lng: number; radius: number }
    expect(props.lat).toBe(-23.5505)
    expect(props.lng).toBe(-46.6333)
    expect(props.radius).toBe(10)
  })

  it("passes the updated radius to the map", () => {
    render(<RadiusPreviewMap lat={-23.5505} lng={-46.6333} initialRadius={10} />)

    const slider = screen.getByTestId("slider") as HTMLInputElement
    fireEvent.change(slider, { target: { value: "30" } })

    const lastCall = mockMapInner.mock.calls.at(-1)?.[0] as { radius: number }
    expect(lastCall.radius).toBe(30)
  })

  it("re-renders the map when the location props change", () => {
    const { rerender } = render(<RadiusPreviewMap lat={-23.5505} lng={-46.6333} />)
    expect(mockMapInner).toHaveBeenCalledTimes(1)

    rerender(<RadiusPreviewMap lat={-22.9068} lng={-43.1729} />)
    const lastCall = mockMapInner.mock.calls.at(-1)?.[0] as { lat: number; lng: number }
    expect(lastCall.lat).toBe(-22.9068)
    expect(lastCall.lng).toBe(-43.1729)
  })

  it("passes the external accuracyM prop to the map", () => {
    render(<RadiusPreviewMap lat={-18.8517} lng={-41.9469} accuracyM={12} />)
    const props = mockMapInner.mock.calls[0][0] as { accuracyM: number | null }
    expect(props.accuracyM).toBe(12)
  })

  it("passes accuracyM=null to the map when no fix is known", () => {
    render(<RadiusPreviewMap lat={-18.8517} lng={-41.9469} />)
    const props = mockMapInner.mock.calls[0][0] as { accuracyM: number | null }
    expect(props.accuracyM).toBeNull()
  })

  it("GPS interno sobrepõe a accuracy externa (ação mais recente)", async () => {
    const getCurrentPosition = vi.fn((success: (p: unknown) => void) =>
      success({ coords: { latitude: -18.8517, longitude: -41.9469, accuracy: 500 } }),
    )
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition },
      configurable: true,
    })

    // Sem localização: o GPS interno captura a accuracy (500 m). O botão só
    // existe no empty state — depois o pai seta lat/lng e o mapa surge.
    const { rerender } = render(
      <RadiusPreviewMap accuracyM={12} onLocationChange={vi.fn()} onRadiusChange={vi.fn()} />,
    )
    fireEvent.click(screen.getByText("Usar minha localização"))
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalled())

    // Localização chega: mapa renderiza com a accuracy interna (500),
    // não a externa (12).
    rerender(<RadiusPreviewMap lat={-18.8517} lng={-41.9469} accuracyM={12} />)
    const lastCall = mockMapInner.mock.calls.at(-1)?.[0] as { accuracyM: number | null }
    expect(lastCall.accuracyM).toBe(500)
  })
})

// ===========================================================================
// Sugestão de raio pela precisão do GPS (accuracy)
// ===========================================================================

describe("RadiusPreviewMap — raio sugerido pela precisão do GPS", () => {
  it("segue a sugestão do pai quando initialRadius muda", () => {
    const { rerender } = render(
      <RadiusPreviewMap lat={-23.5505} lng={-46.6333} initialRadius={15} />,
    )
    expect(screen.getAllByText("15 km").length).toBeGreaterThanOrEqual(1)

    // GPS do onboarding sugeriu 5 km (accuracy ≤ 30 m) — slider/círculo seguem.
    rerender(<RadiusPreviewMap lat={-23.5505} lng={-46.6333} initialRadius={5} />)
    expect(screen.getAllByText("5 km").length).toBeGreaterThanOrEqual(1)
  })

  it("GPS interno sugere o raio pela accuracy e informa o usuário", async () => {
    const onRadiusChange = vi.fn()
    const onLocationChange = vi.fn()
    const getCurrentPosition = vi.fn((success: (p: unknown) => void) =>
      success({ coords: { latitude: -18.8517, longitude: -41.9469, accuracy: 12 } }),
    )
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition },
      configurable: true,
    })

    render(<RadiusPreviewMap onRadiusChange={onRadiusChange} onLocationChange={onLocationChange} />)
    fireEvent.click(screen.getByText("Usar minha localização"))

    // accuracy 12 m (GPS excelente) → 5 km
    await waitFor(() => expect(onRadiusChange).toHaveBeenCalledWith(5))
    expect(onLocationChange).toHaveBeenCalledWith(-18.8517, -41.9469)
    expect(screen.getAllByText("5 km").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Precisão do GPS: ±12 m/)).toBeTruthy()
    expect(screen.getByText(/raio sugerido: 5 km/)).toBeTruthy()
  })

  it("GPS com fix grosseira (8 km de accuracy) sugere 50 km", async () => {
    const onRadiusChange = vi.fn()
    const getCurrentPosition = vi.fn((success: (p: unknown) => void) =>
      success({ coords: { latitude: -18.8517, longitude: -41.9469, accuracy: 8000 } }),
    )
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition },
      configurable: true,
    })

    render(<RadiusPreviewMap onRadiusChange={onRadiusChange} />)
    fireEvent.click(screen.getByText("Usar minha localização"))

    await waitFor(() => expect(onRadiusChange).toHaveBeenCalledWith(50))
  })

  it("GPS sem accuracy usa o default de 15 km", async () => {
    const onRadiusChange = vi.fn()
    const getCurrentPosition = vi.fn((success: (p: unknown) => void) =>
      success({ coords: { latitude: -18.8517, longitude: -41.9469 } }),
    )
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition },
      configurable: true,
    })

    render(<RadiusPreviewMap onRadiusChange={onRadiusChange} />)
    fireEvent.click(screen.getByText("Usar minha localização"))

    await waitFor(() => expect(onRadiusChange).toHaveBeenCalledWith(15))
  })
})

// ===========================================================================
// Refino da sugestão pela densidade do marketplace (métricas de busca)
// ===========================================================================

describe("RadiusPreviewMap — refino da sugestão pela densidade de prestadores", () => {
  const DENSE = {
    rings: [
      { radiusKm: 1, count: 40 },
      { radiusKm: 2, count: 80 },
      { radiusKm: 5, count: 120 },
    ],
    districts: [
      { district: "Centro", city: "Governador Valadares", count: 42, minDistanceKm: 0.8 },
    ],
  }

  function mockFix(accuracy: number) {
    const getCurrentPosition = vi.fn((success: (p: unknown) => void) =>
      success({ coords: { latitude: -18.8517, longitude: -41.9469, accuracy } }),
    )
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition },
      configurable: true,
    })
  }

  beforeEach(() => {
    clearDensityCache()
  })

  afterEach(() => {
    clearDensityCache()
  })

  it("área densa: refina 5 km → 1 km e informa prestadores por perto", async () => {
    const onRadiusChange = vi.fn()
    mockFix(12)
    vi.mocked(apiGet).mockResolvedValue(DENSE)

    render(<RadiusPreviewMap onRadiusChange={onRadiusChange} />)
    fireEvent.click(screen.getByText("Usar minha localização"))

    // Base por accuracy primeiro (12 m → 5 km)…
    await waitFor(() => expect(onRadiusChange).toHaveBeenCalledWith(5))
    // …depois refino pela densidade (anel de 1 km já tem 40 ≥ 12 prestadores).
    await waitFor(() => expect(onRadiusChange).toHaveBeenCalledWith(1))
    expect(screen.getAllByText("1 km").length).toBeGreaterThanOrEqual(1)

    const hint = screen.getByText(/raio sugerido: 1 km/)
    expect(hint.textContent).toContain("40 prestadores por perto")
    expect(hint.textContent).toContain("bairro mais denso: Centro")
  })

  it("área esparsa: raio cresce até o anel com oferta", async () => {
    const onRadiusChange = vi.fn()
    mockFix(12)
    vi.mocked(apiGet).mockResolvedValue({
      rings: [
        { radiusKm: 1, count: 0 },
        { radiusKm: 2, count: 1 },
        { radiusKm: 5, count: 2 },
        { radiusKm: 50, count: 3 },
      ],
      districts: [],
    })

    render(<RadiusPreviewMap onRadiusChange={onRadiusChange} />)
    fireEvent.click(screen.getByText("Usar minha localização"))

    await waitFor(() => expect(onRadiusChange).toHaveBeenCalledWith(5)) // base
    await waitFor(() => expect(onRadiusChange).toHaveBeenCalledWith(50)) // refino
  })

  it("ajuste manual do slider vence o refino pendente", async () => {
    const onRadiusChange = vi.fn()
    mockFix(12)
    let resolveDensity!: (value: unknown) => void
    vi.mocked(apiGet).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDensity = resolve
      }),
    )

    render(<RadiusPreviewMap onRadiusChange={onRadiusChange} />)
    fireEvent.click(screen.getByText("Usar minha localização"))
    await waitFor(() => expect(onRadiusChange).toHaveBeenCalledWith(5))

    // Usuário arrasta o slider antes do refino chegar — o toque manual vence.
    fireEvent.change(screen.getByTestId("slider"), { target: { value: "22" } })
    await waitFor(() => expect(onRadiusChange).toHaveBeenCalledWith(22))

    resolveDensity(DENSE)
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(onRadiusChange).not.toHaveBeenCalledWith(1)
    expect(screen.getAllByText("22 km").length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/raio sugerido: 5 km/)).toBeTruthy()
  })

  it("API de densidade indisponível: mantém a sugestão por accuracy", async () => {
    const onRadiusChange = vi.fn()
    mockFix(12)
    vi.mocked(apiGet).mockRejectedValue(new Error("down"))

    render(<RadiusPreviewMap onRadiusChange={onRadiusChange} />)
    fireEvent.click(screen.getByText("Usar minha localização"))

    await waitFor(() => expect(onRadiusChange).toHaveBeenCalledWith(5))
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(onRadiusChange).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/raio sugerido: 5 km/)).toBeTruthy()
  })
})
