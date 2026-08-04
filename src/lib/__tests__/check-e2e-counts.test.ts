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
 *     ternary da matrix ('128' || '162'), número de linha correto, dedupe
 *     de sobreposições (uma linha com filename + "prod E2E" gera 1 registro)
 *   - checkCounts: counts iguais → []; count divergente → violação com o
 *     esperado; target sem esperado (staging) → violação
 */

import { describe, it, expect } from "vitest"
import {
  extractDocumentedCounts,
  parseDerivedJson,
  checkCounts,
  checkSitePisos,
  MIN_DOCUMENTED_SITES,
} from "../../../scripts/check-e2e-counts.mjs"

// ── Fixtures (linhas reais dos workflows) ────────────────────────────────

const SEED_GUARDS_HEADER = `#   1. prod E2E (test-seed-prod-e2e.ts — 128 checks): guard recusa fora de
#   2. dev E2E (test-seed-dev-e2e.ts — 162 checks): guard recusa em produção,
# db push (schema) + validator (prod: 128 checks; dev: 162 checks).
`

const PR_CHECK_ORDER = `# ORDEM: prod E2E PRIMEIRO (128 checks — banco limpo, asserta ZERO
# usuários), dev E2E DEPOIS (162 checks — o wipe+recreate do dev seed não
`

const MATRIX_ECHOS = `echo "  ✅ Seed prod E2E passou (128 checks)"
echo "  ✅ Seed dev E2E passou (162 checks)"
echo "| E2E (\${{ matrix.seed == 'prod' && '128' || '162' }} checks) |"
echo "  ✅ Seed prod E2E (dev-env) passou — 128 checks"
echo "| Prod E2E (128 checks, override no env) |"
`

// ── parseDerivedJson ────────────────────────────────────────────────────

describe("parseDerivedJson", () => {
  it("parseia o JSON da derivação ({ prod, dev })", () => {
    expect(parseDerivedJson(`{"prod":128,"dev":162}\n`)).toEqual({ prod: 128, dev: 162 })
  })

  it("lança quando a saída não é JSON válido", () => {
    expect(() => parseDerivedJson("não é json")).toThrow(/não é JSON válido/)
  })

  it("lança quando prod/dev estão ausentes", () => {
    expect(() => parseDerivedJson(`{"prod":128}`)).toThrow(/sem prod\/dev numéricos/)
  })

  it("lança quando prod/dev não são números", () => {
    expect(() => parseDerivedJson(`{"prod":"128","dev":162}`)).toThrow(/sem prod\/dev numéricos/)
  })
})

// ── extractDocumentedCounts ──────────────────────────────────────────────

