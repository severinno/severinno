/**
 * scripts/seed-e2e-common.ts
 *
 * Helpers compartilhados entre os E2Es dos seeds:
 *   - scripts/test-seed-dev-e2e.ts  (prisma/seed.ts — dev)
 *   - scripts/test-seed-prod-e2e.ts (prisma/seed-prod.ts — prod)
 *
 * Centraliza o validateTree() que estava duplicado (~45 linhas em cada E2E)
 * para eliminar o risco de DRIFT quando a árvore de categorias evoluir: se o
 * CATEGORY_SPEC mudar, os DOIS E2Es validam com a MESMA lógica — sem chance
 * de um deles esquecer de ser atualizado (o cenário exato que este helper
 * previne é a divergência silenciosa entre os dois validators).
 *
 * Usage:
 *   Este módulo NÃO é um script executável — é um helper importado pelos
 *   E2Es (test-seed-dev-e2e.ts / test-seed-prod-e2e.ts). Os entry points são:
 *   bash scripts/test-seed-dev-e2e.sh
 *   bash scripts/test-seed-prod-e2e.sh
 *
 * Exit codes:
 *   N/A — este arquivo não tem exit code próprio; a validação do validateTree
 *   reporta via TreeReporter injetado (ok/bad/expect) e os E2Es decidem o
 *   exit final (0 — todos os checks passaram, 1 — alguma asserção falhou).
 */

import { PrismaClient } from "@prisma/client"
import { CATEGORY_SPEC, categorySlug } from "../prisma/seed-data"

/**
 * Reporter de asserções — cada E2E injeta o seu (contadores passed/failed
 * locais via ok/bad/expect). Mantém o helper puro, sem estado global.
 */
export type TreeReporter = {
  ok: (msg: string) => void
  bad: (msg: string) => void
  expect: (cond: boolean, msg: string) => void
}

/**
 * Valida a árvore completa de categorias contra o CATEGORY_SPEC canônico.
 *
 * Lógica ÚNICA — antes vivia duplicada em test-seed-dev-e2e.ts e
 * test-seed-prod-e2e.ts. Roda as mesmas asserções em ambos os E2Es:
 *   - total de categorias == CATEGORY_SPEC.length
 *   - distribuição por level (3 + 7 + 17)
 *   - cada entry do spec existe com o slug canônico, level e parent corretos
 *   - slugs únicos (constraint @unique respeitada)
 */
export async function validateTree(db: PrismaClient, rep: TreeReporter): Promise<void> {
  const { expect, bad } = rep
  const cats = await db.category.findMany({ include: { parent: true } })
  const bySlug = new Map(cats.map((c) => [c.slug, c]))

  // Total
  expect(
    cats.length === CATEGORY_SPEC.length,
    `total de categorias = ${CATEGORY_SPEC.length} (obtido ${cats.length})`,
  )

  // Distribuição por level (3 + 7 + 17)
  const byLevel = new Map<number, number>()
  for (const c of cats) byLevel.set(c.level, (byLevel.get(c.level) ?? 0) + 1)
  const expectedLevels = new Map<number, number>()
  for (const s of CATEGORY_SPEC) expectedLevels.set(s.level, (expectedLevels.get(s.level) ?? 0) + 1)
  for (const [lv, exp] of expectedLevels) {
    expect(
      byLevel.get(lv) === exp,
      `level ${lv}: ${exp} categorias (obtido ${byLevel.get(lv) ?? 0})`,
    )
  }

  // Cada entry do spec existe com o slug canônico, level e parent corretos
  for (const s of CATEGORY_SPEC) {
    const expectedSlug = categorySlug(s)
    const row = bySlug.get(expectedSlug)
    if (!row) {
      bad(`categoria '${s.name}' ausente (slug esperado '${expectedSlug}')`)
      continue
    }
    expect(row.level === s.level, `'${s.name}' level ${s.level} (obtido ${row.level})`)
    if (s.parent) {
      expect(
        row.parent?.name === s.parent,
        `'${s.name}' parent='${s.parent}' (obtido '${row.parent?.name ?? "—"}')`,
      )
    } else {
      expect(row.parentId === null, `'${s.name}' sem parent (obtido '${row.parentId ?? "—"}')`)
    }
  }

  // Slugs únicos (constraint @unique respeitada)
  expect(new Set(cats.map((c) => c.slug)).size === cats.length, "slugs únicos (sem duplicatas)")
}
