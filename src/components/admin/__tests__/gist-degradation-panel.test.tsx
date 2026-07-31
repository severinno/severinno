/**
 * gist-degradation-panel.test.tsx
 *
 * Tests for the GistDegradationPanel component.
 *
 * Mocks (shared in ./mocks.tsx):
 *   - lucide-react — MockIcon placeholder
 *   - AlertDialog — div-based stub
 *   - sonner toast — silent mock
 *   - Collapsible — interactive context-based stub (createCollapsibleMock)
 *
 * Mocks (local — unique to this test):
 *   - geo-benchmark-model — deterministic constant values
 *
 * NOTE: the shared Collapsible mock is faithful to real Radix —
 * CollapsibleContent only renders children when the collapsible is expanded.
 * Tests that read the expanded content (Diagnóstico / Recomendação / Impacto,
 * the REINDEX button, the refetch indicator) call the expandPanel() helper
 * first.
 *
 * Test coverage:
 *   - GistDegradationPanel: null/render states, text content, collapsible
 *   - Model impact section with formula and ratio
 *   - Corner cases: large P95, zero exceedingCount, high maxModel
 *   - Integration: onReindexSuccess prop threading to GistReindexButton
 *     (GistReindexButton already has comprehensive unit tests for the
 *      callback itself — this file only verifies prop routing)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, findByText, cleanup } from "@/__tests__/test-utils"
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
// Shared mock Collapsible (interactive, 2 contextos) — via async vi.mock
// factory from ./mocks, same pattern as lucide-react / alert-dialog / sonner.
// CollapsibleContent only renders children when `open` is true (like real
// Radix), so tests that interact with or assert the expanded content must
// click "Ver detalhes do índice" first — see the expandPanel() helper below.
// ===========================================================================

vi.mock("@/components/ui/collapsible", async () => {
  const { createCollapsibleMock } = await import("./mocks")
  return createCollapsibleMock()
})

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

import type { FetchResponseFn } from "./index"
import {
  buildReindexSuccessResponse,
  buildReindexSlowResponse,
  clickExecuteReindex,
  DEFAULT_GIST_DEGRADATION_PROPS,
} from "./index"

let mockFetchResponse: FetchResponseFn

// ===========================================================================
// Shared visual state tests
// ===========================================================================

import { describeVisualStates } from "./visual-state-tests"

const DEFAULT_PROPS = DEFAULT_GIST_DEGRADATION_PROPS

// ===========================================================================
// Tests
// ===========================================================================

/**
 * Expande o collapsible do painel. Com o mock compartilhado (fiel ao Radix),
 * CollapsibleContent só renderiza quando `open === true` — testes que leem o
 * conteúdo (Diagnóstico/Recomendação/Impacto) ou interagem com o botão
 * REINDEX precisam expandir antes.
 */
