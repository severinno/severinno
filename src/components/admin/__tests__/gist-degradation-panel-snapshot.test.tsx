/**
 * gist-degradation-panel-snapshot.test.tsx
 *
 * Snapshot tests for the GistDegradationPanel component covering the 4
 * visual states defined in the parent GistReindexButton:
 *   1. Initial     — degraded panel visible, REINDEX button, no indicator
 *   2. Reindexing  — loading: "Reindexando…", "Reindexando índices…", spinner
 *   3. Success     — green result after successful REINDEX
 *   4. Refetching  — "Atualizando métricas…" with spinner, panel unchanged
 *
 * Each state is a separate test. Render once → interact → snapshot on
 * the same component instance. No double-render pattern.
 *
 * NOTE: The Collapsible mock renders CollapsibleContent unconditionally
 * (it ignores the open/closed state). The AlertDialog mock renders
 * children unconditionally (only the `data-open` marker is conditional).
 * Both mock artifacts mean dialog content and collapsible details appear
 * in ALL snapshots regardless of interaction state.
 *
 * Mocks (shared via async vi.mock from ./mocks):
 *   lucide-react, AlertDialog, sonner
 * Mocks (local — unique to this snapshot test):
 *   Collapsible, geo-benchmark-model
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import React from "react"
import { render, screen, fireEvent, cleanup } from "@/__tests__/test-utils"
import { GistDegradationPanel } from "../gist-degradation-panel"

// ===========================================================================
// Shared mocks (lucide-react, AlertDialog, sonner)
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
// Mock Collapsible — div-based stub for jsdom
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
// Mock geo-benchmark-model constants
// ===========================================================================

vi.mock("@/lib/geo-benchmark-model", () => ({
  POSTGIS_FIXED_US: 2000,
  POSTGIS_PER_ROW_US: 22,
  PROVIDER_COUNTS: [100, 500, 1000, 5000, 10000],
}))

// ===========================================================================
// Imports from shared mocks
// ===========================================================================

import type { FetchResponseFn } from "./mocks"
import { DEFAULT_GIST_DEGRADATION_PROPS, clickExecuteReindex } from "./mocks"

let mockFetchResponse: FetchResponseFn

// ===========================================================================
// Tests
// ===========================================================================

describe("GistDegradationPanel — snapshot dos 4 estados visuais", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => mockFetchResponse()),
    )
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
      // NotFoundError during cleanup is a known React 19 + jsdom +
      // custom-render artifact. Harmless — tests still pass.
    }
    vi.unstubAllGlobals()
  })

  // ── 1. Initial ────────────────────────────────────────────────────

  it("1. estado inicial — painel degradado visível, botão 'Executar REINDEX', sem indicador", () => {
    const { asFragment } = render(<GistDegradationPanel {...DEFAULT_GIST_DEGRADATION_PROPS} />)

    // Sanity: painel degradado renderizado
    expect(screen.getByText(/Índice GiST degradado/)).toBeInTheDocument()
    expect(screen.getByText(/performance degradada/)).toBeInTheDocument()

    // Botão "Executar REINDEX" presente
    expect(screen.getByText("Executar REINDEX")).toBeInTheDocument()

    // Nenhum indicador de loading ou sucesso
    expect(screen.queryByText("Reindexando índices…")).not.toBeInTheDocument()
    expect(screen.queryByText("Reindexando…")).not.toBeInTheDocument()
    expect(screen.queryByText("Atualizando métricas…")).not.toBeInTheDocument()
    expect(screen.queryByText("sucesso")).not.toBeInTheDocument()

    expect(asFragment()).toMatchSnapshot("gist-degradation-panel-initial")
  })

  // ── 2. Reindexando ────────────────────────────────────────────────

  it("2. reindexando — botão 'Reindexando…', indicador loading com spinner", async () => {
    // Fetch nunca resolve para manter estado de loading
    mockFetchResponse = () => new Promise(() => {})

    const { asFragment } = render(<GistDegradationPanel {...DEFAULT_GIST_DEGRADATION_PROPS} />)

    // Abrir AlertDialog e clicar em confirmar → dispara fetch (nunca resolve)
    fireEvent.click(screen.getByText("Executar REINDEX"))
    fireEvent.click(screen.getByTestId("alert-dialog-action"))

    // Sanity: botão alterado, indicador de loading visível
    expect(screen.getByText("Reindexando…")).toBeInTheDocument()
    expect(screen.getByText("Reindexando índices…")).toBeInTheDocument()
    expect(screen.getByText("Executando…")).toBeInTheDocument()
    expect(screen.queryByText("sucesso")).not.toBeInTheDocument()

    expect(asFragment()).toMatchSnapshot("gist-degradation-panel-reindexing")
  })

  // ── 3. Sucesso ────────────────────────────────────────────────────

  it("3. sucesso — indicador verde com resultado da API", async () => {
    const { asFragment } = render(<GistDegradationPanel {...DEFAULT_GIST_DEGRADATION_PROPS} />)
    await clickExecuteReindex()

    // Sanity: resultado verde, botão voltou ao normal
    expect(screen.getByText(/sucesso/)).toBeInTheDocument()
    expect(screen.getByText(/2122ms/)).toBeInTheDocument()
    expect(screen.getByText("Executar REINDEX")).toBeInTheDocument()

    expect(asFragment()).toMatchSnapshot("gist-degradation-panel-success")
  })

  // ── 4. Refetching ─────────────────────────────────────────────────

  it("4. isRefetching — indicador 'Atualizando métricas…' com spinner, botão inalterado", () => {
    const { asFragment } = render(
      <GistDegradationPanel {...DEFAULT_GIST_DEGRADATION_PROPS} isRefetching={true} />,
    )

    // Sanity: painel degradado visível
    expect(screen.getByText(/Índice GiST degradado/)).toBeInTheDocument()

    // Botão normal + indicador de refetch
    expect(screen.getByText("Executar REINDEX")).toBeInTheDocument()
    expect(screen.getByText("Atualizando métricas…")).toBeInTheDocument()
    expect(screen.queryByText("Reindexando…")).not.toBeInTheDocument()
    expect(screen.queryByText("Reindexando índices…")).not.toBeInTheDocument()

    expect(asFragment()).toMatchSnapshot("gist-degradation-panel-refetching")
  })
})
