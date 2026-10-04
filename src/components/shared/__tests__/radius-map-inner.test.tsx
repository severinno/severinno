/**
 * radius-map-inner.test.tsx
 *
 * Prova lógica do comportamento novo do mapa do raio:
 *   ✅ Mapa MapLibre é criado UMA vez (não recriado quando lat/lng/radius mudam)
 *   ✅ fitBounds recebe os bounds do círculo (centraliza/zoom pelo raio)
 *   ✅ Mudança de raio (ex.: sugerido pela accuracy do GPS) chama fitBounds de novo
 *   ✅ accuracyM (precisão da fix) flui para o círculo pontilhado de incerteza
 *   ✅ Legenda acessível explica os círculos (raio azul + precisão GPS âmbar)
 *   ✅ Cleanup remove os círculos e destrói o mapa no unmount
 *
 * O render real de tiles não é testável em jsdom (WebGL/worker) — aqui
 * mockamos maplibre-gl e verificamos as chamadas.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, cleanup, screen, act } from "@/__tests__/test-utils"

const mockMarker = vi.hoisted(() => ({
  setLngLat: vi.fn().mockReturnThis(),
  addTo: vi.fn().mockReturnThis(),
}))
const mockMapInstance = vi.hoisted(() => ({
  on: vi.fn((event: string, cb: () => void) => {
    if (event === "load") cb()
  }),
  fitBounds: vi.fn(),
  isStyleLoaded: vi.fn(() => true),
  remove: vi.fn(),
}))
const mockMap = vi.hoisted(() =>
  vi.fn(function () {
    return mockMapInstance
  }),
)
const mockMarkerCtor = vi.hoisted(() =>
  vi.fn(function () {
    return mockMarker
  }),
)
const mockSyncRadiusCircle = vi.hoisted(() => vi.fn())
const mockRemoveRadiusCircle = vi.hoisted(() => vi.fn())
const mockSyncAccuracyCircle = vi.hoisted(() => vi.fn())
const mockRemoveAccuracyCircle = vi.hoisted(() => vi.fn())
const mockStartAccuracyPulse = vi.hoisted(() => vi.fn())
const mockPulseStop = vi.hoisted(() => vi.fn())

vi.mock("maplibre-gl", () => ({
  Map: mockMap,
  Marker: mockMarkerCtor,
}))

vi.mock("@/lib/geo-circle", () => ({
  syncRadiusCircle: mockSyncRadiusCircle,
  removeRadiusCircle: mockRemoveRadiusCircle,
  syncAccuracyCircle: mockSyncAccuracyCircle,
  removeAccuracyCircle: mockRemoveAccuracyCircle,
  startAccuracyPulse: mockStartAccuracyPulse,
}))

vi.mock("@/lib/maplibre-worker", () => ({
  ensureMaplibreWorker: vi.fn(() => Promise.resolve(true)),
}))

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}))

import { RadiusMapInner } from "../radius-map-inner"
import { radiusBounds } from "@/lib/geo-radius"

/**
 * Flusha microtasks — a criação do mapa roda após ensureMaplibreWorker().
 * Dentro de act: a criação também seta mapReady (setState fora do act
 * geraria warning e o efeito do pulso não disparia nos assertions).
 */
