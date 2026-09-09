/**
 * seed-e2e-common.test.ts
 *
 * Testes unitários para scripts/seed-e2e-common.ts — os helpers compartilhados
 * entre os E2Es dos seeds (test-seed-dev-e2e.ts / test-seed-prod-e2e.ts).
 *
 * Cobre validateTree() com um db MOCKADO (sem banco real):
 *   - Árvore CANÔNICA (derivada do CATEGORY_SPEC via categorySlug): todos os
 *     checks passam — contagem exata dos checks do reporter é validada
 *   - Árvore PODRE em 3 variantes (categoria ausente / parent errado / level
 *     errado): o reporter conta EXATAMENTE as asserções quebradas
 *
 * A contagem esperada é DERIVADA do CATEGORY_SPEC (não hardcoded), para não
 * quebrar se a árvore evoluir — mas os números atuais estão documentados nos
 * comentários de cada teste.
 *
 * Usage:
 *   npx vitest run --config vitest.config.unit.ts src/lib/__tests__/seed-e2e-common.test.ts
 *
 * Exit codes:
 *   0 — todos os testes passaram
 *   1 — pelo menos um teste falhou
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { PrismaClient } from "@prisma/client"
import { createReporter, validateTree } from "../../../scripts/seed-e2e-common"
import { CATEGORY_SPEC, categorySlug } from "../../../prisma/seed-data"

/** Forma mínima de uma linha de categoria como o validateTree consome. */
type CategoryRow = {
  slug: string
  name: string
  level: number
  parentId: string | null
  parent: { name: string } | null
}

/**
 * Monta as linhas CANÔNICAS a partir do CATEGORY_SPEC — slugs derivados com a
 * MESMA regra do seed (categorySlug), para que o validateTree encontre tudo.
 */
function canonicalRows(): CategoryRow[] {
  return CATEGORY_SPEC.map((s) => {
    const parent = s.parent ? CATEGORY_SPEC.find((p) => p.name === s.parent) : undefined
    return {
      slug: categorySlug(s),
      name: s.name,
      level: s.level,
      parentId: parent ? categorySlug(parent) : null,
      parent: parent ? { name: parent.name } : null,
    }
  })
}

/** Db fake: findMany devolve as linhas dadas (sem tocar em banco). */
function mockDb(rows: CategoryRow[]): PrismaClient {
  return {
    category: { findMany: vi.fn().mockResolvedValue(rows) },
  } as unknown as PrismaClient
}

/** Nº total de checks que o validateTree executa sobre a árvore canônica. */
function canonicalCheckCount(): number {
  const levels = new Set(CATEGORY_SPEC.map((c) => c.level)).size
  return (
    1 /* total */ +
    levels /* distribuição por level */ +
    CATEGORY_SPEC.length * 2 /* por entry */ +
    1
  ) /* slugs únicos */
}

/**
 * Remove a linha com o nome dado. Guard explícito: se o spec evoluir e o
 * nome sumir, lança com mensagem clara em vez de splice silencioso do -1
 * (que removeria a ÚLTIMA linha e produziria contagens confusas).
 */
function removeRow(rows: CategoryRow[], name: string): CategoryRow {
  const row = rows.find((r) => r.name === name)
  if (!row) throw new Error(`linha '${name}' não encontrada — CATEGORY_SPEC mudou?`)
  rows.splice(rows.indexOf(row), 1)
  return row
}

describe("seed-e2e-common — validateTree (db mockado)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Silencia o console.log do reporter durante os testes de contagem;
    // capturamos as mensagens via mock.calls quando precisamos.
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it("árvore canônica: todos os checks passam (failed = 0, passed = total)", async () => {
    const db = mockDb(canonicalRows())
    const rep = createReporter()

    await validateTree(db, rep)

    expect(db.category.findMany).toHaveBeenCalledWith({ include: { parent: true } })
    expect(rep.failed).toBe(0)
    expect(rep.passed).toBe(canonicalCheckCount())
    // atual: 1 (total) + 3 (levels) + 27*2 (entries) + 1 (únicos) = 59
    expect(rep.total).toBe(rep.passed + rep.failed)
  })

  it("categoria ausente: 3 falhas (total + level + entry) e passed reduz em 4", async () => {
    const rows = canonicalRows()
    removeRow(rows, "Poda de árvores")

    const db = mockDb(rows)
    const rep = createReporter()

    await validateTree(db, rep)

    // total (26 ≠ 27) + distribuição do level 2 (16 ≠ 17) + entry ausente
    expect(rep.failed).toBe(3)
    // 59 canônicos − 2 (level+parent do entry removido) − 1 (total) − 1 (level) = 55
    expect(rep.passed).toBe(canonicalCheckCount() - 4)
  })

  it("categoria ausente: mensagem de falha identifica o slug esperado", async () => {
    const rows = canonicalRows()
    removeRow(rows, "Poda de árvores")

    const rep = createReporter()
    await validateTree(mockDb(rows), rep)

    const msgs = logSpy.mock.calls.map((c: string[]) => c.join(" "))
    expect(msgs.some((m: string) => m.includes("ausente"))).toBe(true)
    expect(
      msgs.some((m: string) =>
        m.includes(categorySlug({ name: "Poda de árvores", parent: "Alvenaria", level: 2 })),
      ),
    ).toBe(true)
  })

  it("parent errado: 1 falha (só o check de parent do entry afetado)", async () => {
    const rows = canonicalRows()
    const pintura = rows.find((r) => r.name === "Pintura")!
    // Slug CANÔNICO preservado (senão vira 'ausente'); só o parent é corrompido.
    pintura.parent = { name: "Reforma" }

    const rep = createReporter()
    await validateTree(mockDb(rows), rep)

    expect(rep.failed).toBe(1)
    expect(rep.passed).toBe(canonicalCheckCount() - 1) // 58
  })

  it("level errado: 3 falhas (entry level + 2 distribuições de level)", async () => {
    const rows = canonicalRows()
    const eletrica = rows.find((r) => r.name === "Elétrica")!
    eletrica.level = 2 // era 1

    const rep = createReporter()
    await validateTree(mockDb(rows), rep)

    // entry level (2 ≠ 1) + level 1 (6 ≠ 7) + level 2 (18 ≠ 17)
    expect(rep.failed).toBe(3)
    expect(rep.passed).toBe(canonicalCheckCount() - 3) // 56
  })

  it("slug duplicado (linha extra): 3 falhas (total + level + unique)", async () => {
    // Duplicar uma linha qualquer produz EXATAMENTE 3 falhas previsíveis:
    // total (28 ≠ 27) + distribuição do level 2 (18 ≠ 17) + slugs únicos
    // (27 únicos ≠ 28 linhas). O bySlug mantém 27 chaves, então todas as
    // 27 entries do spec continuam encontradas (54 checks passam).
    const rows = canonicalRows()
    const leaf = rows.find((r) => r.name === "Poda de árvores")!
    rows.push(leaf) // mesma referência 2× → slug duplicado, 28 linhas

    const rep = createReporter()
    await validateTree(mockDb(rows), rep)

    expect(rep.failed).toBe(3)
    expect(rep.passed).toBe(canonicalCheckCount() - 3) // 56
  })
})
