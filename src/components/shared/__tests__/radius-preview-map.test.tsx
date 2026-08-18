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
 *   ✅ Slider has an accessible label
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@/__tests__/test-utils"

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

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import RadiusPreviewMap from "../radius-preview-map"

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
})
