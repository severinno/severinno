/**
 * check-e2e-counts.test.ts
 *
 * Testes unitários das funções PURAS do scripts/check-e2e-counts.mjs (guard
 * que valida que os counts de checks documentados nos comentários dos
 * workflows batem com a DERIVAÇÃO scripts/seed-e2e-count.ts — a fonte da
 * verdade calculada a partir do código, nunca um literal).
 *
 * Cobre:
 *   - parseDerivedJson: JSON válido → { prod, dev }; JSON inválido / campos
 *     ausentes / não-numéricos → throws
 *   - extractDocumentedCounts: padrões "prod E2E (N checks)", "dev E2E",
 *     "prod: N checks; dev: N checks" (validator), filenames explícitos,
 *     ternary da matrix ('115' || '162'), número de linha correto, dedupe
 *     de sobreposições (uma linha com filename + "prod E2E" gera 1 registro)
 *   - checkCounts: counts iguais → []; count divergente → violação com o
 *     esperado; target sem esperado (staging) → violação
 */

import { describe, it, expect } from "vitest"
import {
  extractDocumentedCounts,
  parseDerivedJson,
  checkCounts,
} from "../../../scripts/check-e2e-counts.mjs"

// ── Fixtures (linhas reais dos workflows) ────────────────────────────────

const SEED_GUARDS_HEADER = `#   1. prod E2E (test-seed-prod-e2e.ts — 115 checks): guard recusa fora de
#   2. dev E2E (test-seed-dev-e2e.ts — 162 checks): guard recusa em produção,
# db push (schema) + validator (prod: 115 checks; dev: 162 checks).
`

const PR_CHECK_ORDER = `# ORDEM: prod E2E PRIMEIRO (115 checks — banco limpo, asserta ZERO
# usuários), dev E2E DEPOIS (162 checks — o wipe+recreate do dev seed não
`

const MATRIX_ECHOS = `echo "  ✅ Seed prod E2E passou (115 checks)"
echo "  ✅ Seed dev E2E passou (162 checks)"
echo "| E2E (\${{ matrix.seed == 'prod' && '115' || '162' }} checks) |"
echo "  ✅ Seed prod E2E (dev-env) passou — 115 checks"
echo "| Prod E2E (115 checks, override no env) |"
`

// ── parseDerivedJson ────────────────────────────────────────────────────

describe("parseDerivedJson", () => {
  it("parseia o JSON da derivação ({ prod, dev })", () => {
    expect(parseDerivedJson(`{"prod":115,"dev":162}\n`)).toEqual({ prod: 115, dev: 162 })
  })

  it("lança quando a saída não é JSON válido", () => {
    expect(() => parseDerivedJson("não é json")).toThrow(/não é JSON válido/)
  })

  it("lança quando prod/dev estão ausentes", () => {
    expect(() => parseDerivedJson(`{"prod":115}`)).toThrow(/sem prod\/dev numéricos/)
  })

  it("lança quando prod/dev não são números", () => {
    expect(() => parseDerivedJson(`{"prod":"115","dev":162}`)).toThrow(/sem prod\/dev numéricos/)
  })
})

// ── extractDocumentedCounts ──────────────────────────────────────────────

describe("extractDocumentedCounts", () => {
  it("detecta prod/dev E2E com count e linha corretos (header do seed-guards)", () => {
    const found = extractDocumentedCounts(SEED_GUARDS_HEADER)
    // linha 1: filename + "prod E2E" → 1 registro deduplicado (115)
    // linha 2: filename + "dev E2E" → 1 registro deduplicado (162)
    // linha 3: "prod: 115 checks; dev: 162 checks" → 2 registros
    expect(found).toHaveLength(4)
    expect(found).toContainEqual({ target: "prod", line: 1, count: 115, text: expect.any(String) })
    expect(found).toContainEqual({ target: "dev", line: 2, count: 162, text: expect.any(String) })
    expect(found).toContainEqual({ target: "prod", line: 3, count: 115, text: expect.any(String) })
    expect(found).toContainEqual({ target: "dev", line: 3, count: 162, text: expect.any(String) })
  })

  it("detecta a ordem documentada no pr-check.yml", () => {
    const found = extractDocumentedCounts(PR_CHECK_ORDER)
    expect(found).toHaveLength(2)
    expect(found[0]).toMatchObject({ target: "prod", line: 1, count: 115 })
    expect(found[1]).toMatchObject({ target: "dev", line: 2, count: 162 })
  })

  it("detecta os echos da matrix (incluindo ternary e dev-env)", () => {
    const found = extractDocumentedCounts(MATRIX_ECHOS)
    // linha 1: prod 115, linha 2: dev 162, linha 3: ternary (prod 115 + dev 162),
    // linha 4: prod E2E (dev-env) → prod 115, linha 5: Prod E2E → prod 115
    expect(found).toHaveLength(6)
    expect(found).toContainEqual({ target: "prod", line: 3, count: 115, text: expect.any(String) })
    expect(found).toContainEqual({ target: "dev", line: 3, count: 162, text: expect.any(String) })
    // dev-env é o nome do JOB, não o seed — o count 115 é do PROD E2E
    expect(found).toContainEqual({ target: "prod", line: 4, count: 115, text: expect.any(String) })
    // Caso NEGATIVO: a linha 4 (dev-env) NÃO deve gerar registro dev
    expect(found.filter((f) => f.line === 4)).toHaveLength(1)
    expect(found.filter((f) => f.line === 4)[0].target).toBe("prod")
    expect(found).toContainEqual({ target: "prod", line: 5, count: 115, text: expect.any(String) })
  })

  it("linhas sem count (comentários soltos, echo sem número) não geram registros", () => {
    const found = extractDocumentedCounts(
      `# O count cresce quando asserções são adicionadas\nrun: echo "ok"\n# sem número aqui\n`,
    )
    expect(found).toHaveLength(0)
  })
})

// ── checkCounts ──────────────────────────────────────────────────────────

describe("checkCounts", () => {
  const expected = { prod: 115, dev: 162 }

  it("counts iguais ao esperado → nenhuma violação", () => {
    const documented = [
      { target: "prod", line: 1, count: 115, text: "a" },
      { target: "dev", line: 2, count: 162, text: "b" },
    ]
    expect(checkCounts(documented, expected)).toEqual([])
  })

  it("count divergente → violação com o esperado", () => {
    const documented = [{ target: "dev", line: 14, count: 147, text: "c" }]
    const violations = checkCounts(documented, expected)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ target: "dev", line: 14, count: 147, expected: 162 })
  })

  it("target sem esperado definido → violação (fonte sem constante)", () => {
    const documented = [{ target: "staging", line: 5, count: 99, text: "d" }]
    const violations = checkCounts(documented, expected)
    expect(violations).toHaveLength(1)
    expect(violations[0].expected).toBeUndefined()
  })
})
