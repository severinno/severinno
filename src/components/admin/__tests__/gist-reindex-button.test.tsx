/**
 * gist-reindex-button.test.tsx
 *
 * Tests for the standalone GistReindexButton component.
 *
 * Mocks (shared in ./mocks.tsx):
 *   - lucide-react — MockIcon placeholder
 *   - AlertDialog — div-based stub
 *   - sonner toast — silent mock
 *
 * Mocks (local):
 *   - fetch (global) — controlled per-test via FetchResponseFn
 *
 * Test coverage:
 *   - Renderização: botão "Executar REINDEX" aparece
 *   - AlertDialog: abre ao clicar e exibe título + descrição
 *   - onReindexSuccess: chamado APENAS no sucesso
 *   - onReindexSuccess: NÃO chamado na falha ou erro de rede
 *   - isRefetching: mostra "Atualizando métricas…"
 *   - Estados visuais: inicial, reindexando, sucesso, refetching
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import React from "react"
import { render, screen, fireEvent, waitFor, cleanup } from "@/__tests__/test-utils"
import { toast } from "sonner"
import { GistReindexButton } from "../gist-reindex-button"

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
// Mock global fetch — controlled per-test via mockFetchResponse
// NOTE: vi.stubGlobal is called INSIDE beforeEach so that each test has a
// fresh mock. vi.unstubAllGlobals in afterEach removes the previous mock.
// ============================================================================

import type { FetchResponseFn } from "./mocks"
import {
  buildReindexSuccessResponse,
  buildReindexFailureResponse,
  buildReindexSlowResponse,
  clickExecuteReindex,
} from "./mocks"

let mockFetchResponse: FetchResponseFn

// ===========================================================================
// Helpers
// ===========================================================================

/** Render the component with the given props. */
function renderButton(props: Partial<React.ComponentProps<typeof GistReindexButton>> = {}) {
  return render(<GistReindexButton {...props} />)
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
    mockFetchResponse = () => Promise.resolve(buildReindexSuccessResponse())
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  // ── Renderização ─────────────────────────────────────────────────

  it("renders the 'Executar REINDEX' button", () => {
    renderButton()
    expect(screen.getByText("Executar REINDEX")).toBeInTheDocument()
  })

  it("renders with Database icon", () => {
    renderButton()
    const icons = screen.getAllByTestId("lucide-icon")
    expect(icons.length).toBeGreaterThanOrEqual(1)
  })

  // ── AlertDialog ──────────────────────────────────────────────────

  it("opens AlertDialog when 'Executar REINDEX' is clicked", () => {
    renderButton()

    expect(screen.getByTestId("alert-dialog")).toBeInTheDocument()
    expect(screen.getByTestId("alert-dialog").getAttribute("data-open")).toBe("false")

    fireEvent.click(screen.getByText("Executar REINDEX"))

    expect(screen.getByTestId("alert-dialog-open")).toBeInTheDocument()
  })

  it("shows REINDEX confirmation title and index list in the dialog", () => {
    renderButton()

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
    renderButton()

    fireEvent.click(screen.getByText("Executar REINDEX"))

    expect(screen.getByText("Cancelar")).toBeInTheDocument()
    expect(screen.getByText("Sim, executar REINDEX")).toBeInTheDocument()
  })

  // ── Success flow ─────────────────────────────────────────────────

  it("shows success result after successful REINDEX", async () => {
    renderButton()
    await clickExecuteReindex()

    const resultEl = screen.getByText(/sucesso/)
    expect(resultEl).toBeInTheDocument()
    expect(resultEl.textContent).toContain("2122ms")
  })

  it("calls onReindexSuccess on successful REINDEX", async () => {
    const onSuccess = vi.fn()
    renderButton({ onReindexSuccess: onSuccess })
    await clickExecuteReindex()

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
  })

  it("shows toast success on successful REINDEX", async () => {
    renderButton()
    await clickExecuteReindex()

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Índices GiST reindexados com sucesso")
    })
  })

  // ── Failure flow ─────────────────────────────────────────────────

  it("shows failure result when API returns success:false", async () => {
    mockFetchResponse = () => Promise.resolve(buildReindexFailureResponse("deadlock detected"))

    renderButton()
    await clickExecuteReindex()

    expect(screen.getByText(/Falha/)).toBeInTheDocument()
    expect(screen.getByText(/deadlock detected/)).toBeInTheDocument()
  })

  it("does NOT call onReindexSuccess when API returns success:false", async () => {
    mockFetchResponse = () => Promise.resolve(buildReindexFailureResponse())

    const onSuccess = vi.fn()
    renderButton({ onReindexSuccess: onSuccess })
    await clickExecuteReindex()

    await waitFor(() => {
      expect(screen.getByText(/Falha/)).toBeInTheDocument()
    })

    expect(onSuccess).not.toHaveBeenCalled()
  })

  it("shows error toast on REINDEX failure", async () => {
    mockFetchResponse = () => Promise.resolve(buildReindexFailureResponse())

    renderButton()
    await clickExecuteReindex()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Falha ao reindexar índices GiST")
    })
  })

  // ── Network error flow ───────────────────────────────────────────

  it("shows connection error when fetch throws", async () => {
    mockFetchResponse = () => Promise.reject(new Error("NetworkError: Failed to fetch"))

    renderButton()
    await clickExecuteReindex()

    expect(screen.getByText(/NetworkError/)).toBeInTheDocument()
  })

  it("does NOT call onReindexSuccess on network error", async () => {
    mockFetchResponse = () => Promise.reject(new Error("Network error"))

    const onSuccess = vi.fn()
    renderButton({ onReindexSuccess: onSuccess })
    await clickExecuteReindex()

    expect(onSuccess).not.toHaveBeenCalled()
  })

  // ── isRefetching prop ────────────────────────────────────────────

  it("shows 'Atualizando métricas…' when isRefetching is true", () => {
    renderButton({ isRefetching: true })

    expect(screen.getByText("Atualizando métricas…")).toBeInTheDocument()
  })

  it("does NOT show 'Atualizando métricas…' when isRefetching is false", () => {
    renderButton({ isRefetching: false })

    expect(screen.queryByText("Atualizando métricas…")).not.toBeInTheDocument()
  })

  // ── State transitions ────────────────────────────────────────────

  it("disables the button while reindexing", async () => {
    mockFetchResponse = () => buildReindexSlowResponse(100)

    renderButton()
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
      renderButton()

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

    it("2. reindexando: botão muda texto para 'Reindexando…' e mostra spinner + 'Reindexando índices…'", async () => {
      // Slow fetch to stay in loading state
      mockFetchResponse = () => new Promise(() => {}) // never resolves

      renderButton()
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
      renderButton()
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
      renderButton({ isRefetching: true })

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
