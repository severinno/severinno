/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * indicador-de-atualizacao.test.tsx
 *
 * Unit tests for the IndicadorDeAtualizacao component.
 *
 * Covers:
 *   - null state (oculto, aria-hidden, spacer text)
 *   - refetching (spinner + "Atualizando…")
 *   - reindexing (spinner + "Reindexando índices…")
 *   - success (check + verde + aria-live="assertive")
 *   - error (alerta + vermelho + aria-live="assertive")
 *   - custom message (substitui label padrão)
 *   - className opcional (classes extras no container)
 *   - Transição null → refetching (rerender)
 */

import { describe, it, expect, afterEach, vi } from "vitest"
import React from "react"
import { render, screen, cleanup } from "@/__tests__/test-utils"
import { IndicadorDeAtualizacao } from "../indicador-de-atualizacao"
import type { IndicadorDeAtualizacaoProps } from "../indicador-de-atualizacao"

// ===========================================================================
// Mock lucide-react — provides placeholder icons for RefreshCw, CheckCircle2,
// and AlertTriangle, which the component renders in each state.
// ===========================================================================

vi.mock("lucide-react", async () => {
  const { MockIcon } = await import("./mocks")
  return { RefreshCw: MockIcon, CheckCircle2: MockIcon, AlertTriangle: MockIcon }
})

// ===========================================================================
// Default labels (mirror the component's internal constants for assertions)
// ===========================================================================

const LABELS: Record<string, string> = {
  refetching: "Atualizando…",
  reindexing: "Reindexando índices…",
  success: "Operação concluída com sucesso",
  error: "Erro na operação",
}

// ===========================================================================
// Tests
// ===========================================================================

describe("IndicadorDeAtualizacao", () => {
  afterEach(() => {
    try {
      cleanup()
    } catch {
      // Container already cleaned up
    }
  })

  // ── Helpers ─────────────────────────────────────────────────────────────

  function renderIndicator(props: Partial<IndicadorDeAtualizacaoProps> = {}) {
    return render(<IndicadorDeAtualizacao status={null} {...props} />)
  }

  /** Get the outer container span (parent of the text node). */
  function getContainer(text: string): HTMLElement {
    return screen.getByText(text).parentElement as HTMLElement
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Estado: null
  // ═══════════════════════════════════════════════════════════════════════

  it("renders null state without breaking (aria-hidden, opacity-0, spacer)", () => {
    renderIndicator({ status: null })

    const container = getContainer("—")
    expect(container).toBeInTheDocument()
    expect(container).toHaveAttribute("aria-hidden", "true")
    expect(container).toHaveClass("opacity-0")
    expect(container).toHaveClass("pointer-events-none")
  })

  it("null state does not have aria-live attribute", () => {
    renderIndicator({ status: null })

    const container = getContainer("—")
    expect(container).not.toHaveAttribute("aria-live")
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Estado: refetching
  // ═══════════════════════════════════════════════════════════════════════

  it("renders refetching state with spinner and 'Atualizando…' text", () => {
    renderIndicator({ status: "refetching" })

    expect(screen.getByText(LABELS.refetching)).toBeInTheDocument()
    const container = getContainer(LABELS.refetching)
    expect(container).toHaveAttribute("aria-live", "polite")
    expect(container).toHaveClass("text-muted-foreground")
    expect(container).toHaveClass("opacity-100")
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Estado: reindexing
  // ═══════════════════════════════════════════════════════════════════════

  it("renders reindexing state with 'Reindexando índices…' text", () => {
    renderIndicator({ status: "reindexing" })

    expect(screen.getByText(LABELS.reindexing)).toBeInTheDocument()
    const container = getContainer(LABELS.reindexing)
    expect(container).toHaveAttribute("aria-live", "polite")
    expect(container).toHaveClass("text-muted-foreground")
    expect(container).toHaveClass("opacity-100")
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Estado: success
  // ═══════════════════════════════════════════════════════════════════════

  it("renders success state with check icon and green text", () => {
    renderIndicator({ status: "success" })

    expect(screen.getByText(LABELS.success)).toBeInTheDocument()
    const container = getContainer(LABELS.success)
    expect(container).toHaveAttribute("aria-live", "assertive")
    expect(container).toHaveClass("text-emerald-600")
    expect(container).toHaveClass("opacity-100")
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Estado: error
  // ═══════════════════════════════════════════════════════════════════════

  it("renders error state with alert icon and red text", () => {
    renderIndicator({ status: "error" })

    expect(screen.getByText(LABELS.error)).toBeInTheDocument()
    const container = getContainer(LABELS.error)
    expect(container).toHaveAttribute("aria-live", "assertive")
    expect(container).toHaveClass("text-red-600")
    expect(container).toHaveClass("opacity-100")
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Custom message
  // ═══════════════════════════════════════════════════════════════════════

  it("renders custom message for success state instead of default", () => {
    renderIndicator({ status: "success", message: "3/3 índices OK" })

    expect(screen.getByText("3/3 índices OK")).toBeInTheDocument()
    expect(screen.queryByText(LABELS.success)).not.toBeInTheDocument()
  })

  it("renders custom message for error state instead of default", () => {
    renderIndicator({ status: "error", message: "Falha no servidor" })

    expect(screen.getByText("Falha no servidor")).toBeInTheDocument()
    expect(screen.queryByText(LABELS.error)).not.toBeInTheDocument()
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Optional className
  // ═══════════════════════════════════════════════════════════════════════

  it("applies optional className in null state", () => {
    renderIndicator({ status: null, className: "ml-2" })

    const container = getContainer("—")
    expect(container).toHaveClass("ml-2")
    // Default classes are still present
    expect(container).toHaveClass("opacity-0")
  })

  it("applies optional className in refetching state", () => {
    renderIndicator({ status: "refetching", className: "font-bold" })

    const container = getContainer(LABELS.refetching)
    expect(container).toHaveClass("font-bold")
    expect(container).toHaveClass("opacity-100")
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Transition: null → refetching
  // ═══════════════════════════════════════════════════════════════════════

  it("transitions from null to refetching (text changes from '—' to 'Atualizando…')", () => {
    const { rerender } = render(<IndicadorDeAtualizacao status={null} />)

    // Null state: spacer visible
    expect(screen.getByText("—")).toBeInTheDocument()
    expect(screen.queryByText(LABELS.refetching)).not.toBeInTheDocument()

    // Transition to refetching
    rerender(<IndicadorDeAtualizacao status="refetching" />)

    // Refetching state: label visible, spacer gone
    expect(screen.getByText(LABELS.refetching)).toBeInTheDocument()
    expect(screen.queryByText("—")).not.toBeInTheDocument()
  })

  it("transitions from refetching to success (text changes from 'Atualizando…' to success message)", () => {
    const { rerender } = render(<IndicadorDeAtualizacao status="refetching" />)

    expect(screen.getByText(LABELS.refetching)).toBeInTheDocument()

    rerender(<IndicadorDeAtualizacao status="success" />)

    expect(screen.getByText(LABELS.success)).toBeInTheDocument()
    expect(screen.queryByText(LABELS.refetching)).not.toBeInTheDocument()
  })

  it("transitions from refetching to null (loading → idle)", () => {
    const { rerender } = render(<IndicadorDeAtualizacao status="refetching" />)

    expect(screen.getByText(LABELS.refetching)).toBeInTheDocument()

    rerender(<IndicadorDeAtualizacao status={null} />)

    expect(screen.getByText("—")).toBeInTheDocument()
    expect(screen.queryByText(LABELS.refetching)).not.toBeInTheDocument()
  })
})
