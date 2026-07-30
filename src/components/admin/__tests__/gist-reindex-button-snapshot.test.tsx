/**
 * gist-reindex-button-snapshot.test.tsx
 *
 * Snapshot tests for the GistReindexButton component covering the 4
 * visual states defined in the component:
 *   1. Initial     — idle render with "Executar REINDEX" button, no indicator
 *   2. Reindexing  — loading: "Reindexando…", "Reindexando índices…", spinner
 *   3. Success     — green result after successful REINDEX
 *   4. Refetching  — "Atualizando métricas…" with spinner, button unchanged
 *
 * Each state is a separate test. Render once → interact → snapshot on
 * the same component instance. No double-render pattern.
 *
 * NOTE: The AlertDialog mock renders children unconditionally (only the
 * `data-open` marker is conditional). Snapshot output will include dialog
 * content even when programmatically closed — this is a mock artifact.
 *
 * Mocks (shared via async vi.mock from ./mocks):
 *   lucide-react, AlertDialog, sonner, fetch
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import React from "react"
import { render, screen, fireEvent, cleanup } from "@/__tests__/test-utils"
import { GistReindexButton } from "../gist-reindex-button"

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
// Imports from shared mocks
// ===========================================================================

import type { FetchResponseFn } from "./mocks"
import {
  buildReindexSuccessResponse,
  clickExecuteReindex,
  DEFAULT_GIST_REINDEX_PROPS,
} from "./mocks"

let mockFetchResponse: FetchResponseFn

// ===========================================================================
// Tests
// ===========================================================================

describe("GistReindexButton — snapshot dos 4 estados visuais", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => mockFetchResponse()),
    )
    mockFetchResponse = () => Promise.resolve(buildReindexSuccessResponse())
  })

  afterEach(() => {
    try {
      cleanup()
    } catch {
      // NotFoundError during cleanup is a known React 19 + jsdom +
      // custom-render artifact (state 2 has an unresolved fetch promise
      // that triggers this during unmount). Harmless — tests still pass.
    }
    vi.unstubAllGlobals()
  })

  // ── 1. Initial ────────────────────────────────────────────────────

  it("1. estado inicial — botão 'Executar REINDEX', sem indicador", () => {
    const { asFragment } = render(<GistReindexButton {...DEFAULT_GIST_REINDEX_PROPS} />)

    // Sanity: botão renderizado, sem indicadores
    expect(screen.getByText("Executar REINDEX")).toBeInTheDocument()
    expect(screen.queryByText("Reindexando índices…")).not.toBeInTheDocument()
    expect(screen.queryByText("Atualizando métricas…")).not.toBeInTheDocument()

    expect(asFragment()).toMatchSnapshot("gist-reindex-button-initial")
  })

  // ── 2. Reindexando ────────────────────────────────────────────────

  it("2. reindexando — botão 'Reindexando…', indicador loading com spinner", async () => {
    // Fetch nunca resolve para manter estado de loading
    mockFetchResponse = () => new Promise(() => {})

    const { asFragment } = render(<GistReindexButton {...DEFAULT_GIST_REINDEX_PROPS} />)

    // Abrir AlertDialog e clicar em confirmar → dispara fetch (nunca resolve)
    fireEvent.click(screen.getByText("Executar REINDEX"))
    fireEvent.click(screen.getByTestId("alert-dialog-action"))

    // Sanity: botão alterado, indicador de loading visível
    expect(screen.getByText("Reindexando…")).toBeInTheDocument()
    expect(screen.getByText("Reindexando índices…")).toBeInTheDocument()
    expect(screen.getByText("Executando…")).toBeInTheDocument()
    expect(screen.queryByText("sucesso")).not.toBeInTheDocument()

    expect(asFragment()).toMatchSnapshot("gist-reindex-button-reindexing")
  })

  // ── 3. Sucesso ────────────────────────────────────────────────────

  it("3. sucesso — indicador verde com resultado da API", async () => {
    const { asFragment } = render(<GistReindexButton {...DEFAULT_GIST_REINDEX_PROPS} />)
    await clickExecuteReindex()

    // Sanity: resultado verde, botão voltou ao normal
    expect(screen.getByText(/sucesso/)).toBeInTheDocument()
    expect(screen.getByText(/2122ms/)).toBeInTheDocument()
    expect(screen.getByText("Executar REINDEX")).toBeInTheDocument()

    expect(asFragment()).toMatchSnapshot("gist-reindex-button-success")
  })

  // ── 4. Refetching ─────────────────────────────────────────────────

  it("4. isRefetching — indicador 'Atualizando métricas…' com spinner, botão inalterado", () => {
    const { asFragment } = render(
      <GistReindexButton {...DEFAULT_GIST_REINDEX_PROPS} isRefetching={true} />,
    )

    // Sanity: botão normal + indicador de refetch
    expect(screen.getByText("Executar REINDEX")).toBeInTheDocument()
    expect(screen.getByText("Atualizando métricas…")).toBeInTheDocument()
    expect(screen.queryByText("Reindexando…")).not.toBeInTheDocument()
    expect(screen.queryByText("Reindexando índices…")).not.toBeInTheDocument()

    expect(asFragment()).toMatchSnapshot("gist-reindex-button-refetching")
  })
})
