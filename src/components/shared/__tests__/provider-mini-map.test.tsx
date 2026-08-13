// @ts-nocheck
/**
 * provider-mini-map.test.tsx
 *
 * Unit tests for ProviderMiniMap — the compact lazy-loaded MapLibre map.
 *
 * Covers:
 *   1. Rendering with valid coordinates (container, badge, map init, loading→ready)
 *   2. Guard for invalid coordinates (null / NaN / 0,0 → placeholder, no map)
 *   3. Fallback to the static OSM image when MapLibre fails to load
 *
 * MapLibre is dynamically imported inside the component (`await import(...)`),
 * so the module + its CSS are mocked at the top of this file.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react"
import ProviderMiniMap from "../provider-mini-map"

// ── Hoisted mocks (module factory can only see hoisted refs) ───────────────

const h = vi.hoisted(() => {
  const Map = vi.fn(() => ({
    on: vi.fn((event: string, cb: () => void) => {
      if (event === "load") cb()
    }),
    remove: vi.fn(),
  }))
  const Marker = vi.fn(() => {
    const marker = {
      setLngLat: vi.fn(() => marker),
      addTo: vi.fn(() => marker),
    }
    return marker
  })
  return { Map, Marker }
})

vi.mock("maplibre-gl", () => ({
  Map: h.Map,
  Marker: h.Marker,
}))

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}))

// ── Helpers ────────────────────────────────────────────────────────────────

const SP = { lat: -23.5505, lng: -46.6333 }

function renderMap(overrides = {}) {
  return render(
    <ProviderMiniMap
      providerLat={SP.lat}
      providerLng={SP.lng}
      providerName="Maria Silva"
      {...overrides}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: Map constructor succeeds and fires "load" synchronously
  h.Map.mockImplementation(() => ({
    on: vi.fn((event: string, cb: () => void) => {
      if (event === "load") cb()
    }),
    remove: vi.fn(),
  }))
})

// Explicit cleanup: when this file runs after other component-test files in
// the same fork, RTL's module-level auto-cleanup registration is not picked
// up, so previous renders would linger in the DOM and "Found multiple
// elements" failures would appear. Unmount deterministically per test.
afterEach(() => {
  cleanup()
})

// ---------------------------------------------------------------------------
// 1. Render com coords válidas
// ---------------------------------------------------------------------------

describe("ProviderMiniMap — render com coords válidas", () => {
  it("renderiza o container e o badge com o nome do prestador", async () => {
    renderMap()

    await waitFor(() => {
      expect(screen.getByTestId("provider-mini-map")).toBeInTheDocument()
    })
    expect(screen.getByTestId("mini-map-badge")).toHaveTextContent("Maria Silva")
  })

  it("inicializa o MapLibre com o centro nas coords do prestador", async () => {
    renderMap()

    await waitFor(() => {
      expect(h.Map).toHaveBeenCalledTimes(1)
    })
    expect(h.Map).toHaveBeenCalledWith(
      expect.objectContaining({
        center: [SP.lng, SP.lat], // [lng, lat] order for MapLibre
        zoom: 14,
      }),
    )
  })

  it("mostra loading enquanto o mapa carrega e fica pronto após 'load'", async () => {
    renderMap()

    // Before the async MapLibre import resolves, the loader is visible
    expect(screen.getByTestId("mini-map-loading")).toBeInTheDocument()

    await waitFor(() => {
      expect(
        screen.queryByTestId("mini-map-loading"),
      ).not.toBeInTheDocument()
    })
  })

  it("adiciona um marcador para o prestador", async () => {
    renderMap()

    await waitFor(() => {
      expect(h.Marker).toHaveBeenCalled()
    })
    expect(h.Marker).toHaveBeenCalledWith(
      expect.objectContaining({ element: expect.anything() }),
    )
  })

  it("abre o OpenStreetMap ao clicar no botão expandir", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)
    renderMap()

    await waitFor(() => {
      expect(screen.getByTestId("mini-map-expand")).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId("mini-map-expand"))

    expect(openSpy).toHaveBeenCalledWith(
      `https://www.openstreetmap.org/?mlat=${SP.lat}&mlon=${SP.lng}&zoom=15`,
      "_blank",
      "noopener",
    )
    openSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// 2. Guard de coords inválidas (null / NaN / 0,0)
// ---------------------------------------------------------------------------

describe("ProviderMiniMap — guard de coords inválidas", () => {
  it("renderiza placeholder e NÃO cria o mapa para (0, 0)", () => {
    renderMap({ providerLat: 0, providerLng: 0 })

    expect(screen.getByTestId("mini-map-placeholder")).toBeInTheDocument()
    expect(screen.getByText("Localização indisponível")).toBeInTheDocument()
    expect(h.Map).not.toHaveBeenCalled()
  })

  it("renderiza placeholder e NÃO cria o mapa para coords null", () => {
    renderMap({ providerLat: null, providerLng: null })

    expect(screen.getByTestId("mini-map-placeholder")).toBeInTheDocument()
    expect(h.Map).not.toHaveBeenCalled()
  })

  it("renderiza placeholder e NÃO cria o mapa para coords NaN", () => {
    renderMap({ providerLat: NaN, providerLng: NaN })

    expect(screen.getByTestId("mini-map-placeholder")).toBeInTheDocument()
    expect(h.Map).not.toHaveBeenCalled()
  })

  it("renderiza placeholder com a altura solicitada", () => {
    renderMap({ providerLat: 0, providerLng: 0, height: 160 })

    const placeholder = screen.getByTestId("mini-map-placeholder")
    expect(placeholder).toHaveStyle({ height: "160px" })
  })
})

// ---------------------------------------------------------------------------
// 3. Fallback para imagem estática OSM
// ---------------------------------------------------------------------------

describe("ProviderMiniMap — fallback para imagem estática OSM", () => {
  it("mostra a imagem estática quando o MapLibre falha ao carregar", async () => {
    // Simulate MapLibre failing at Map construction (caught by the effect)
    h.Map.mockImplementation(() => {
      throw new Error("map failed")
    })

    renderMap()

    await waitFor(() => {
      expect(screen.getByTestId("mini-map-fallback")).toBeInTheDocument()
    })

    const img = screen.getByTestId("mini-map-fallback-image")
    expect(img).toHaveAttribute(
      "src",
      expect.stringContaining("staticmap.openstreetmap.de"),
    )
    expect(img).toHaveAttribute(
      "src",
      expect.stringContaining(`markers=${SP.lat},${SP.lng},red-pushpin`),
    )
    expect(img).toHaveAttribute("alt", "Mapa de Maria Silva")
    expect(
      screen.getByText("Mapa interativo indisponível"),
    ).toBeInTheDocument()
  })

  it("codifica as coords e o tamanho corretos na URL da imagem estática", async () => {
    h.Map.mockImplementation(() => {
      throw new Error("map failed")
    })

    renderMap({ height: 160 })

    await waitFor(() => {
      expect(screen.getByTestId("mini-map-fallback-image")).toBeInTheDocument()
    })

    const src = screen.getByTestId("mini-map-fallback-image").getAttribute("src")
    expect(src).toContain(`center=${SP.lat},${SP.lng}`)
    expect(src).toContain("size=400x160")
    expect(src).toContain("zoom=14")
  })
})
