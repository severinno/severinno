/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Fuzzing tests for AddressAutocomplete.
 *
 * Generates 20 random / edge-case input strings and verifies that:
 *   1. The component does NOT crash (input still rendered).
 *   2. There are NO axe-core accessibility violations after input.
 *
 * Each test uses the a11y pattern (real timers, <svg> icon stubs) so that
 * axe-core can run its full analysis pipeline.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import React from "react"
import { render, screen, fireEvent, act } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"
import AddressAutocomplete from "../address-autocomplete"

import { MOCK_RESULTS, mockFetchGeoSearch, resetCommonMocks } from "./test-utils"

// ---------------------------------------------------------------------------
// Lucide icons must be <svg> (not <span>) for axe-core analysis.
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => {
  const Svg = (p: any) => <svg aria-hidden="true" data-testid="lucide-icon" {...p} />
  Svg.displayName = "LucideIcon"
  return {
    MapPin: Svg,
    LocateFixed: Svg,
    Loader2: (p: any) => (
      <svg aria-hidden="true" className="animate-spin" data-testid="icon-loading" {...p} />
    ),
    X: Svg,
  }
})

// ---------------------------------------------------------------------------
// Fuzz input corpus — 20 edge-case strings that exercise different code paths
// ---------------------------------------------------------------------------

type FuzzCase = {
  label: string
  input: string
  description: string
}

const FUZZ_CASES: FuzzCase[] = [
  { label: "empty-string", input: "", description: "String vazia — sem interação" },
  { label: "single-char", input: "a", description: "1 caractere — abaixo do threshold de 3" },
  { label: "two-chars", input: "ab", description: "2 caracteres — abaixo do threshold de 3" },
  { label: "only-numbers", input: "1234567890", description: "Apenas números" },
  { label: "special-chars", input: "@#$%&*()!?=+", description: "Caracteres especiais" },
  {
    label: "html-injection",
    input: "<script>alert('xss')</script>",
    description: "Tentativa de XSS via HTML injection",
  },
  { label: "sql-injection", input: "' OR '1'='1 --", description: "Tentativa de SQL injection" },
  {
    label: "very-long-ascii",
    input: "A".repeat(1000),
    description: "Texto ASCII muito longo (1000 chars)",
  },
  {
    label: "unicode-accented",
    input: "São Paulo — Rua 23 de Maio, 1234",
    description: "Unicode com acentos + travessão",
  },
  {
    label: "emoji-mixed",
    input: "📍 Rua Augusta 🏠 123",
    description: "Emoji misturado com texto",
  },
  {
    label: "mixed-script",
    input: "abc123!@#$%DEF456",
    description: "Script misto (letras + números + símbolos)",
  },
  { label: "whitespace-only", input: "     ", description: "Apenas espaços em branco" },
  { label: "rtl-text", input: "شارع الحمراء، دبي", description: "Texto RTL (árabe)" },
  {
    label: "url-like",
    input: "https://example.com/search?q=endereco&lat=-23",
    description: "String tipo URL com query params",
  },
  {
    label: "json-like",
    input: '{"street":"Paulista","city":"SP"}',
    description: "String tipo JSON",
  },
  {
    label: "leading-trailing-spaces",
    input: "  Avenida Paulista  ",
    description: "Espaços leading/trailing",
  },
  { label: "newlines-tabs", input: "Rua\nAugusta\t123", description: "Quebras de linha e tabs" },
  {
    label: "very-long-unicode",
    input: "あ".repeat(500),
    description: "Unicode muito longo (500 chars, hiragana)",
  },
  {
    label: "pipe-separated",
    input: "Rua|Augusta|123|São Paulo|SP|01310-100",
    description: "Pipe-separated (tipo CSV)",
  },
  {
    label: "null-bytes",
    input: "test\0string\0injection",
    description: "Null bytes no meio do texto",
  },
]

// ---------------------------------------------------------------------------
// Setup — real timers (axe-core precisa)
// ---------------------------------------------------------------------------

async function realDebounce() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 350))
  })
}

beforeEach(() => {
  resetCommonMocks()
})

// ===========================================================================
// Fuzzing tests
// ===========================================================================

describe("AddressAutocomplete — fuzzing", () => {
  for (const { label, input, description } of FUZZ_CASES) {
    it(`${label}: ${description}`, async () => {
      // ── Render ──
      const { container } = render(<AddressAutocomplete />)

      // Type the fuzz input
      const inputEl = screen.getByRole("combobox")
      await act(async () => {
        fireEvent.change(inputEl, { target: { value: input } })
      })

      // If input >= 3 chars, mock the API with results and advance debounce
      if (input.length >= 3) {
        mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)
        await realDebounce()
      }

      // ── Crash check: input still rendered, no exception thrown ──
      const stillThere = screen.getByRole("combobox") as HTMLInputElement
      expect(stillThere).toBeTruthy()

      // ── Axe-core: no accessibility violations ──
      const results = await axe(container)
      expect(
        results.violations,
        `Axe violations for input "${label}": ${results.violations.map((v) => v.id).join(", ")}`,
      ).toHaveLength(0)
    })
  }
})
