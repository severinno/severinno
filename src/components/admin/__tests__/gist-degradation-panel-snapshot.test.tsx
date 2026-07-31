/**
 * gist-degradation-panel-snapshot.test.tsx
 *
 * Snapshot tests for the GistDegradationPanel covering the LAYOUT states
 * unique to the panel:
 *   1. Initial  — degraded panel visible, REINDEX button hidden inside the
 *                 collapsed CollapsibleContent, no loading/success indicator
 *   2. Expanded — degraded panel with the collapsible OPEN (no REINDEX
 *                 running): full layout with 🔍 Diagnóstico, 🛠️
 *                 Recomendação (REINDEX / VACUUM ANALYZE / particionamento),
 *                 the REINDEX button and 📊 Impacto no Modelo
 *
 * States 3–5 (reindexing, success, refetching) are intentionally NOT
 * snapshotted here — they are fully covered by the parent-child
 * factorization in gist-reindex-button-snapshot.test.tsx, which snapshots
 * the exact same visual output (the panel only wraps the button +
 * indicator and forwards the visual states). Re-rendering them here would
 * duplicate the snapshots and double the maintenance cost on any UI
 * change. The interactive behavior of states 3–5 inside the panel is
 * covered by the interaction tests in gist-degradation-panel.test.tsx.
 *
 * NOTE: The Collapsible mock uses React Context to propagate the `open`
 * state: CollapsibleContent only renders children when `open && true`.
 * The snapshot of state 1 (initial) should NOT contain collapsible content
 * since the panel hasn't been expanded; state 2 expands it by clicking the
 * trigger.
 *
 * Known tradeoffs:
 *   - The AlertDialog mock (createAlertDialogMock) renders its children
 *     UNCONDITIONALLY (only `data-open` is conditional), so the expanded
 *     snapshot (state 2) includes the REINDEX confirmation dialog content
 *     even though it is programmatically closed — do not "fix" this by
 *     mocking the dialog away; it mirrors the button snapshot behavior.
 *   - State 2 also includes GistReindexButton in its INITIAL visual (the
 *     button's own 4 visual states are deduplicated in
 *     gist-reindex-button-snapshot.test.tsx). This overlap is intentional:
 *     state 2 is an integration-level snapshot of the PANEL layout
 *     (Diagnóstico / Recomendação / Impacto), content the button snapshot
 *     cannot cover.
 *
 * Mocks (shared via async vi.mock from ./mocks):
 *   lucide-react, AlertDialog, sonner, Collapsible (createCollapsibleMock)
 * Mocks (local — unique to this snapshot test):
 *   geo-benchmark-model
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
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
// Shared mock Collapsible (interactive, 2 contextos) — via async vi.mock
// factory from ./mocks, same pattern as lucide-react / alert-dialog / sonner.
// ===========================================================================

vi.mock("@/components/ui/collapsible", async () => {
  const { createCollapsibleMock } = await import("./mocks")
  return createCollapsibleMock()
})

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

import { DEFAULT_GIST_DEGRADATION_PROPS } from "./index"

// ===========================================================================
// Tests
// ===========================================================================

describe("GistDegradationPanel — snapshots de layout", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    try {
      cleanup()
    } catch {
      // NotFoundError during cleanup is a known React 19 + jsdom +
      // custom-render artifact. Harmless — tests still pass.
    }
  })

  // ── 1. Initial ────────────────────────────────────────────────────

  it("1. estado inicial — painel degradado visível, collapsible fechado, sem indicador", () => {
    const { asFragment } = render(<GistDegradationPanel {...DEFAULT_GIST_DEGRADATION_PROPS} />)

    // Sanity: painel degradado renderizado
    expect(screen.getByText(/Índice GiST degradado/)).toBeInTheDocument()
    expect(screen.getByText(/performance degradada/)).toBeInTheDocument()

    // Botão "Executar REINDEX" NÃO está visível: ele vive dentro do
    // CollapsibleContent, que (com o mock baseado em Context) só renderiza
    // quando o painel está expandido. Estado inicial = colapsado.
    expect(screen.queryByText("Executar REINDEX")).not.toBeInTheDocument()

    // Nenhum indicador de loading ou sucesso
    expect(screen.queryByText("Reindexando índices…")).not.toBeInTheDocument()
    expect(screen.queryByText("Reindexando…")).not.toBeInTheDocument()
    expect(screen.queryByText("Atualizando métricas…")).not.toBeInTheDocument()
    expect(screen.queryByText("sucesso")).not.toBeInTheDocument()

    expect(asFragment()).toMatchSnapshot("gist-degradation-panel-initial")
  })

  // ── 2. Expanded (sem REINDEX) ──────────────────────────────────────

  it("2. estado expandido — painel degradado + collapsible aberto, diagnóstico e recomendações completos", () => {
    const { asFragment } = render(<GistDegradationPanel {...DEFAULT_GIST_DEGRADATION_PROPS} />)

    // Expandir o collapsible para revelar o conteúdo (NÃO dispara REINDEX)
    fireEvent.click(screen.getByText("Ver detalhes do índice"))

    // Sanity: trigger alternado + painel degradado ainda visível
    expect(screen.getByText("Ocultar detalhes")).toBeInTheDocument()
    expect(screen.getByText(/Índice GiST degradado/)).toBeInTheDocument()

    // Diagnóstico completo
    expect(screen.getByText(/🔍 Diagnóstico/)).toBeInTheDocument()
    expect(screen.getByText(/P95 real do PostGIS \(90ms\) excede a previsão/)).toBeInTheDocument()

    // Recomendações (REINDEX, VACUUM ANALYZE, particionamento + work_mem)
    expect(screen.getByText(/🛠️ Recomendação/)).toBeInTheDocument()
    expect(
      screen.getByText(/REINDEX INDEX CONCURRENTLY idx_user_location_gist;/),
    ).toBeInTheDocument()
    expect(screen.getByText(/VACUUM ANALYZE/)).toBeInTheDocument()
    expect(screen.getByText(/work_mem/)).toBeInTheDocument()

    // Botão REINDEX agora visível (vive dentro do CollapsibleContent)
    expect(screen.getByText("Executar REINDEX")).toBeInTheDocument()

    // Impacto no modelo
    expect(screen.getByText(/📊 Impacto no Modelo/)).toBeInTheDocument()
    expect(screen.getByText(/razão de/)).toBeInTheDocument()

    expect(asFragment()).toMatchSnapshot("gist-degradation-panel-expanded")
  })
})
