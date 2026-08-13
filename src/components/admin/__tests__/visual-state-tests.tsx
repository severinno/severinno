/**
 * visual-state-tests.tsx
 *
 * Shared helper for the "Estados visuais" describe block used by both
 * GistReindexButton and GistDegradationPanel tests.
 *
 * The 4 visual states (initial, reindexing, success, refetching) are
 * identical in logic but differ in how the component is rendered:
 *
 *   Button (standalone) →  renderButton()
 *   Panel (parent)      →  render(<Panel ... />) + expand collapsible
 *
 * Usage:
 *
 *   import { describeVisualStates, type VisualStateDeps } from "./visual-state-tests"
 *   import { clickExecuteReindex } from "./mocks"
 *
 *   describeVisualStates(
 *     (overrides) => render(<MyComponent {...DEFAULT_PROPS} {...overrides} />),
 *     { setMockFetchResponse, clickExecuteReindex },
 *     { panelContext: true },   // ← only when the button is nested inside a panel
 *   )
 */

import { describe, it, expect } from "vitest"
// IMPORTANT: use the act-wrapped fireEvent from test-utils, NOT the raw RTL
// one. With custom-render (project React via createRoot + flushSync), RTL's
// internal act() cannot flush the project's state updates synchronously —
// sync assertions right after a click would see stale DOM.
import { screen, fireEvent } from "@/__tests__/test-utils"

// ===========================================================================
// Types
// ===========================================================================

/** Dependencies injected by each test file. */
export interface VisualStateDeps {
  /** Override the default mock fetch with per-test behavior (e.g. never-resolve). */
  setMockFetchResponse: (fn: () => Promise<unknown>) => void
  /** Shared helper: clicks "Executar REINDEX" → confirm → wait for result. */
  clickExecuteReindex: () => Promise<void>
}

/** Optional config. */
export interface VisualStateOptions {
  /**
   * When true, the component being tested is a panel that wraps the REINDEX
   * button inside a Collapsible.  States 2–4 will first expand the collapsible
   * by clicking "Ver detalhes do índice" before interacting with the button.
   */
  panelContext?: boolean
}

// ===========================================================================
// Shared visual states describe block
// ===========================================================================

/**
 * Registers the 4 "Estados visuais" tests using the provided render function
 * and dependencies.  Call this inside a `describe` (or at the top level of a
 * `describe` block) in your test file.
 *
 * @param render    Function that renders the component under test with optional
 *                  prop overrides.
 * @param deps      Injected dependencies (mock fetch setter, click helper).
 * @param options   Optional configuration (panel context flag).
 */
