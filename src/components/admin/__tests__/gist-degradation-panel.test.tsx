/**
 * gist-degradation-panel.test.tsx
 *
 * Tests for the GistDegradationPanel component.
 *
 * Mocks (shared in ./mocks.tsx):
 *   - lucide-react — MockIcon placeholder
 *   - AlertDialog — div-based stub
 *   - sonner toast — silent mock
 *
 * Mocks (local — unique to this test):
 *   - Collapsible — div-based stub for jsdom
 *   - geo-benchmark-model — deterministic constant values
 *
 * Test coverage:
 *   - GistDegradationPanel: null/render states, text content, collapsible
 *   - onReindexSuccess callback: called ONLY on API success,
 *     NEVER on API failure (success:false) or network error
 *   - Prop threading: isRefetching, onReindexSuccess
 *   - Model impact section with formula and ratio
 *   - Corner cases: large P95, zero exceedingCount, high maxModel
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import React from "react"
import { render, screen, fireEvent, waitFor, cleanup } from "@/__tests__/test-utils"
import { GistDegradationPanel } from "../gist-degradation-panel"

// ===========================================================================
// Shared mocks (lucide-react, AlertDialog, sonner) — imported via async
// vi.mock factories to work around vitest's hoisting mechanism.
// ===========================================================================

vi.mock("lucide-react", async () => {
  const { MockIcon } = await import("./mocks")
  return {
    Database: MockIcon,
    RefreshCw: MockIcon,
    CheckCircle2: MockIcon,
    AlertTriangle: MockIcon,
  }
})

vi.mock("@/components/ui/alert-dialog", async () => {
  const { createAlertDialogMock } = await import("./mocks")
  return createAlertDialogMock()
})

vi.mock("sonner", async () => {
  const { toastMock } = await import("./mocks")
  return { toast: toastMock }
})

// ===========================================================================
// Mock Collapsible — div-based stub for jsdom (unique to this test)
// ===========================================================================

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ open, onOpenChange, children, className }: any) => (
    <div data-testid="collapsible" data-open={String(open)} className={className}>
      {children}
    </div>
  ),
  CollapsibleTrigger: ({ asChild, children }: any) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children as React.ReactElement<any>)
    }
    return <button type="button">{children}</button>
  },
  CollapsibleContent: ({ children }: any) => (
    <div data-testid="collapsible-content">{children}</div>
  ),
}))

// ===========================================================================
// Mock geo-benchmark-model constants (unique to this test)
// ===========================================================================

vi.mock("@/lib/geo-benchmark-model", () => ({
  POSTGIS_FIXED_US: 2000,
  POSTGIS_PER_ROW_US: 22,
  PROVIDER_COUNTS: [100, 500, 1000, 5000, 10000],
}))

// ===========================================================================
// Shared imports (FetchResponseFn, built response helpers, clickExecuteReindex)
// ===========================================================================

import type { FetchResponseFn } from "./mocks"
import {
  buildReindexSuccessResponse,
  buildReindexFailureResponse,
  buildReindexSlowResponse,
  clickExecuteReindex,
} from "./mocks"

let mockFetchResponse: FetchResponseFn

// ===========================================================================
// Default props
// ===========================================================================

import { DEFAULT_GIST_DEGRADATION_PROPS } from "@/components/admin/__tests__/mocks"

const DEFAULT_PROPS = DEFAULT_GIST_DEGRADATION_PROPS

// ===========================================================================
// Tests
// ===========================================================================

describe("GistDegradationPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Install fetch mock for this test (afterEach removes it)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => mockFetchResponse()),
    )

    // Default fetch: success
    mockFetchResponse = () => Promise.resolve(buildReindexSuccessResponse())
  })

  afterEach(() => {
    try {
      cleanup()
    } catch {
      // Container already cleaned up
    }
    vi.unstubAllGlobals()
  })

  // ── Null when not degraded ─────────────────────────────────────────

  it("returns null when gistDegraded is false", () => {
    const { container } = render(<GistDegradationPanel {...DEFAULT_PROPS} gistDegraded={false} />)
    expect(container.innerHTML).toBe("")
    expect(screen.queryByTestId("collapsible")).not.toBeInTheDocument()
  })

  // ── Renders when degraded ──────────────────────────────────────────

  it("renders the degradation alert when gistDegraded is true", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} />)

    expect(screen.getByTestId("collapsible")).toBeInTheDocument()
    expect(screen.getByText(/Índice GiST degradado/)).toBeInTheDocument()
    expect(screen.getByText(/performance degradada/)).toBeInTheDocument()
  })

  it("shows the P95 value (90ms) in the alert message", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} />)

    // O P95 aparece em múltiplos lugares: alerta principal + diagnóstico + impacto
    const p95Texts = screen.getAllByText(/90ms/)
    expect(p95Texts.length).toBeGreaterThanOrEqual(2)
  })

  it("shows the radius (15km) and selectivity (9%) in the alert message", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} />)

    expect(screen.getByText(/15 km/)).toBeInTheDocument()
    expect(screen.getByText(/9%/)).toBeInTheDocument()
  })

  it("shows the exceeding scales count in the alert message", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} exceedingCount={3} />)

    // 3 de 5 escalas
    expect(screen.getByText(/3 de 5/)).toBeInTheDocument()
  })

  it("shows 'todas as escalas' when all provider counts exceed", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} exceedingCount={5} />)

    expect(screen.getByText(/todas as escalas/)).toBeInTheDocument()
  })

  // ── Collapsible ────────────────────────────────────────────────────

  it("renders the 'Ver detalhes do índice' trigger button", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} />)

    expect(screen.getByText("Ver detalhes do índice")).toBeInTheDocument()
  })

  it("renders collapsible content with diagnosis, recommendation, and impact sections", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} />)

    expect(screen.getByTestId("collapsible-content")).toBeInTheDocument()
    expect(screen.getByText(/Diagnóstico/)).toBeInTheDocument()
    expect(screen.getByText(/Recomendação/)).toBeInTheDocument()
    expect(screen.getByText(/Impacto no Modelo/)).toBeInTheDocument()
  })

  it("shows the exact P95 excess in the diagnosis section", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} />)

    // P95 (90ms) - maxModel (35.2ms) = 54.8ms → Math.round → 55ms
    expect(screen.getByText(/55ms/)).toBeInTheDocument()
  })

  it("shows the 3 recommendation steps (REINDEX, VACUUM, partition)", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} />)

    expect(screen.getByText(/REINDEX INDEX CONCURRENTLY/)).toBeInTheDocument()
    expect(screen.getByText(/VACUUM ANALYZE/)).toBeInTheDocument()
    expect(screen.getByText(/work_mem/)).toBeInTheDocument()
  })

  // ── REINDEX flow ──────────────────────────────────────────────────

  it("renders the REINDEX button and confirm dialog opens on click", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} />)

    expect(screen.getByText("Executar REINDEX")).toBeInTheDocument()

    // Click to open AlertDialog
    fireEvent.click(screen.getByText("Executar REINDEX"))
    expect(screen.getByTestId("alert-dialog-open")).toBeInTheDocument()
  })

  it("shows 'Executando…' during REINDEX execution", async () => {
    // Make fetch slow so we can observe the loading state
    mockFetchResponse = () => buildReindexSlowResponse(100)

    render(<GistDegradationPanel {...DEFAULT_PROPS} />)
    fireEvent.click(screen.getByText("Executar REINDEX"))
    fireEvent.click(screen.getByTestId("alert-dialog-action"))

    // Should show loading state
    expect(screen.getByText("Executando…")).toBeInTheDocument()

    // Wait for the fetch to complete
    await waitFor(
      () => {
        expect(screen.queryByText("Executando…")).not.toBeInTheDocument()
      },
      { timeout: 1000, interval: 10 },
    )
  })

  it("shows success result after successful REINDEX", async () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} />)
    await clickExecuteReindex()

    // The result indicator contains "sucesso"
    const resultEl = await screen.findByText(/sucesso/)
    expect(resultEl).toBeInTheDocument()
    expect(resultEl.textContent).toContain("sucesso")
    expect(resultEl.textContent).toContain("2122ms")
  })

  // ── onReindexSuccess: success scenario ────────────────────────────

  it("calls onReindexSuccess when REINDEX returns success:true", async () => {
    const onSuccess = vi.fn()
    render(<GistDegradationPanel {...DEFAULT_PROPS} onReindexSuccess={onSuccess} />)
    await clickExecuteReindex()

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
  })

  // ── onReindexSuccess: failure scenario ────────────────────────────

  it("does NOT call onReindexSuccess when REINDEX returns success:false", async () => {
    mockFetchResponse = () => Promise.resolve(buildReindexFailureResponse("Erro interno"))

    const onSuccess = vi.fn()
    render(<GistDegradationPanel {...DEFAULT_PROPS} onReindexSuccess={onSuccess} />)
    await clickExecuteReindex()

    // Wait enough time for any possible call to have happened
    await waitFor(
      () => {
        expect(screen.getByText(/Erro interno/)).toBeInTheDocument()
      },
      { timeout: 1000, interval: 10 },
    )

    // Assert onReindexSuccess was NEVER called
    expect(onSuccess).not.toHaveBeenCalled()
  })

  // ── onReindexSuccess: network error scenario ──────────────────────

  it("does NOT call onReindexSuccess when fetch throws a network error", async () => {
    mockFetchResponse = () => Promise.reject(new Error("NetworkError: Failed to fetch"))

    const onSuccess = vi.fn()
    render(<GistDegradationPanel {...DEFAULT_PROPS} onReindexSuccess={onSuccess} />)
    await clickExecuteReindex()

    // Wait for error state to render
    expect(screen.getByText(/NetworkError/)).toBeInTheDocument()

    // Assert onReindexSuccess was NEVER called
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it("shows connection error message when fetch fails", async () => {
    mockFetchResponse = () => Promise.reject(new Error("NetworkError: Failed to fetch"))

    render(<GistDegradationPanel {...DEFAULT_PROPS} />)
    await clickExecuteReindex()

    const errorEl = screen.getByText(/NetworkError/)
    expect(errorEl.textContent).toContain("NetworkError")
  })

  // ── isRefetching prop ─────────────────────────────────────────────

  it("passes isRefetching to child and shows 'Atualizando métricas…'", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} isRefetching={true} />)

    expect(screen.getByText("Atualizando métricas…")).toBeInTheDocument()
  })

  it("does NOT show refetching indicator when isRefetching is false", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} isRefetching={false} />)

    expect(screen.queryByText("Atualizando métricas…")).not.toBeInTheDocument()
  })

  // ── Model impact section ──────────────────────────────────────────

  it("renders the model impact section with formula and ratio", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} />)

    // "2ms" aparece em múltiplos lugares (alerta principal + fórmula)
    const twoMsTexts = screen.getAllByText(/2ms/)
    expect(twoMsTexts.length).toBeGreaterThanOrEqual(2)

    // 0.022ms aparece na fórmula do modelo
    expect(screen.getByText(/0.022ms/)).toBeInTheDocument()

    // Ratio: 90ms / 35.2ms = 2.6×
    expect(screen.getByText(/2.6×/)).toBeInTheDocument()
  })

  // ── Corner cases ──────────────────────────────────────────────────

  it("handles very large P95 values correctly", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} p95Mean={9999} />)

    // "9999ms" aparece em múltiplos lugares (alerta, diagnóstico, impacto)
    const texts = screen.getAllByText(/9999ms/)
    expect(texts.length).toBeGreaterThanOrEqual(2)
  })

  it("handles zero exceeding count (should not happen but defensive)", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} exceedingCount={0} />)

    expect(screen.getByTestId("collapsible")).toBeInTheDocument()
  })

  it("handles very high maxModelAtSelectivity for ratio display", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} maxModelAtSelectivity={1000} />)

    expect(screen.getByText(/0.1×/)).toBeInTheDocument()
  })

  // ── Estados visuais do GistReindexButton dentro do painel pai ────
  //
  // Validates that the 4 visual states defined in GistReindexButton also
  // function correctly when the button is rendered inside GistDegradationPanel
  // (the collapsible alert panel that contains the button in its recommendation
  // section). The CollapsibleContent mock renders children unconditionally,
  // and the AlertDialog mock renders children unconditionally — both mock
  // artifacts that make the button accessible without expanding the panel.
  //
  // These tests mirror the "Estados visuais" describe block in
  // gist-reindex-button.test.tsx but use the parent panel props.

  describe("Estados visuais (GistReindexButton dentro do panel pai)", () => {
    it("1. estado inicial — botão 'Executar REINDEX', sem indicador", () => {
      render(<GistDegradationPanel {...DEFAULT_PROPS} />)

      // Alert: painel degradado visível
      expect(screen.getByText(/Índice GiST degradado/)).toBeInTheDocument()

      // Botão "Executar REINDEX" presente e habilitado
      const btn = screen.getByText("Executar REINDEX")
      expect(btn).toBeInTheDocument()
      expect(btn).not.toBeDisabled()

      // Nenhum spinner ou indicador visível
      expect(screen.queryByText("Reindexando índices…")).not.toBeInTheDocument()
      expect(screen.queryByText("Reindexando…")).not.toBeInTheDocument()
      expect(screen.queryByText("Atualizando métricas…")).not.toBeInTheDocument()
      expect(screen.queryByText("sucesso")).not.toBeInTheDocument()
    })

    it("2. reindexando — botão 'Reindexando…', indicador loading com spinner", async () => {
      // Fetch nunca resolve para manter estado de loading
      mockFetchResponse = () => new Promise(() => {})

      render(<GistDegradationPanel {...DEFAULT_PROPS} />)

      // Clicar no botão do REINDEX → abre AlertDialog → clica em confirmar
      fireEvent.click(screen.getByText("Executar REINDEX"))
      fireEvent.click(screen.getByTestId("alert-dialog-action"))

      // Botão do trigger alterou texto para "Reindexando…"
      expect(screen.getByText("Reindexando…")).toBeInTheDocument()
      expect(screen.queryByText("Executar REINDEX")).not.toBeInTheDocument()

      // Botão de confirmação do dialog mostra "Executando…"
      expect(screen.getByText("Executando…")).toBeInTheDocument()

      // Indicador de loading visível
      expect(screen.getByText("Reindexando índices…")).toBeInTheDocument()

      // Spinner com animate-spin presente
      const spinners = screen.getAllByTestId("lucide-icon")
      const animatedSpinner = spinners.find((el) =>
        el.getAttribute("data-class")?.includes("animate-spin"),
      )
      expect(animatedSpinner).toBeInTheDocument()

      // Nenhum resultado ainda
      expect(screen.queryByText("sucesso")).not.toBeInTheDocument()
      expect(screen.queryByText("Sim, executar REINDEX")).not.toBeInTheDocument()
    })

    it("3. sucesso — indicador verde com resultado da API", async () => {
      render(<GistDegradationPanel {...DEFAULT_PROPS} />)
      await clickExecuteReindex()

      // Painel degradado continua visível
      expect(screen.getByText(/Índice GiST degradado/)).toBeInTheDocument()

      // Botão voltou ao texto inicial "Executar REINDEX"
      expect(screen.getByText("Executar REINDEX")).toBeInTheDocument()
      expect(screen.queryByText("Reindexando…")).not.toBeInTheDocument()

      // Indicador verde de sucesso com detalhes da API
      const resultEl = screen.getByText(/sucesso/)
      expect(resultEl).toBeInTheDocument()
      expect(resultEl.textContent).toContain("sucesso")
      expect(resultEl.textContent).toContain("2122ms")
      expect(resultEl.textContent).toContain("idx_user_location_gist")

      // Nenhum spinner de loading
      expect(screen.queryByText("Reindexando índices…")).not.toBeInTheDocument()
      expect(screen.queryByText("Atualizando métricas…")).not.toBeInTheDocument()
    })

    it("4. isRefetching — indicador 'Atualizando métricas…' com spinner, botão inalterado", () => {
      render(<GistDegradationPanel {...DEFAULT_PROPS} isRefetching={true} />)

      // Painel degradado visível
      expect(screen.getByText(/Índice GiST degradado/)).toBeInTheDocument()

      // Botão "Executar REINDEX" ainda aparece (não está reindexando)
      expect(screen.getByText("Executar REINDEX")).toBeInTheDocument()
      expect(screen.queryByText("Reindexando…")).not.toBeInTheDocument()
      expect(screen.queryByText("Reindexando índices…")).not.toBeInTheDocument()

      // Indicador de refetch visível
      expect(screen.getByText("Atualizando métricas…")).toBeInTheDocument()

      // Ícone com animate-spin presente
      const icons = screen.getAllByTestId("lucide-icon")
      const animatedIcon = icons.find((el) =>
        el.getAttribute("data-class")?.includes("animate-spin"),
      )
      expect(animatedIcon).toBeInTheDocument()

      // Nenhum resultado
      expect(screen.queryByText("sucesso")).not.toBeInTheDocument()
    })
  })
})
