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
import { render, screen, fireEvent, waitFor, findByText, cleanup } from "@/__tests__/test-utils"
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

import type { FetchResponseFn } from "./index"
import {
  buildReindexSuccessResponse,
  buildReindexFailureResponse,
  buildReindexSlowResponse,
  clickExecuteReindex,
  DEFAULT_GIST_REINDEX_PROPS,
} from "./index"

// ===========================================================================
// Shared visual state tests
// ===========================================================================

import { describeVisualStates } from "./visual-state-tests"

let mockFetchResponse: FetchResponseFn

// ===========================================================================
// Helpers
// ===========================================================================

/** Render the component with the given props, merged over DEFAULT_GIST_REINDEX_PROPS. */
function renderButton(
  props: Partial<React.ComponentProps<typeof GistReindexButton>> = DEFAULT_GIST_REINDEX_PROPS,
) {
  return render(<GistReindexButton {...DEFAULT_GIST_REINDEX_PROPS} {...props} />)
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

  it("shows 'erro desconhecido' when API failure has no message", async () => {
    // Response sem campo `message` → fallback "erro desconhecido" (branch ?? da linha 78)
    mockFetchResponse = () =>
      Promise.resolve(
        new Response(JSON.stringify({ success: false, indexes: [], totalDurationMs: 0 }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      )

    renderButton()
    await clickExecuteReindex()

    expect(screen.getByText(/erro desconhecido/)).toBeInTheDocument()
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

  it("stringifies non-Error rejections in the connection error message", async () => {
    // Rejeição com valor que não é Error → ramo String(err) da linha 82
    mockFetchResponse = () => Promise.reject("NetworkError: boom")

    renderButton()
    await clickExecuteReindex()

    expect(screen.getByText(/Erro de conexão/)).toBeInTheDocument()
    expect(screen.getByText(/NetworkError: boom/)).toBeInTheDocument()
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
    await findByText(/sucesso/, undefined, { timeout: 2000 })
  })

  // ── Estados visuais (4 estados do componente) ────────────────────
  // Extraídos para helper compartilhado — usado também em
  // gist-degradation-panel.test.tsx para evitar duplicação.

  describeVisualStates((overrides) => renderButton(overrides), {
    setMockFetchResponse: (fn) => {
      mockFetchResponse = fn as FetchResponseFn
    },
    clickExecuteReindex,
  })
})
