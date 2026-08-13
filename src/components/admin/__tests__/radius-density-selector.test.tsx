/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for RadiusDensitySelector — Raio de Busca + Densidade + Seletividade
 *
 * Covers:
 *   - Renderização com valores default
 *   - Clique nos presets de raio (5/15/30/50 km)
 *   - Clique nos presets de densidade (Interior/RJ/SP/Metrópole)
 *   - Alteração dos sliders via fireEvent.change
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@/__tests__/test-utils"

import { RadiusDensitySelector } from "../radius-density-selector"

// ===========================================================================
// Shared fixtures
// ===========================================================================

import { FIXTURE_RADIUS_DENSITY_PROPS } from "./fixtures"

// ── Helpers: encontrar inputs range ───────────────────────────────────────

function radiusSlider(): HTMLInputElement {
  return screen.getByLabelText("Raio de busca em km")
}

function densitySlider(): HTMLInputElement {
  return screen.getByLabelText("Densidade de providers por km²")
}
// ── Default props (imported from shared fixtures) ────────────────────────

const DEFAULT_PROPS = FIXTURE_RADIUS_DENSITY_PROPS

// ── Suite ─────────────────────────────────────────────────────────────────

describe("RadiusDensitySelector", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Renderização
  // ─────────────────────────────────────────────────────────────────────────

  describe("renderização", () => {
    it("renderiza o seletor com valores default", () => {
      render(<RadiusDensitySelector {...DEFAULT_PROPS} />)

      // O valor do raio aparece em múltiplos lugares (label slider + indicador seletividade)
      const radiusTexts = screen.getAllByText("15 km")
      expect(radiusTexts.length).toBeGreaterThanOrEqual(2)

      // Sliders existem com os valores corretos
      expect(radiusSlider()).toBeInTheDocument()
      expect(Number(radiusSlider().value)).toBe(15)

      expect(densitySlider()).toBeInTheDocument()
      expect(Number(densitySlider().value)).toBe(10)

      // Label de densidade
      expect(screen.getByText(/São Paulo/)).toBeInTheDocument()

      // Estimativa de providers
      expect(screen.getByText(/7\.068 providers na área/)).toBeInTheDocument()

      // Seletividade
      expect(screen.getByText("15%")).toBeInTheDocument()
    })

    it("renderiza com radiusKm=50 e selPct=5", () => {
      render(
        <RadiusDensitySelector
          {...DEFAULT_PROPS}
          radiusKm={50}
          selPct={5}
          currentSelectivity={0.05}
        />,
      )

      const radiusTexts = screen.getAllByText("50 km")
      expect(radiusTexts.length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText("5%")).toBeInTheDocument()
    })

    it("renderiza com radiusKm=1 (mínimo)", () => {
      render(
        <RadiusDensitySelector
          {...DEFAULT_PROPS}
          radiusKm={1}
          selPct={1}
          currentSelectivity={0.01}
        />,
      )

      const radiusTexts = screen.getAllByText("1 km")
      expect(radiusTexts.length).toBeGreaterThanOrEqual(1)
    })

    it("renderiza com density=2 (mínimo) e label Interior", () => {
      render(
        <RadiusDensitySelector
          {...DEFAULT_PROPS}
          density={2}
          densityLabel="Interior (~2/km²)"
          estimatedProviders={Math.round(Math.PI * 15 * 15 * 2)}
        />,
      )

      // "Interior" aparece na label de densidade E no botão preset
      const interiorTexts = screen.getAllByText(/Interior/)
      expect(interiorTexts.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Presets de raio
  // ─────────────────────────────────────────────────────────────────────────

  describe("presets de raio", () => {
    it('chama onRadiusKmChange(5) ao clicar no preset "5 km"', () => {
      render(<RadiusDensitySelector {...DEFAULT_PROPS} />)

      fireEvent.click(screen.getByRole("button", { name: "5 km" }))
      expect(DEFAULT_PROPS.onRadiusKmChange).toHaveBeenCalledWith(5)
    })

    it('chama onRadiusKmChange(15) ao clicar no preset "15 km"', () => {
      render(<RadiusDensitySelector {...DEFAULT_PROPS} />)

      fireEvent.click(screen.getByRole("button", { name: "15 km" }))
      expect(DEFAULT_PROPS.onRadiusKmChange).toHaveBeenCalledWith(15)
    })

    it('chama onRadiusKmChange(30) ao clicar no preset "30 km"', () => {
      render(<RadiusDensitySelector {...DEFAULT_PROPS} />)

      fireEvent.click(screen.getByRole("button", { name: "30 km" }))
      expect(DEFAULT_PROPS.onRadiusKmChange).toHaveBeenCalledWith(30)
    })

    it('chama onRadiusKmChange(50) ao clicar no preset "50 km"', () => {
      render(<RadiusDensitySelector {...DEFAULT_PROPS} />)

      fireEvent.click(screen.getByRole("button", { name: "50 km" }))
      expect(DEFAULT_PROPS.onRadiusKmChange).toHaveBeenCalledWith(50)
    })

    it("destaca visualmente o preset ativo (radiusKm === 15)", () => {
      render(<RadiusDensitySelector {...DEFAULT_PROPS} radiusKm={15} />)

      const activeButton = screen.getByRole("button", { name: "15 km" })
      // O preset ativo tem as classes bg-primary text-primary-foreground
      expect(activeButton.className).toContain("bg-primary")
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Presets de densidade
  // ─────────────────────────────────────────────────────────────────────────

  describe("presets de densidade", () => {
    it('chama onDensityChange(2) ao clicar no preset "Interior"', () => {
      render(<RadiusDensitySelector {...DEFAULT_PROPS} />)

      fireEvent.click(screen.getByRole("button", { name: /Interior/ }))
      expect(DEFAULT_PROPS.onDensityChange).toHaveBeenCalledWith(2)
    })

    it('chama onDensityChange(8) ao clicar no preset "RJ"', () => {
      render(<RadiusDensitySelector {...DEFAULT_PROPS} />)

      fireEvent.click(screen.getByRole("button", { name: /RJ/ }))
      expect(DEFAULT_PROPS.onDensityChange).toHaveBeenCalledWith(8)
    })

    it('chama onDensityChange(10) ao clicar no preset "SP"', () => {
      render(<RadiusDensitySelector {...DEFAULT_PROPS} />)

      fireEvent.click(screen.getByRole("button", { name: /SP/ }))
      expect(DEFAULT_PROPS.onDensityChange).toHaveBeenCalledWith(10)
    })

    it('chama onDensityChange(30) ao clicar no preset "Metrópole"', () => {
      render(<RadiusDensitySelector {...DEFAULT_PROPS} />)

      fireEvent.click(screen.getByRole("button", { name: /Metrópole/ }))
      expect(DEFAULT_PROPS.onDensityChange).toHaveBeenCalledWith(30)
    })

    it("destaca visualmente o preset de densidade ativo (density === 10 = SP)", () => {
      render(<RadiusDensitySelector {...DEFAULT_PROPS} density={10} />)

      const activeButton = screen.getByRole("button", { name: /SP/ })
      expect(activeButton.className).toContain("bg-primary")
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Sliders
  // ─────────────────────────────────────────────────────────────────────────

  describe("sliders", () => {
    it("altera o raio via fireEvent.change no slider de raio", () => {
      const onRadiusKmChange = vi.fn()
      render(<RadiusDensitySelector {...DEFAULT_PROPS} onRadiusKmChange={onRadiusKmChange} />)

      fireEvent.change(radiusSlider(), { target: { value: "30" } })
      expect(onRadiusKmChange).toHaveBeenCalledWith(30)
    })

    it("altera a densidade via fireEvent.change no slider de densidade", () => {
      const onDensityChange = vi.fn()
      render(<RadiusDensitySelector {...DEFAULT_PROPS} onDensityChange={onDensityChange} />)

      fireEvent.change(densitySlider(), { target: { value: "20" } })
      expect(onDensityChange).toHaveBeenCalledWith(20)
    })

    it("slider de raio respeita o mínimo (1) e máximo (REFERENCE_RADIUS_KM)", () => {
      render(<RadiusDensitySelector {...DEFAULT_PROPS} />)

      const slider = radiusSlider()
      expect(Number(slider.min)).toBe(1)
      expect(Number(slider.max)).toBeGreaterThanOrEqual(50)
    })

    it("slider de densidade respeita o mínimo (2) e máximo (50)", () => {
      render(<RadiusDensitySelector {...DEFAULT_PROPS} />)

      const slider = densitySlider()
      expect(Number(slider.min)).toBe(2)
      expect(Number(slider.max)).toBe(50)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Seletividade
  // ─────────────────────────────────────────────────────────────────────────

  describe("seletividade", () => {
    it("exibe o texto de seletividade com o raio atual", () => {
      render(<RadiusDensitySelector {...DEFAULT_PROPS} />)

      // O valor "15%" é único (só aparece no indicador de seletividade)
      expect(screen.getByText("15%")).toBeInTheDocument()

      // "15 km" aparece no label do slider e no indicador de seletividade
      // Verificamos por getAllByText que encontra ambos
      const radiusTexts = screen.getAllByText("15 km")
      expect(radiusTexts.length).toBeGreaterThanOrEqual(2)
    })

    it("inclui o label de seletividade equivalente quando currentSelectivity > 0", () => {
      render(<RadiusDensitySelector {...DEFAULT_PROPS} currentSelectivity={0.25} />)

      // Deve conter "seletividade equivalente a" no texto
      expect(screen.getByText(/seletividade equivalente a/)).toBeInTheDocument()
    })

    it("omite o label de seletividade equivalente quando currentSelectivity = 0", () => {
      render(<RadiusDensitySelector {...DEFAULT_PROPS} currentSelectivity={0} selPct={0} />)

      expect(screen.queryByText(/seletividade equivalente a/)).not.toBeInTheDocument()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Integração callbacks
  // ─────────────────────────────────────────────────────────────────────────

  describe("callbacks", () => {
    it("callback de raio não é chamado durante a renderização", () => {
      render(<RadiusDensitySelector {...DEFAULT_PROPS} />)
      expect(DEFAULT_PROPS.onRadiusKmChange).not.toHaveBeenCalled()
    })

    it("callback de densidade não é chamado durante a renderização", () => {
      render(<RadiusDensitySelector {...DEFAULT_PROPS} />)
      expect(DEFAULT_PROPS.onDensityChange).not.toHaveBeenCalled()
    })
  })
})
