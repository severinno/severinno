/**
 * indicador-de-atualizacao-snapshot.test.tsx
 *
 * Snapshot tests for the IndicadorDeAtualizacao component covering all 5
 * visual states:
 *   1. null        — spacer oculto (opacity-0, aria-hidden, "—") — sempre no
 *                    DOM para evitar layout shift
 *   2. refetching  — spinner (RefreshCw animate-spin) + "Atualizando…"
 *   3. reindexing  — spinner (RefreshCw animate-spin) + "Reindexando índices…"
 *   4. success     — check (CheckCircle2) + mensagem verde (assertive)
 *   5. error       — alerta (AlertTriangle) + mensagem vermelha (assertive)
 *
 * Cada estado é um teste separado. Render once → snapshot no mesmo instance.
 * Sem double-render pattern. Os assertions de classe/aria (opacity-0,
 * aria-live, text-emerald-600, etc.) já são cobertos pelo teste de interação
 * indicador-de-atualizacao.test.tsx — aqui capturamos a saída visual.
 *
 * Mocks (shared via async vi.mock from ./mocks):
 *   lucide-react — MockIcon placeholder (RefreshCw / CheckCircle2 /
 *   AlertTriangle)
 */

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup } from "@/__tests__/test-utils"
import { IndicadorDeAtualizacao, DEFAULT_LABELS } from "../indicador-de-atualizacao"

// ===========================================================================
// Shared mock (lucide-react) — imported via async vi.mock factory to work
// around vitest's hoisting mechanism (same pattern as the other snapshot
// tests).
// ===========================================================================

vi.mock("lucide-react", async () => {
  const { MockIcon } = await import("./mocks")
  return { RefreshCw: MockIcon, CheckCircle2: MockIcon, AlertTriangle: MockIcon }
})

// ===========================================================================
// Tests
// ===========================================================================

describe("IndicadorDeAtualizacao — snapshot dos 5 estados visuais", () => {
  afterEach(() => {
    try {
      cleanup()
    } catch {
      // NotFoundError during cleanup is a known React 19 + jsdom +
      // custom-render artifact. Harmless — tests still pass.
    }
  })

  // ── 1. null ────────────────────────────────────────────────────────

  it("1. null — spacer oculto (opacity-0, aria-hidden, '—')", () => {
    const { asFragment } = render(<IndicadorDeAtualizacao status={null} />)

    // Sanity: spacer invisível presente (mantém altura sem layout shift)
    expect(screen.getByText("—")).toBeInTheDocument()

    expect(asFragment()).toMatchSnapshot("indicador-null")
  })

  // ── 2. refetching ──────────────────────────────────────────────────

  it("2. refetching — spinner + 'Atualizando…'", () => {
    const { asFragment } = render(<IndicadorDeAtualizacao status="refetching" />)

    // Sanity: label de refetch visível
    expect(screen.getByText(DEFAULT_LABELS.refetching)).toBeInTheDocument()

    expect(asFragment()).toMatchSnapshot("indicador-refetching")
  })

  // ── 3. reindexing ──────────────────────────────────────────────────

  it("3. reindexing — spinner + 'Reindexando índices…'", () => {
    const { asFragment } = render(<IndicadorDeAtualizacao status="reindexing" />)

    // Sanity: label de reindex visível
    expect(screen.getByText(DEFAULT_LABELS.reindexing)).toBeInTheDocument()

    expect(asFragment()).toMatchSnapshot("indicador-reindexing")
  })

  // ── 4. success ─────────────────────────────────────────────────────

  it("4. success — check + mensagem verde", () => {
    const { asFragment } = render(<IndicadorDeAtualizacao status="success" />)

    // Sanity: mensagem padrão de sucesso visível
    expect(screen.getByText(DEFAULT_LABELS.success)).toBeInTheDocument()

    expect(asFragment()).toMatchSnapshot("indicador-success")
  })

  // ── 5. error ───────────────────────────────────────────────────────

  it("5. error — alerta + mensagem vermelha", () => {
    const { asFragment } = render(<IndicadorDeAtualizacao status="error" />)

    // Sanity: mensagem padrão de erro visível
    expect(screen.getByText(DEFAULT_LABELS.error)).toBeInTheDocument()

    expect(asFragment()).toMatchSnapshot("indicador-error")
  })
})