async function flushMapCreation() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe("RadiusMapInner — criação única + fitBounds", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarker.setLngLat.mockReturnThis()
    mockMarker.addTo.mockReturnThis()
    mockMapInstance.on.mockImplementation((event: string, cb: () => void) => {
      if (event === "load") cb()
    })
  })

  afterEach(() => {
    cleanup()
  })

  it("cria o mapa UMA vez e centraliza no círculo via fitBounds", async () => {
    render(<RadiusMapInner lat={-18.8517} lng={-41.9469} radius={5} />)
    await flushMapCreation()

    expect(mockMap).toHaveBeenCalledTimes(1)
    // Centro inicial + zoom
    const cfg = (
      mockMap.mock.calls as unknown as Array<[{ center: [number, number]; zoom: number }]>
    )[0][0]
    expect(cfg.center).toEqual([-41.9469, -18.8517])

    // fitBounds chamado com os bounds do raio (5 km)
    const expected = radiusBounds(-18.8517, -41.9469, 5)
    expect(mockMapInstance.fitBounds).toHaveBeenCalledWith(
      expected,
      expect.objectContaining({ maxZoom: 14 }),
    )
  })

  it("NÃO recria o mapa quando lat/lng/radius mudam — só move marcador e refaz fitBounds", async () => {
    const { rerender } = render(<RadiusMapInner lat={-18.8517} lng={-41.9469} radius={5} />)
    await flushMapCreation()
    expect(mockMap).toHaveBeenCalledTimes(1)

    await rerender(<RadiusMapInner lat={-18.8517} lng={-41.9469} radius={50} />)
    await rerender(<RadiusMapInner lat={-23.5505} lng={-46.6333} radius={50} />)
    await flushMapCreation()

    // Mapa intacto (antes: era recriado a cada mudança)
    expect(mockMap).toHaveBeenCalledTimes(1)

    // Marcador seguiu a nova localização
    expect(mockMarker.setLngLat).toHaveBeenLastCalledWith([-46.6333, -23.5505])

    // fitBounds refeito com o novo raio/centro
    expect(mockMapInstance.fitBounds).toHaveBeenLastCalledWith(
      radiusBounds(-23.5505, -46.6333, 50),
      expect.objectContaining({ maxZoom: 14 }),
    )
  })

  it("remove o círculo e destrói o mapa no unmount", async () => {
    const { unmount } = render(<RadiusMapInner lat={-18.8517} lng={-41.9469} radius={5} />)
    await flushMapCreation()
    unmount()

    expect(mockRemoveRadiusCircle).toHaveBeenCalled()
    expect(mockRemoveAccuracyCircle).toHaveBeenCalled()
    expect(mockMapInstance.remove).toHaveBeenCalled()
  })

  it("prop accuracyM flui até a lib (círculo pontilhado da incerteza do GPS)", async () => {
    const { rerender } = render(
      <RadiusMapInner lat={-18.8517} lng={-41.9469} radius={5} accuracyM={12} />,
    )
    await flushMapCreation()

    // fix de 12 m no load
    expect(mockSyncAccuracyCircle).toHaveBeenCalledWith(expect.anything(), -18.8517, -41.9469, 12)

    // nova fix (500 m) atualiza sem recriar o mapa
    await rerender(<RadiusMapInner lat={-18.8517} lng={-41.9469} radius={5} accuracyM={500} />)
    expect(mockMap).toHaveBeenCalledTimes(1)
    expect(mockSyncAccuracyCircle).toHaveBeenLastCalledWith(
      expect.anything(),
      -18.8517,
      -41.9469,
      500,
    )

    // fix perdida (null) → prop null chega à lib (que remove o círculo)
    await rerender(<RadiusMapInner lat={-18.8517} lng={-41.9469} radius={5} accuracyM={null} />)
    expect(mockSyncAccuracyCircle).toHaveBeenLastCalledWith(
      expect.anything(),
      -18.8517,
      -41.9469,
      null,
    )
  })
})

// ===========================================================================
// Legenda acessível — explica os círculos do mapa (raio azul + GPS âmbar)
// ===========================================================================

