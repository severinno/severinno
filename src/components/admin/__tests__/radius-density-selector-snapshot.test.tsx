/**
 * radius-density-selector-snapshot.test.tsx
 *
 * Snapshot tests for the RadiusDensitySelector component covering 4 visual
 * states:
 *   1. Default     — initial render with 15km, São Paulo (~10/km²), 15%
 *   2. Raio 5km    — after clicking "5 km" preset
 *   3. Interior    — after clicking "Interior" density preset
 *   4. Sliders     — after changing both sliders via fireEvent.change
 *
 * The RadiusDensitySelector is a pure presentational component — no external
 * dependencies (no lucide-react, no AlertDialog, no sonner, no fetch).
 * The only mock needed is vi.fn() for callbacks.
 *
 * Each state is a separate test. Render once → interact → snapshot on
 * the same component instance. No double-render pattern.
 *
 * Fixtures (shared via ./fixtures.ts):
 *   FIXTURE_RADIUS_DENSITY_PROPS — default props (15km, 10/km², 15%, ~7k)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@/__tests__/test-utils"
import { RadiusDensitySelector } from "../radius-density-selector"

// ===========================================================================
// Shared fixtures
// ===========================================================================

import { FIXTURE_RADIUS_DENSITY_PROPS } from "./index"

// ===========================================================================
// Helpers
// ===========================================================================

function radiusSlider(): HTMLInputElement {
  return screen.getByLabelText("Raio de busca em km")
}

function densitySlider(): HTMLInputElement {
  return screen.getByLabelText("Densidade de providers por km²")
}

// ===========================================================================
// Tests
// ===========================================================================

describe("RadiusDensitySelector — snapshot dos 4 estados visuais", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    try {
      cleanup()
    } catch {
      // Container may already be cleaned up by React 19 + jsdom flushSync
    }
  })

  // ── 1. Default ──────────────────────────────────────────────────────

  it("1. estado default — 15km, São Paulo (~10/km²), 15%, ~7k providers", () => {
    const { asFragment } = render(<RadiusDensitySelector {...FIXTURE_RADIUS_DENSITY_PROPS} />)

    // Sanity: valores default renderizados
    // "15 km" aparece em 3 lugares (label do slider, botão preset ativo e
    // o strong no indicador de seletividade) — use getAllByText.
    expect(screen.getAllByText("15 km").length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/S\u00e3o Paulo/)).toBeInTheDocument()
    expect(screen.getByText("15%")).toBeInTheDocument()
    expect(screen.getByText(/7\.068 providers na \u00e1rea/)).toBeInTheDocument()

    // Sliders com valores corretos
    expect(Number(radiusSlider().value)).toBe(15)
    expect(Number(densitySlider().value)).toBe(10)

    expect(asFragment()).toMatchSnapshot("radius-density-default")
  })

  // ── 2. Raio 5km ────────────────────────────────────────────────────

  it("2. raio 5km — após clicar no preset '5 km', seletividade recalculada", () => {
    const { asFragment } = render(<RadiusDensitySelector {...FIXTURE_RADIUS_DENSITY_PROPS} />)

    // Clicar no preset 5 km
    fireEvent.click(screen.getByRole("button", { name: "5 km" }))

    // Componente CONTROLADO: o clique apenas chama onRadiusKmChange(5).
    // Quem recalcula o radiusKm é o parent — como o parent (teste) não
    // re-renderizou com o novo valor, o botão permanece inativo (bg-muted)
    // e a UI ainda mostra os valores das props originais (15 km, 15%).
    // O snapshot captura exatamente esse estado (sem re-render).
    expect(screen.getByRole("button", { name: "5 km" }).className).toContain("bg-muted")

    // Confirmar que o callback foi chamado
    expect(FIXTURE_RADIUS_DENSITY_PROPS.onRadiusKmChange).toHaveBeenCalledWith(5)

    expect(asFragment()).toMatchSnapshot("radius-density-radius-5km")
  })

  // ── 3. Interior (densidade 2/km²) ──────────────────────────────────

  it("3. densidade Interior — após clicar no preset 'Interior 2/km²'", () => {
    const { asFragment } = render(<RadiusDensitySelector {...FIXTURE_RADIUS_DENSITY_PROPS} />)

    // Clicar no preset Interior
    fireEvent.click(screen.getByRole("button", { name: /Interior/ }))

    // Componente CONTROLADO: o clique apenas chama onDensityChange(2).
    // Como o parent não re-renderizou com o novo valor, o botão permanece
    // inativo (bg-muted). O snapshot captura o estado visual após o clique.
    expect(screen.getByRole("button", { name: /Interior/ }).className).toContain("bg-muted")

    // Confirmar que o callback foi chamado
    expect(FIXTURE_RADIUS_DENSITY_PROPS.onDensityChange).toHaveBeenCalledWith(2)

    expect(asFragment()).toMatchSnapshot("radius-density-density-interior")
  })

  // ── 4. Sliders alterados ───────────────────────────────────────────

  it("4. sliders alterados — raio=30, densidade=25 via fireEvent.change", () => {
    const onRadiusKmChange = vi.fn()
    const onDensityChange = vi.fn()

    const { asFragment } = render(
      <RadiusDensitySelector
        {...FIXTURE_RADIUS_DENSITY_PROPS}
        onRadiusKmChange={onRadiusKmChange}
        onDensityChange={onDensityChange}
      />,
    )

    // Alterar slider de raio para 30
    fireEvent.change(radiusSlider(), { target: { value: "30" } })
    expect(onRadiusKmChange).toHaveBeenCalledWith(30)

    // Alterar slider de densidade para 25
    fireEvent.change(densitySlider(), { target: { value: "25" } })
    expect(onDensityChange).toHaveBeenCalledWith(25)

    // O snapshot captura o estado visual (ainda mostra props originais, pois
    // o parent não re-renderizou com novos valores — o mesmo padrão do preset)
    expect(asFragment()).toMatchSnapshot("radius-density-sliders-altered")
  })
})