function expandPanel() {
  fireEvent.click(screen.getByText("Ver detalhes do índice"))
}

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
    expandPanel()

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
    expandPanel()

    expect(screen.getByTestId("collapsible-content")).toBeInTheDocument()
    expect(screen.getByText(/Diagnóstico/)).toBeInTheDocument()
    expect(screen.getByText(/Recomendação/)).toBeInTheDocument()
    expect(screen.getByText(/Impacto no Modelo/)).toBeInTheDocument()
  })

  it("toggles between 'Ver detalhes do índice' and 'Ocultar detalhes' when clicked", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} />)

    // Estado inicial: colapsado
    expect(screen.getByText("Ver detalhes do índice")).toBeInTheDocument()
    expect(screen.queryByText("Ocultar detalhes")).not.toBeInTheDocument()
    const collapsible = screen.getByTestId("collapsible")
    expect(collapsible.getAttribute("data-open")).toBe("false")

    // Click no trigger → expande (showIndexDetails=true → label switch + rotate-180)
    fireEvent.click(screen.getByText("Ver detalhes do índice"))
    expect(screen.getByText("Ocultar detalhes")).toBeInTheDocument()
    expect(screen.queryByText("Ver detalhes do índice")).not.toBeInTheDocument()
    expect(collapsible.getAttribute("data-open")).toBe("true")

    // Click de novo → recolhe
    fireEvent.click(screen.getByText("Ocultar detalhes"))
    expect(screen.getByText("Ver detalhes do índice")).toBeInTheDocument()
    expect(screen.queryByText("Ocultar detalhes")).not.toBeInTheDocument()
    expect(collapsible.getAttribute("data-open")).toBe("false")
  })

  it("shows the exact P95 excess in the diagnosis section", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} />)
    expandPanel()

    // P95 (90ms) - maxModel (35.2ms) = 54.8ms → Math.round → 55ms
    expect(screen.getByText(/55ms/)).toBeInTheDocument()
  })

  it("shows the 3 recommendation steps (REINDEX, VACUUM, partition)", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} />)
    expandPanel()

    expect(screen.getByText(/REINDEX INDEX CONCURRENTLY/)).toBeInTheDocument()
    expect(screen.getByText(/VACUUM ANALYZE/)).toBeInTheDocument()
    expect(screen.getByText(/work_mem/)).toBeInTheDocument()
  })

  // ── REINDEX flow ──────────────────────────────────────────────────

  it("renders the REINDEX button and confirm dialog opens on click", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} />)
    expandPanel()

    expect(screen.getByText("Executar REINDEX")).toBeInTheDocument()

    // Click to open AlertDialog
    fireEvent.click(screen.getByText("Executar REINDEX"))
    expect(screen.getByTestId("alert-dialog-open")).toBeInTheDocument()
  })

  it("shows 'Executando…' during REINDEX execution", async () => {
    // Make fetch slow so we can observe the loading state
    mockFetchResponse = () => buildReindexSlowResponse(100)

    render(<GistDegradationPanel {...DEFAULT_PROPS} />)
    expandPanel()
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
    expandPanel()
    await clickExecuteReindex()

    // The result indicator contains "sucesso"
    const resultEl = await findByText(/sucesso/)
    expect(resultEl).toBeInTheDocument()
    expect(resultEl.textContent).toContain("sucesso")
    expect(resultEl.textContent).toContain("2122ms")
  })

  // ── Estados visuais (4 estados) — via helper compartilhado ──────
  // Extraído para visual-state-tests.tsx, usado também em
  // gist-reindex-button.test.tsx. PanelContext=true faz os testes
  // expandirem o collapsible antes de interagir com o botão REINDEX.

  describeVisualStates(
    (overrides) => {
      render(<GistDegradationPanel {...DEFAULT_PROPS} {...(overrides as any)} />)
    },
    {
      setMockFetchResponse: (fn) => {
        mockFetchResponse = fn as FetchResponseFn
      },
      clickExecuteReindex,
    },
    { panelContext: true },
  )

  // ── Integration: onReindexSuccess prop threading ──────────────────
  //
  // GistReindexButton already has comprehensive unit tests for the callback
  // (success, failure, network error).  This single integration test verifies
  // that the panel correctly passes the callback prop to the button.

  it("forwards onReindexSuccess to GistReindexButton (integration)", async () => {
    const onSuccess = vi.fn()
    render(<GistDegradationPanel {...DEFAULT_PROPS} onReindexSuccess={onSuccess} />)
    expandPanel()
    await clickExecuteReindex()

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
  })

  // ── isRefetching prop ─────────────────────────────────────────────

  it("passes isRefetching to child and shows 'Atualizando métricas…'", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} isRefetching={true} />)
    expandPanel()

    expect(screen.getByText("Atualizando métricas…")).toBeInTheDocument()
  })

  it("does NOT show refetching indicator when isRefetching is false", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} isRefetching={false} />)
    expandPanel()

    expect(screen.queryByText("Atualizando métricas…")).not.toBeInTheDocument()
  })

  // ── Model impact section ──────────────────────────────────────────

  it("renders the model impact section with formula and ratio", () => {
    render(<GistDegradationPanel {...DEFAULT_PROPS} />)
    expandPanel()

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
    expandPanel()

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
    expandPanel()

    expect(screen.getByText(/0.1×/)).toBeInTheDocument()
  })
})
