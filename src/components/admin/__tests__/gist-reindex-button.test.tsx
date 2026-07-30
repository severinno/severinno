/**
 * gist-reindex-button.test.tsx
 *
 * Tests for the standalone GistReindexButton component.
 *
 * Mocks:
 *   - fetch (global) — three modes: success, failure, network-error
 *   - lucide-react — simple icon placeholders
 *   - AlertDialog — div-based stub for jsdom compatibility
 *   - sonner (toast) — prevent side effects during tests
 *
 * Test coverage:
 *   - Renderização: botão "Executar REINDEX" aparece
 *   - AlertDialog: abre ao clicar e exibe título + descrição
 *   - onReindexSuccess: chamado APENAS no sucesso
 *   - onReindexSuccess: NÃO chamado na falha ou erro de rede
 *   - isRefetching: mostra "Atualizando métricas…"
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import React from "react"
import { render, screen, fireEvent, waitFor, cleanup } from "@/__tests__/test-utils"
import { toast } from "sonner"
import { GistReindexButton } from "../gist-reindex-button"

// ===========================================================================
// Mock global fetch — controlled per-test via mockFetchResponse
// NOTE: vi.stubGlobal is called INSIDE beforeEach so that each test has a
// fresh mock. vi.unstubAllGlobals in afterEach removes the previous mock.
// IMPORTANT: do NOT call vi.stubGlobal at module level — it would be removed
// by the first test's afterEach (vi.unstubAllGlobals).
// ===========================================================================

let mockFetchResponse: () => Promise<Response>

// ===========================================================================
// Mock lucide-react — simple icon placeholders
// ===========================================================================

vi.mock("lucide-react", () => {
  const Icon = (p: { className?: string }) => (
    <span data-testid="lucide-icon" data-class={p.className} />
  )
  Icon.displayName = "LucideIcon"
  return { Database: Icon, RefreshCw: Icon, CheckCircle2: Icon, AlertTriangle: Icon }
})

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
  AlertDialogCancel: ({ children }: any) => (
    <button type="button" data-testid="alert-dialog-cancel">
      {children}
    </button>
  ),
}))

// ===========================================================================
// Mock sonner toast — silent during tests
// ===========================================================================

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

// ===========================================================================
// Helpers
// ===========================================================================

/** Click through the REINDEX flow: "Executar REINDEX" → confirm button.
 *  Waits for the result indicator (sucesso/Falha) to appear before returning. */
async function clickExecuteReindex() {
  fireEvent.click(screen.getByText("Executar REINDEX"))
  fireEvent.click(screen.getByTestId("alert-dialog-action"))
  await screen.findByText(/sucesso|Falha|Erro/, undefined, { timeout: 2000 })
}

// ===========================================================================
// Tests
// ===========================================================================

