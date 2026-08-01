/**
 * scripts/seed-e2e-common.ts
 *
 * Helpers compartilhados entre os E2Es dos seeds:
 *   - scripts/test-seed-dev-e2e.ts  (prisma/seed.ts — dev)
 *   - scripts/test-seed-prod-e2e.ts (prisma/seed-prod.ts — prod)
 *
 * Centraliza:
 *   - createReporter() — o reporter de asserções (ok/bad/expect + contadores
 *     passed/failed) que estava duplicado (~15 linhas em cada E2E); os
 *     contadores são getters, então o summary final lê os VALORES VIVOS
 *   - validateTree() — estava duplicado (~45 linhas em cada E2E); elimina o
 *     risco de DRIFT quando a árvore de categorias evoluir: se o CATEGORY_SPEC
 *     mudar, os DOIS E2Es validam com a MESMA lógica — sem chance de um deles
 *     esquecer de ser atualizado (o cenário exato que este helper previne é a
 *     divergência silenciosa entre os dois validators).
 *   - validateUsers() + EXPECTED_EMAILS — as asserções de usuários demo do
 *     seed DEV (9 = 1 ADMIN + 2 CLIENT + 6 PROVIDER), que viviam no
 *     test-seed-dev-e2e.ts; centralizadas com contagens DERIVADAS do próprio
 *     map para um futuro E2E de staging reusar o MESMO padrão de validação
 *     por role sem drift.
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

// PrismaClient é usado SÓ como tipo (db: PrismaClient) — import type mantém o
// módulo runtime-puro: o scripts/seed-e2e-count.ts (derivação de counts) pode
// importar estes helpers sem puxar o @prisma/client no CI sem node_modules.
import type { PrismaClient } from "@prisma/client"
import { CATEGORY_SPEC, EXPECTED_EMAILS, categorySlug } from "../prisma/seed-data"

// Re-export: EXPECTED_EMAILS agora vive no seed-data (fonte pura, sem imports),
// porque o scripts/seed-e2e-count.ts (derivação de counts) precisa ler a
// contagem de emails/roles sem puxar o @prisma/client (roda no CI sem
// node_modules). Mantido como re-export para compatibilidade de imports.
export { EXPECTED_EMAILS }

/**
 * Reporter de asserções — interface BASE (ok/bad/expect) injetada nos
 * helpers (validateTree, assertPatchedUpdatePlan). Mantém os helpers puros,
 * sem estado global.
 */
export type TreeReporter = {
  ok: (msg: string) => void
  bad: (msg: string) => void
  expect: (cond: boolean, msg: string) => void
}

/**
 * Reporter COMPLETO retornado por createReporter(): além de ok/bad/expect,
 * expõe os contadores passed/failed/total como GETTERS — sempre leem o valor
 * atual, então o summary final imprime os números reais (um destructuring
 * `const { passed } = rep` congelaria o getter em 0 — NÃO faça isso).
 */
export type SeedReporter = TreeReporter & {
  readonly passed: number
  readonly failed: number
  readonly total: number
}

/**
 * Cria um reporter de asserções com contadores internos.
 *
 * Era duplicado em test-seed-dev-e2e.ts e test-seed-prod-e2e.ts (~15 linhas
 * cada: let passed/failed + ok/bad/expect). Agora um helper compartilhado:
 *
 *   const rep = createReporter()
 *   const { ok, bad, expect } = rep   // destructure SÓ as funções
 *   ...
 *   validateTree(db, rep)             // rep é um TreeReporter válido
 *   console.log(`Resultados: ${rep.passed} passed, ${rep.failed} failed`)
 *   process.exit(rep.failed > 0 ? 1 : 0)
 */
