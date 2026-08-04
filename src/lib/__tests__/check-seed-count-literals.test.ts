/**
 * check-seed-count-literals.test.ts
 *
 * Testes unitários das funções PURAS do scripts/check-seed-count-literals.mjs
 * (guard que varre TODO o repo — scripts/, docs/, .github/ — por literais de
 * count de seed que não batam com a derivação real).
 *
 * Cobre:
 *   - extractCountLiterals: "N checks" (128/162), ternary específico da matrix
 *     ('prod' && '128' || '162' }} checks), número de linha correto, dedupe
 *   - FALSOS POSITIVOS: "UTF-8 check" (hífen) NÃO casa, ternary genérico
 *     "&& '1'" (SKIP_PRISMA_GENERATE) NÃO casa, mock data ("Rua das Flores,
 *     123", CVC "123", rgba(249,115,22), "minha-senha-123") NÃO casa, prosa
 *     histórica sem "checks" adjacente NÃO casa
 *   - checkLiterals: count ∈ {prod, dev} → []; count fora → violação com o
 *     conjunto esperado
 */

import { describe, it, expect } from "vitest"
import { extractCountLiterals, checkLiterals } from "../../../scripts/check-seed-count-literals.mjs"

// ── Fixtures ────────────────────────────────────────────────────────────────

const SEED_GUARDS_HEADER = `#   1. prod E2E (test-seed-prod-e2e.ts — 128 checks): guard recusa fora de
#   2. dev E2E (test-seed-dev-e2e.ts — 162 checks): guard recusa em produção,
# db push (schema) + validator (prod: 128 checks; dev: 162 checks).
`

const MATRIX_ECHOS = `echo "  ✅ Seed prod E2E passou (128 checks)"
echo "  ✅ Seed dev E2E passou (162 checks)"
echo "| E2E (\${{ matrix.seed == 'prod' && '128' || '162' }} checks) |"
echo "  ✅ Seed prod E2E (dev-env) passou — 128 checks"
echo "| Prod E2E (128 checks, override no env) |"
`

const MOCK_AND_NOISE = `# UTF-8 check roda no CI (hífen antes do número NÃO é count de seed)
name: UTF-8 Check
- Before committing, run a quick UTF-8 check on all staged files:
1. ✅ UTF-8 check (paralelo)
# SKIP_PRISMA_GENERATE ternario generico: \${{ matrix.seed == 'prod' && '1' }}
# Mock data: CVC "123", "Rua das Flores, 123", rgba(249, 115, 22), senha "minha-senha-123"
# Prosa historica: doc dizia 128, ancora de teste esperava 123 (sem "checks" perto do 123)
`

const EXPECTED = { prod: 128, dev: 162 }

// ── extractCountLiterals ────────────────────────────────────────────────────

describe("extractCountLiterals", () => {
  it("detecta prod/dev E2E com count e linha corretos (header do seed-guards)", () => {
    const found = extractCountLiterals(SEED_GUARDS_HEADER)
    expect(found).toHaveLength(4)
    expect(found).toContainEqual({ line: 1, count: 128, text: expect.any(String) })
    expect(found).toContainEqual({ line: 2, count: 162, text: expect.any(String) })
    expect(found).toContainEqual({ line: 3, count: 128, text: expect.any(String) })
    expect(found).toContainEqual({ line: 3, count: 162, text: expect.any(String) })
  })

  it("detecta os echos da matrix (incluindo ternary específico e dev-env)", () => {
    const found = extractCountLiterals(MATRIX_ECHOS)
    // linha 1: prod 128, linha 2: dev 162, linha 3: ternary (prod 128 + dev 162),
    // linha 4: prod E2E (dev-env) → prod 128, linha 5: Prod E2E → prod 128
    expect(found).toHaveLength(6)
    expect(found).toContainEqual({ line: 3, count: 128, text: expect.any(String) })
    expect(found).toContainEqual({ line: 3, count: 162, text: expect.any(String) })
    expect(found.filter((f) => f.line === 4)).toHaveLength(1)
    expect(found).toContainEqual({ line: 5, count: 128, text: expect.any(String) })
  })

  it("NÃO casa falsos positivos: UTF-8 check, ternary genérico, mock data e prosa", () => {
    const found = extractCountLiterals(MOCK_AND_NOISE)
    expect(found).toHaveLength(0)
  })

  it("linhas sem count em contexto não geram registros", () => {
    const found = extractCountLiterals(
      `# O count cresce quando asserções são adicionadas\nrun: echo "ok"\n# sem número aqui\n`,
    )
    expect(found).toHaveLength(0)
  })
})

// ── checkLiterals ───────────────────────────────────────────────────────────

describe("checkLiterals", () => {
  it("counts dentro do conjunto válido {prod, dev} → nenhuma violação", () => {
    const literals = [
      { line: 1, count: 128, text: "a" },
      { line: 2, count: 162, text: "b" },
    ]
    expect(checkLiterals(literals, EXPECTED)).toEqual([])
  })

  it("count fora do conjunto → violação com o conjunto esperado", () => {
    const literals = [{ line: 14, count: 123, text: "c" }]
    const violations = checkLiterals(literals, EXPECTED)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ line: 14, count: 123, expected: [128, 162] })
  })

  it("literal histórico 115 fora do conjunto → violação (ref órfão de bump antigo)", () => {
    const violations = checkLiterals([{ line: 5, count: 115, text: "d" }], EXPECTED)
    expect(violations).toHaveLength(1)
    expect(violations[0].count).toBe(115)
  })
})