export function describeVisualStates(
  render: (overrides?: Record<string, unknown>) => void,
  deps: VisualStateDeps,
  options?: VisualStateOptions,
): void {
  const { setMockFetchResponse, clickExecuteReindex } = deps
  const isPanel = options?.panelContext ?? false

  describe("Estados visuais", () => {
    // ── 1. Initial ──────────────────────────────────────────────────

    it("1. estado inicial: mostra botão 'Executar REINDEX' sem spinner nem resultado", () => {
      render()

      // Botão principal com texto inicial
      const btn = screen.getByText("Executar REINDEX")
      expect(btn).toBeInTheDocument()
      expect(btn).not.toBeDisabled()

      // Nenhum spinner de reindexação visível
      expect(screen.queryByText("Reindexando índices…")).not.toBeInTheDocument()
      expect(screen.queryByText("Reindexando…")).not.toBeInTheDocument()

      // Nenhum resultado visível
      expect(screen.queryByText("sucesso")).not.toBeInTheDocument()

      // Nenhum indicador de refetch
      expect(screen.queryByText("Atualizando métricas…")).not.toBeInTheDocument()
    })

    // ── 2. Reindexando ──────────────────────────────────────────────

    it("2. reindexando: botão muda texto para 'Reindexando…' e mostra spinner + 'Reindexando índices…'", async () => {
      // Fetch nunca resolve para manter estado de loading
      setMockFetchResponse(() => new Promise(() => {}))

      render()

      // Em panelContext, expandir collapsible antes de interagir com o botão
      if (isPanel) {
        fireEvent.click(screen.getByText("Ver detalhes do índice"))
      }

      // Clicar no botão do REINDEX → abre AlertDialog → clica em confirmar
      fireEvent.click(screen.getByText("Executar REINDEX"))
      fireEvent.click(screen.getByTestId("alert-dialog-action"))

      // Botão principal muda texto
      expect(screen.getByText("Reindexando…")).toBeInTheDocument()
      expect(screen.queryByText("Executar REINDEX")).not.toBeInTheDocument()

      // Spinner RefreshCw com animate-spin aparece no indicador de "Reindexando índices…"
      expect(screen.getByText("Reindexando índices…")).toBeInTheDocument()

      // O ícone RefreshCw está presente com classe animate-spin
      const spinners = screen.getAllByTestId("lucide-icon")
      const animatedSpinner = spinners.find((el) =>
        el.getAttribute("data-class")?.includes("animate-spin"),
      )
      expect(animatedSpinner).toBeInTheDocument()

      // Nenhum resultado ainda
      expect(screen.queryByText("sucesso")).not.toBeInTheDocument()

      // Botão de confirmação também muda texto
      expect(screen.getByText("Executando…")).toBeInTheDocument()
      expect(screen.queryByText("Sim, executar REINDEX")).not.toBeInTheDocument()
    })

    // ── 3. Sucesso ──────────────────────────────────────────────────

    it("3. sucesso: mostra resultado com 'sucesso', sem spinner", async () => {
      render()

      // Em panelContext, expandir collapsible antes de interagir
      if (isPanel) {
        fireEvent.click(screen.getByText("Ver detalhes do índice"))
      }

      await clickExecuteReindex()

      // Resultado de sucesso aparece
      const resultEl = screen.getByText(/sucesso/)
      expect(resultEl).toBeInTheDocument()
      expect(resultEl.textContent).toContain("sucesso")
      expect(resultEl.textContent).toContain("2122ms")
      expect(resultEl.textContent).toContain("idx_user_location_gist")

      // Botão voltou ao texto inicial
      expect(screen.getByText("Executar REINDEX")).toBeInTheDocument()

      // Nenhum spinner de loading
      expect(screen.queryByText("Reindexando índices…")).not.toBeInTheDocument()
      expect(screen.queryByText("Reindexando…")).not.toBeInTheDocument()

      // Nenhum indicador de refetch
      expect(screen.queryByText("Atualizando métricas…")).not.toBeInTheDocument()
    })

    // ── 4. Refetching ────────────────────────────────────────────────

    it("4. isRefetching: mostra 'Atualizando métricas…' com spinner, sem modo reindexing", () => {
      render({ isRefetching: true })

      // Em panelContext, expandir collapsible para tornar o botão visível
      if (isPanel) {
        fireEvent.click(screen.getByText("Ver detalhes do índice"))
      }

      // Indicador de refetch visível
      expect(screen.getByText("Atualizando métricas…")).toBeInTheDocument()

      // Ícone com animate-spin presente (RefreshCw)
      const icons = screen.getAllByTestId("lucide-icon")
      const animatedIcon = icons.find((el) =>
        el.getAttribute("data-class")?.includes("animate-spin"),
      )
      expect(animatedIcon).toBeInTheDocument()

      // Botão principal ainda mostra "Executar REINDEX" (não está reindexando)
      expect(screen.getByText("Executar REINDEX")).toBeInTheDocument()
      expect(screen.queryByText("Reindexando…")).not.toBeInTheDocument()
      expect(screen.queryByText("Reindexando índices…")).not.toBeInTheDocument()

      // Nenhum resultado
      expect(screen.queryByText("sucesso")).not.toBeInTheDocument()
    })
  })
}