export function createReporter(): SeedReporter {
  let passed = 0
  let failed = 0

  const ok = (msg: string) => {
    console.log(`  ✅ ${msg}`)
    passed++
  }
  const bad = (msg: string) => {
    console.log(`  ❌ ${msg}`)
    failed++
  }
  const expect = (cond: boolean, msg: string) => {
    if (cond) ok(msg)
    else bad(msg)
  }

  return {
    ok,
    bad,
    expect,
    get passed() {
      return passed
    },
    get failed() {
      return failed
    },
    get total() {
      return passed + failed
    },
  }
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

/**
 * Emails demo esperados por role (fonte: prisma/seed.ts — seed DEV).
 *
 * Exportado junto com validateUsers() para que um futuro E2E de staging
 * (ou qualquer consumidor que precise validar o padrão de usuários demo)
 * reuse as MESMAS expectativas — a asserção centralizada elimina o risco
 * de drift entre o dev E2E e um novo E2E.
 *
 * Definição MOVIDA para ../prisma/seed-data (fonte pura) — re-exportada acima
 * para manter a API pública; a contagem derivada vive em seed-e2e-count.ts.
 */

/**
 * Valida os usuários demo do seed DEV: total, emails esperados por role e
 * distribuição por role — TUDO derivado de EXPECTED_EMAILS (se um demo user
 * for adicionado/removido no seed, as contagens ajustam sozinhas; as
 * mensagens de asserção permanecem idênticas às do bloco original do
 * test-seed-dev-e2e.ts, então o mutation test do seed dev continua válido).
 *
 * Antes vivia em test-seed-dev-e2e.ts; centralizado aqui para reuso. Um
 * futuro E2E de staging com expectativas DIFERENTES pode passar o próprio
 * map via `expected` — as contagens (total + distribuição por role) são
 * sempre derivadas do map usado na chamada.
 */
export async function validateUsers(
  db: PrismaClient,
  rep: TreeReporter,
  expected: Record<string, string[]> = EXPECTED_EMAILS,
): Promise<void> {
  const { expect } = rep
  const users = await db.user.findMany({ select: { email: true, role: true } })
  const byEmail = new Map(users.map((u) => [u.email, u.role]))

  const totalExpected = Object.values(expected).reduce((n, list) => n + list.length, 0)
  expect(
    users.length === totalExpected,
    `total de usuários = ${totalExpected} (obtido ${users.length})`,
  )

  for (const [role, emails] of Object.entries(expected)) {
    for (const email of emails) {
      expect(byEmail.get(email) === role, `'${email}' existe com role ${role}`)
    }
  }

  // Distribuição por role: derivada do map usado (1 ADMIN + 2 CLIENT + 6 PROVIDER p/ dev)
  const byRole = new Map<string, number>()
  for (const u of users) byRole.set(u.role, (byRole.get(u.role) ?? 0) + 1)
  for (const [role, emails] of Object.entries(expected)) {
    expect(
      byRole.get(role) === emails.length,
      `${emails.length} ${role} (obtido ${byRole.get(role) ?? 0})`,
    )
  }
}

// ---------------------------------------------------------------------------
// Contagens de checks — DERIVADAS do código (consumidas pela derivação
// scripts/seed-e2e-count.ts, que soma sites do E2E + loops + estes helpers)
// ---------------------------------------------------------------------------

/**
 * Nº de checks que validateTree() executa sobre a árvore CANÔNICA — derivado
 * do CATEGORY_SPEC (fonte única): 1 (total) + níveis (distribuição) + 2 ×
 * entries (level + parent) + 1 (slugs únicos). Atual: 1+3+27×2+1 = 59.
 */
export function validateTreeCheckCount(): number {
  const levels = new Set(CATEGORY_SPEC.map((c) => c.level)).size
  return 1 + levels + CATEGORY_SPEC.length * 2 + 1
}

/**
 * Nº de checks que validateUsers() executa — derivado do map de emails
 * esperados (fonte única): 1 (total) + 1 por email + 1 por role.
 * Atual (dev): 1 + 9 + 3 = 13.
 */
export function validateUsersCheckCount(
  expected: Record<string, string[]> = EXPECTED_EMAILS,
): number {
  const emails = Object.values(expected).reduce((n, list) => n + list.length, 0)
  return 1 + emails + Object.keys(expected).length
}