describe("RadiusMapInner — legenda acessível", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarker.setLngLat.mockReturnThis()
    mockMarker.addTo.mockReturnThis()
    mockMapInstance.on.mockImplementation((event: string, cb: () => void) => {
      if (event === "load") cb()
    })
  })

  afterEach(() => {
    cleanup()
  })

  it("wrapper do mapa é role=group com aria-describedby apontando para a legenda", () => {
    render(<RadiusMapInner lat={-18.8517} lng={-41.9469} radius={5} accuracyM={12} />)

    const group = screen.getByRole("group", {
      name: /Mapa de visualização do raio de atendimento/i,
    })
    expect(group.getAttribute("aria-describedby")).toBe("radius-map-legend")
    expect(document.getElementById("radius-map-legend")).not.toBeNull()
  })

  it("com fix de 12 m: legenda descreve raio (5 km) e precisão do GPS (±12 m)", () => {
    render(<RadiusMapInner lat={-18.8517} lng={-41.9469} radius={5} accuracyM={12} />)

    const legend = document.getElementById("radius-map-legend")!
    expect(legend.textContent).toContain("Círculo azul tracejado")
    expect(legend.textContent).toContain("raio de atendimento (5 km)")
    expect(legend.textContent).toContain("Círculo âmbar pontilhado")
    expect(legend.textContent).toContain("precisão do GPS (±12 m)")
  })

  it.each([
    ["5000 m → ±5 km", 5000, "precisão do GPS (±5 km)"],
    ["1200 m → ±1.2 km", 1200, "precisão do GPS (±1.2 km)"],
    ["12.4 m → ±12 m", 12.4, "precisão do GPS (±12 m)"],
  ])("formata a precisão legívelmente: %s", (_label, accuracy, expected) => {
    render(
      <RadiusMapInner lat={-18.8517} lng={-41.9469} radius={5} accuracyM={accuracy as number} />,
    )

    const legend = document.getElementById("radius-map-legend")!
    expect(legend.textContent).toContain(expected)
  })

  it.each([
    ["null (sem fix)", null],
    ["undefined", undefined],
    ["0 (inválida)", 0],
    ["NaN (inválida)", NaN],
  ])(
    "sem precisão válida (%s) o item do GPS sai da legenda, o do raio fica",
    (_label, accuracy) => {
      render(
        <RadiusMapInner
          lat={-18.8517}
          lng={-41.9469}
          radius={5}
          accuracyM={accuracy as number | null | undefined}
        />,
      )

      const legend = document.getElementById("radius-map-legend")!
      expect(legend.textContent).toContain("raio de atendimento (5 km)")
      expect(legend.textContent).not.toContain("precisão do GPS")
      expect(legend.textContent).not.toContain("Círculo âmbar pontilhado")
    },
  )

  it("swatches de cor são decorativos (aria-hidden) — texto carrega a informação", () => {
    render(<RadiusMapInner lat={-18.8517} lng={-41.9469} radius={5} accuracyM={12} />)

    const legend = document.getElementById("radius-map-legend")!
    const swatches = legend.querySelectorAll("span[aria-hidden='true']")
    expect(swatches).toHaveLength(2)
    for (const swatch of swatches) {
      expect(swatch.textContent).toBe("")
    }
  })

  it("legenda não captura interações do mapa (overlay pointer-events-none)", () => {
    render(<RadiusMapInner lat={-18.8517} lng={-41.9469} radius={5} accuracyM={12} />)

    const group = screen.getByRole("group", {
      name: /Mapa de visualização do raio de atendimento/i,
    })
    const overlay = group.querySelector("div.pointer-events-none")
    expect(overlay).not.toBeNull()
  })
})

// ===========================================================================
// Pulso radar — animação suave no círculo de incerteza (efeito radar)
// ===========================================================================

describe("RadiusMapInner — pulso radar", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarker.setLngLat.mockReturnThis()
    mockMarker.addTo.mockReturnThis()
    mockMapInstance.on.mockImplementation((event: string, cb: () => void) => {
      if (event === "load") cb()
    })
    mockStartAccuracyPulse.mockReset()
    mockStartAccuracyPulse.mockImplementation(() => mockPulseStop)
    mockPulseStop.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("com fix válida e mapa pronto: inicia o pulso; unmount chama o stop", async () => {
    const { unmount } = render(
      <RadiusMapInner lat={-18.8517} lng={-41.9469} radius={5} accuracyM={12} />,
    )
    await flushMapCreation()
    // flusha setMapReady(true) → re-render → efeito do pulso
    await act(async () => {})

    expect(mockStartAccuracyPulse).toHaveBeenCalledTimes(1)
    expect(mockStartAccuracyPulse).toHaveBeenCalledWith(expect.anything())

    unmount()
    expect(mockPulseStop).toHaveBeenCalledTimes(1)
  })

  it("fix perdida (accuracyM → null): para o pulso", async () => {
    const { rerender } = render(
      <RadiusMapInner lat={-18.8517} lng={-41.9469} radius={5} accuracyM={12} />,
    )
    await flushMapCreation()
    await act(async () => {})
    expect(mockStartAccuracyPulse).toHaveBeenCalledTimes(1)

    await rerender(<RadiusMapInner lat={-18.8517} lng={-41.9469} radius={5} accuracyM={null} />)
    // cleanup do efeito anterior roda o stop; novo efeito não reinicia
    expect(mockPulseStop).toHaveBeenCalledTimes(1)
    expect(mockStartAccuracyPulse).toHaveBeenCalledTimes(1)
  })

  it("sem fix (accuracyM null) nunca inicia o pulso", async () => {
    render(<RadiusMapInner lat={-18.8517} lng={-41.9469} radius={5} accuracyM={null} />)
    await flushMapCreation()
    await act(async () => {})

    expect(mockStartAccuracyPulse).not.toHaveBeenCalled()
  })

  it("prefers-reduced-motion: reduce → não anima (círculo estático)", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    )

    render(<RadiusMapInner lat={-18.8517} lng={-41.9469} radius={5} accuracyM={12} />)
    await flushMapCreation()
    await act(async () => {})

    expect(mockStartAccuracyPulse).not.toHaveBeenCalled()
  })
})
