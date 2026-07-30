/**
 * gist-degradation-panel.test.tsx
 *
 * Tests for the GistDegradationPanel component.
 *
 * Mocks:
 *   - fetch (global) — three modes: success, failure, network-error
 *   - lucide-react — simple icon placeholders
 *   - Collapsible — div-based stub for jsdom compatibility
 *   - AlertDialog — div-based stub for jsdom compatibility
 *   - sonner (toast) — prevent side effects during tests
 *   - geo-benchmark-model constants — deterministic test values
 *
 * Test coverage:
 *   - GistDegradationPanel: null/render states, text content, collapsible
 *   - onReindexSuccess callback: called ONLY on API success,
 *     NEVER on API failure (success:false) or network error
 *   - Prop threading: isRefetching, onReindexSuccess
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import React from "react"
import { render, screen, fireEvent, waitFor, cleanup } from "@/__tests__/test-utils"
import { GistDegradationPanel } from "../gist-degradation-panel"

// ===========================================================================
// Mock global fetch — installed per-test in beforeEach, removed in afterEach
// ===========================================================================

let mockFetchResponse: () => Promise<Response>

// ===========================================================================
// Mock lucide-react — simple icon placeholders
// ===========================================================================

vi.mock("lucide-react", () => {
  const Icon = (p: { className?: string; "data-testid"?: string }) => (
    <span data-testid={p["data-testid"] ?? "lucide-icon"} data-class={p.className} />
  )
  Icon.displayName = "LucideIcon"
  return { Database: Icon, RefreshCw: Icon, CheckCircle2: Icon, AlertTriangle: Icon }
})

// ===========================================================================
// Mock collapsible — div-based stub for jsdom
// ===========================================================================

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ open, onOpenChange, children, className }: any) => (
    <div data-testid="collapsible" data-open={open} className={className}>
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
// Mock AlertDialog — div-based stub for jsdom
// Simula onOpenChange ao clicar no trigger para que o estado interno
// do componente (showReindexConfirm) seja atualizado.
// ===========================================================================

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children, onOpenChange }: any) => (
    <div data-testid="alert-dialog" data-open={open}>
      {React.Children.map(children, (child: any) => {
        if (
          React.isValidElement(child) &&
          (child as any).type?.displayName === "AlertDialogTrigger"
        ) {
          return React.cloneElement(child as React.ReactElement<any>, { onOpenChange })
        }
        return child
      })}
      {open && <div data-testid="alert-dialog-open" />}
    </div>
  ),
  AlertDialogTrigger: Object.assign(
    function AlertDialogTrigger({ asChild, children, onOpenChange }: any) {
      if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children as React.ReactElement<any>, {
          onClick: (...args: any[]) => {
            onOpenChange?.(true)
            const childOnClick = (children as React.ReactElement<any>).props.onClick
            if (childOnClick) childOnClick(...args)
          },
        })
      }
      return (
        <button type="button" onClick={() => onOpenChange?.(true)}>
          {children}
        </button>
      )
    },
    { displayName: "AlertDialogTrigger" },
  ),
  AlertDialogContent: ({ children }: any) => (
    <div data-testid="alert-dialog-content">{children}</div>
  ),
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: any) => <div data-testid="alert-dialog-footer">{children}</div>,
  AlertDialogTitle: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <div>{children}</div>,
  AlertDialogAction: ({ disabled, onClick, children }: any) => (
    <button type="button" disabled={disabled} data-testid="alert-dialog-action" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: any) => <button type="button">{children}</button>,
}))

// ===========================================================================
// Mock sonner toast — silent during tests
// ===========================================================================

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

// ===========================================================================
// Mock geo-benchmark-model constants
// ===========================================================================

vi.mock("@/lib/geo-benchmark-model", () => ({
  POSTGIS_FIXED_US: 2000,
  POSTGIS_PER_ROW_US: 22,
  PROVIDER_COUNTS: [100, 500, 1000, 5000, 10000],
}))

// ===========================================================================
// Default props
// ===========================================================================

const DEFAULT_PROPS = {
  gistDegraded: true,
  p95Mean: 90,
  radiusKm: 15,
  snapPct: 9,
  maxModelAtSelectivity: 35.2,
  exceedingCount: 4,
}

// ===========================================================================
// Helpers
// ===========================================================================

/** Click through the REINDEX flow: trigger button → confirm in AlertDialog.
 *  After the click, waits for the result indicator to appear, ensuring the
 *  async fetch + React state update have completed before returning. */
async function clickExecuteReindex() {
  // Step 1: click "Executar REINDEX" to open the AlertDialog
  fireEvent.click(screen.getByText("Executar REINDEX"))

  // Step 2: click "Sim, executar REINDEX" in the AlertDialog
  fireEvent.click(screen.getByTestId("alert-dialog-action"))

  // Wait for success/failure indicator text to appear
  // This ensures the async fetch + state update completed
  await screen.findByText(/sucesso|Falha|Erro/, undefined, { timeout: 2000 })
}

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
    mockFetchResponse = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            message: "3/3 índices reindexados com sucesso.",
            indexes: [
              { name: "idx_user_location_gist", durationMs: 1234, ok: true },
              { name: "idx_booking_location_gist", durationMs: 567, ok: true },
              { name: "idx_quoterequest_location_gist", durationMs: 321, ok: true },
            ],
            totalDurationMs: 2122,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
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
    mockFetchResponse = () =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve(
              new Response(
                JSON.stringify({ success: true, message: "ok", indexes: [], totalDurationMs: 0 }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            ),
          100,
        ),
      )

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
    mockFetchResponse = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: false,
            message: "Erro interno",
            indexes: [],
            totalDurationMs: 0,
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      )

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
    // The result indicator shows ❌ — no need to wait for it since
    // clickExecuteReindex already waits for ✅/❌ to appear
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
})