describe("extractDocumentedCounts", () => {
  it("detecta prod/dev E2E com count e linha corretos (header do seed-guards)", () => {
    const found = extractDocumentedCounts(SEED_GUARDS_HEADER)
    // linha 1: filename + "prod E2E" → 1 registro deduplicado (128)
    // linha 2: filename + "dev E2E" → 1 registro deduplicado (162)
    // linha 3: "prod: 128 checks; dev: 162 checks" → 2 registros
    expect(found).toHaveLength(4)
    expect(found).toContainEqual({ target: "prod", line: 1, count: 128, text: expect.any(String) })
    expect(found).toContainEqual({ target: "dev", line: 2, count: 162, text: expect.any(String) })
    expect(found).toContainEqual({ target: "prod", line: 3, count: 128, text: expect.any(String) })
    expect(found).toContainEqual({ target: "dev", line: 3, count: 162, text: expect.any(String) })
  })

  it("detecta a ordem documentada no pr-check.yml", () => {
    const found = extractDocumentedCounts(PR_CHECK_ORDER)
    expect(found).toHaveLength(2)
    expect(found[0]).toMatchObject({ target: "prod", line: 1, count: 128 })
    expect(found[1]).toMatchObject({ target: "dev", line: 2, count: 162 })
  })

  it("detecta os echos da matrix (incluindo ternary e dev-env)", () => {
    const found = extractDocumentedCounts(MATRIX_ECHOS)
    // linha 1: prod 128, linha 2: dev 162, linha 3: ternary (prod 128 + dev 162),
    // linha 4: prod E2E (dev-env) → prod 128, linha 5: Prod E2E → prod 128
    expect(found).toHaveLength(6)
    expect(found).toContainEqual({ target: "prod", line: 3, count: 128, text: expect.any(String) })
    expect(found).toContainEqual({ target: "dev", line: 3, count: 162, text: expect.any(String) })
    // dev-env é o nome do JOB, não o seed — o count 128 é do PROD E2E
    expect(found).toContainEqual({ target: "prod", line: 4, count: 128, text: expect.any(String) })
    // Caso NEGATIVO: a linha 4 (dev-env) NÃO deve gerar registro dev
    expect(found.filter((f) => f.line === 4)).toHaveLength(1)
    expect(found.filter((f) => f.line === 4)[0].target).toBe("prod")
    expect(found).toContainEqual({ target: "prod", line: 5, count: 128, text: expect.any(String) })
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
  const expected = { prod: 128, dev: 162 }

  it("counts iguais ao esperado → nenhuma violação", () => {
    const documented = [
      { target: "prod", line: 1, count: 128, text: "a" },
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

// ── checkSitePisos ──────────────────────────────────────────────────────
// Piso de sites documentados por alvo — a proteção contra PERDA de extração
// (site some silenciosamente da doc → o checkCounts não vê violação porque
// zero sites encontrados = zero validações). MESMO piso do
// seed-e2e-count.test.ts (prod ≥ 8, dev ≥ 6). O mutation test
// test-mutation-coord-update.sh prova o cenário end-to-end: doc 128→N →
// todos os sites de prod somem da extração → este piso falha o guard com
// exit 1 (o vitest também falha pelo piso — os 2 elos concordam).

describe("checkSitePisos", () => {
  it("ambos os alvos acima do piso → nenhuma violação", () => {
    const documented = Array.from({ length: 8 }, (_, i) => ({
      target: "prod",
      line: i + 1,
      count: 128,
      text: "p",
    })).concat(
      Array.from({ length: 6 }, (_, i) => ({ target: "dev", line: i + 20, count: 162, text: "d" })),
    )
    expect(checkSitePisos(documented)).toEqual([])
  })

  it("prod abaixo do piso (site sumiu) → violação com found/minimum", () => {
    // dev precisa estar no/abaixo do piso para isolar a violação de prod — o
    // checkSitePisos valida AMBOS os alvos (alvo ausente = found 0 = violação).
    const documented = Array.from({ length: 3 }, (_, i) => ({
      target: "prod",
      line: i + 1,
      count: 128,
      text: "p",
    })).concat(
      Array.from({ length: 6 }, (_, i) => ({ target: "dev", line: i + 20, count: 162, text: "d" })),
    )
    const violations = checkSitePisos(documented)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      target: "prod",
      found: 3,
      minimum: MIN_DOCUMENTED_SITES.prod,
    })
  })

  it("alvo com ZERO sites → violação (cenário da doc generalizada 128→N)", () => {
    // dev no piso (6 sites); prod AUSENTE (0 sites — todos sumiram da extração).
    const documented = Array.from({ length: 6 }, (_, i) => ({
      target: "dev",
      line: i + 1,
      count: 162,
      text: "d",
    }))
    const violations = checkSitePisos(documented)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      target: "prod",
      found: 0,
      minimum: MIN_DOCUMENTED_SITES.prod,
    })
  })

  it("minimums customizáveis (override por alvo)", () => {
    const documented = [{ target: "prod", line: 1, count: 128, text: "p" }]
    const violations = checkSitePisos(documented, { prod: 1, dev: 0 })
    expect(violations).toEqual([])
    const violations2 = checkSitePisos(documented, { prod: 2 })
    expect(violations2).toHaveLength(1)
    expect(violations2[0]).toMatchObject({ target: "prod", found: 1, minimum: 2 })
  })
})