describe("GistReindexButton", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Install fetch mock fresh for each test (afterEach removes it via
    // vi.unstubAllGlobals, so we must re-install here).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => mockFetchResponse()),
    )

    // Default: success response
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
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── Renderização ─────────────────────────────────────────────────

  it("renders the 'Executar REINDEX' button", () => {
    render(<GistReindexButton />)
    expect(screen.getByText("Executar REINDEX")).toBeInTheDocument()
  })

  it("renders with Database icon", () => {
    render(<GistReindexButton />)
    const icons = screen.getAllByTestId("lucide-icon")
    expect(icons.length).toBeGreaterThanOrEqual(1)
  })

  // ── AlertDialog ──────────────────────────────────────────────────

  it("opens AlertDialog when 'Executar REINDEX' is clicked", () => {
    render(<GistReindexButton />)

    expect(screen.getByTestId("alert-dialog")).toBeInTheDocument()
    expect(screen.getByTestId("alert-dialog").getAttribute("data-open")).toBe("false")

    fireEvent.click(screen.getByText("Executar REINDEX"))

    expect(screen.getByTestId("alert-dialog-open")).toBeInTheDocument()
  })

  it("shows REINDEX confirmation title and index list in the dialog", () => {
    render(<GistReindexButton />)

    fireEvent.click(screen.getByText("Executar REINDEX"))

    // O título do AlertDialog é o único lugar com "⚠️ Executar REINDEX"
    // (o botão trigger tem só "Executar REINDEX" sem emoji, mas usamos
    // getAllByText + check para evitar ambigüidade entre trigger e título)
    const reindexTexts = screen.getAllByText(/Executar REINDEX/)
    expect(reindexTexts.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/idx_user_location_gist/)).toBeInTheDocument()
    expect(screen.getByText(/idx_booking_location_gist/)).toBeInTheDocument()
    expect(screen.getByText(/idx_quoterequest_location_gist/)).toBeInTheDocument()
    expect(screen.getByText(/REINDEX CONCURRENTLY/)).toBeInTheDocument()
  })

  it("has 'Cancelar' and 'Sim, executar REINDEX' buttons in dialog", () => {
    render(<GistReindexButton />)

    fireEvent.click(screen.getByText("Executar REINDEX"))

    expect(screen.getByText("Cancelar")).toBeInTheDocument()
    expect(screen.getByText("Sim, executar REINDEX")).toBeInTheDocument()
  })

  // ── Success flow ─────────────────────────────────────────────────

  it("shows success result after successful REINDEX", async () => {
    render(<GistReindexButton />)
    await clickExecuteReindex()

    const resultEl = screen.getByText(/sucesso/)
    expect(resultEl).toBeInTheDocument()
    expect(resultEl.textContent).toContain("2122ms")
  })

  it("calls onReindexSuccess on successful REINDEX", async () => {
    const onSuccess = vi.fn()
    render(<GistReindexButton onReindexSuccess={onSuccess} />)
    await clickExecuteReindex()

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
  })

  it("shows toast success on successful REINDEX", async () => {
    render(<GistReindexButton />)
    await clickExecuteReindex()

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Índices GiST reindexados com sucesso")
    })
  })

  // ── Failure flow ─────────────────────────────────────────────────

  it("shows failure result when API returns success:false", async () => {
    mockFetchResponse = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: false,
            message: "deadlock detected",
            indexes: [],
            totalDurationMs: 0,
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      )

    render(<GistReindexButton />)
    await clickExecuteReindex()

    expect(screen.getByText(/Falha/)).toBeInTheDocument()
    expect(screen.getByText(/deadlock detected/)).toBeInTheDocument()
  })

  it("does NOT call onReindexSuccess when API returns success:false", async () => {
    mockFetchResponse = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ success: false, message: "Erro", indexes: [], totalDurationMs: 0 }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      )

    const onSuccess = vi.fn()
    render(<GistReindexButton onReindexSuccess={onSuccess} />)
    await clickExecuteReindex()

    await waitFor(() => {
      expect(screen.getByText(/Falha/)).toBeInTheDocument()
    })

    expect(onSuccess).not.toHaveBeenCalled()
  })

  it("shows error toast on REINDEX failure", async () => {
    mockFetchResponse = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ success: false, message: "Erro", indexes: [], totalDurationMs: 0 }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      )

    render(<GistReindexButton />)
    await clickExecuteReindex()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Falha ao reindexar índices GiST")
    })
  })

  // ── Network error flow ───────────────────────────────────────────

  it("shows connection error when fetch throws", async () => {
    mockFetchResponse = () => Promise.reject(new Error("NetworkError: Failed to fetch"))

    render(<GistReindexButton />)
    await clickExecuteReindex()

    expect(screen.getByText(/NetworkError/)).toBeInTheDocument()
  })

  it("does NOT call onReindexSuccess on network error", async () => {
    mockFetchResponse = () => Promise.reject(new Error("Network error"))

    const onSuccess = vi.fn()
    render(<GistReindexButton onReindexSuccess={onSuccess} />)
    await clickExecuteReindex()

    expect(onSuccess).not.toHaveBeenCalled()
  })

  // ── isRefetching prop ────────────────────────────────────────────

  it("shows 'Atualizando métricas…' when isRefetching is true", () => {
    render(<GistReindexButton isRefetching={true} />)

    expect(screen.getByText("Atualizando métricas…")).toBeInTheDocument()
  })

  it("does NOT show 'Atualizando métricas…' when isRefetching is false", () => {
    render(<GistReindexButton isRefetching={false} />)

    expect(screen.queryByText("Atualizando métricas…")).not.toBeInTheDocument()
  })

  // ── State transitions ────────────────────────────────────────────

  it("disables the button while reindexing", async () => {
    // Slow fetch to observe loading state
    mockFetchResponse = () =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve(
              new Response(
                JSON.stringify({
                  success: true,
                  message: "reindexado com sucesso",
                  indexes: [],
                  totalDurationMs: 0,
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            ),
          100,
        ),
      )

    render(<GistReindexButton />)
    fireEvent.click(screen.getByText("Executar REINDEX"))
    fireEvent.click(screen.getByTestId("alert-dialog-action"))

    // Button shows "Executando…" while reindexing and is disabled
    expect(screen.getByTestId("alert-dialog-action")).toBeDisabled()
    expect(screen.getByText("Executando…")).toBeInTheDocument()

    // Wait for completion (message contains "sucesso")
    await screen.findByText(/sucesso/, undefined, { timeout: 2000 })
  })

  // ── Estados visuais (4 estados do componente) ────────────────────

  describe("Estados visuais", () => {
    it("1. estado inicial: mostra botão 'Executar REINDEX' sem spinner nem resultado", () => {
      render(<GistReindexButton />)

      // Botão principal com texto inicial
      const btn = screen.getByText("Executar REINDEX")
      expect(btn).toBeInTheDocument()
      expect(btn).not.toBeDisabled()

      // Nenhum spinner de reindexação visível
      expect(screen.queryByText("Reindexando índices…")).not.toBeInTheDocument()
      expect(screen.queryByText("Reindexando…")).not.toBeInTheDocument()

      // Nenhum resultado visível
      // Nenhum resultado visível (IndicadorDeAtualizacao em null)
      expect(screen.queryByText("sucesso")).not.toBeInTheDocument()

      // Nenhum indicador de refetch
      expect(screen.queryByText("Atualizando métricas…")).not.toBeInTheDocument()
    })

    it("2. reindexando: botão muda texto para 'Reindexando…' e mostra spinner + 'Reindexando índices…'", async () => {
      // Slow fetch to stay in loading state
      mockFetchResponse = () => new Promise(() => {}) // never resolves

      render(<GistReindexButton />)
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

    it("3. sucesso: mostra resultado com 'sucesso', sem spinner", async () => {
      render(<GistReindexButton />)
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

      // Nenhum indicador de refetch (não passamos isRefetching)
      expect(screen.queryByText("Atualizando métricas…")).not.toBeInTheDocument()
    })

    it("4. isRefetching: mostra 'Atualizando métricas…' com spinner, sem modo reindexing", () => {
      render(<GistReindexButton isRefetching={true} />)

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
})
