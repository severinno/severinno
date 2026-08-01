/**
 * E2E test for prisma/seed-prod.ts against an ephemeral PostGIS database.
 *
 * Usage:
 *   DATABASE_URL="postgresql://severinno:severinno_test@localhost:5433/severinno_test" \
 *   bun scripts/test-seed-prod-e2e.ts
 *   (orchestrated by scripts/test-seed-prod-e2e.sh, which spins up PostGIS)
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — at least one check failed (or the suite crashed)
 *
 * Valida:
 *   1. Guard: seed-prod RECUSA rodar sem NODE_ENV=production / override
 *   2. Seed roda com PROD_SEED_ALLOW_DEV=1 e conclui com sucesso
 *   3. Árvore de categorias completa (27 = 3 + 7 + 17) com slugs e parentes corretos
 *   4. Settings presentes (9 keys)
 *   5. ZERO usuários criados (sem contas demo)
 *   6. Re-execução idempotente — mesmos counts (categorias/settings/usuários)
 *
 * O seed é executado como SUBPROCESSO (`bun prisma/seed-prod.ts`) — o mesmo
 * caminho do CI — para validar o script real, não uma importação em memória.
 */

import { spawnSync } from "node:child_process"
import { PrismaClient } from "@prisma/client"
import { CATEGORY_SPEC, DEFAULT_SETTINGS, categorySlug } from "../prisma/seed-data"

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://severinno:severinno_test@localhost:5433/severinno_test"

const db = new PrismaClient()

let passed = 0
let failed = 0

function ok(msg: string) {
  console.log(`  ✅ ${msg}`)
  passed++
}
function bad(msg: string) {
  console.log(`  ❌ ${msg}`)
  failed++
}
function expect(cond: boolean, msg: string) {
  if (cond) ok(msg)
  else bad(msg)
}

/** Roda prisma/seed-prod.ts como subprocesso (mesmo caminho do CI). */
function runSeed(
  overrides: Record<string, string>,
  args: string[] = [],
): { status: number | null; out: string } {
  // Env controlado: nunca herda PROD_SEED_ALLOW_DEV nem DRY_RUN do ambiente
  // do chamador — o guard precisa ser honesto (recusa SEM override) e os runs
  // reais do seed não podem virar dry-run silencioso por env do shell/CI.
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL }
  delete env.PROD_SEED_ALLOW_DEV
  delete env.DRY_RUN
  Object.assign(env, overrides)

  const res = spawnSync("bun", ["prisma/seed-prod.ts", ...args], {
    env,
    encoding: "utf8",
    cwd: process.cwd(),
  })
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

type Counts = { categories: number; settings: number; users: number }

async function getCounts(): Promise<Counts> {
  const [categories, settings, users] = await Promise.all([
    db.category.count(),
    db.setting.count(),
    db.user.count(),
  ])
  return { categories, settings, users }
}

/** Valida a árvore completa de categorias contra o CATEGORY_SPEC canônico. */
async function validateTree(): Promise<void> {
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

async function main() {
  console.log("🧪 E2E — prisma/seed-prod.ts contra PostGIS efêmero\n")

  // ── 1. Guard ─────────────────────────────────────────────────────────
  console.log("  ── Guard (recusa fora de produção) ──")
  const refuse = runSeed({ NODE_ENV: "development" })
  expect(refuse.status !== 0, `seed-prod recusa em development (exit ${refuse.status})`)
  expect(refuse.out.includes("Seed de produção recusado"), "mensagem de recusa presente")

  // ── 1b. Dry-run: NADA é escrito ───────────────────────────────────────
  console.log("  ── Dry-run (DRY_RUN=1 e --dry-run, sem escrita) ──")
  const countsBefore = await getCounts()

  const dryEnv = runSeed({ NODE_ENV: "development", PROD_SEED_ALLOW_DEV: "1", DRY_RUN: "1" })
  expect(dryEnv.status === 0, `DRY_RUN=1 conclui com exit 0 (obtido ${dryEnv.status})`)
  expect(dryEnv.out.includes("DRY-RUN"), "DRY_RUN=1 exibe cabeçalho DRY-RUN")
  expect(dryEnv.out.includes("nada foi escrito"), "DRY_RUN=1 confirma que nada foi escrito")

  const dryArg = runSeed({ NODE_ENV: "development", PROD_SEED_ALLOW_DEV: "1" }, ["--dry-run"])
  expect(dryArg.status === 0, `--dry-run conclui com exit 0 (obtido ${dryArg.status})`)
  expect(dryArg.out.includes("DRY-RUN"), "--dry-run exibe cabeçalho DRY-RUN")

  const countsAfterDry = await getCounts()
  expect(
    countsAfterDry.categories === countsBefore.categories &&
      countsAfterDry.settings === countsBefore.settings &&
      countsAfterDry.users === countsBefore.users,
    `dry-run não altera counts (${countsBefore.categories}/${countsBefore.settings}/${countsBefore.users} → ${countsAfterDry.categories}/${countsAfterDry.settings}/${countsAfterDry.users})`,
  )

  // ── 2. Seed roda com override explícito ───────────────────────────────
  console.log("  ── Seed (PROD_SEED_ALLOW_DEV=1) ──")
  const seed = runSeed({ NODE_ENV: "development", PROD_SEED_ALLOW_DEV: "1" })
  expect(seed.status === 0, `seed-prod conclui com exit 0 (obtido ${seed.status})`)
  expect(seed.out.includes("Seed de produção concluído"), "confirmação final presente")

  // ── 3. Árvore de categorias ──────────────────────────────────────────
  console.log("  ── Árvore de categorias ──")
  await validateTree()

  // ── 4. Settings ──────────────────────────────────────────────────────
  console.log("  ── Settings ──")
  const settings = await db.setting.findMany()
  expect(
    settings.length === DEFAULT_SETTINGS.length,
    `settings = ${DEFAULT_SETTINGS.length} (obtido ${settings.length})`,
  )
  const keys = new Set(settings.map((s) => s.key))
  for (const s of DEFAULT_SETTINGS) {
    expect(keys.has(s.key), `key '${s.key}' presente`)
  }

  // ── 5. Zero usuários ─────────────────────────────────────────────────
  console.log("  ── Usuários ──")
  const afterFirst = await getCounts()
  expect(afterFirst.users === 0, `zero usuários (obtido ${afterFirst.users})`)

  // ── 6. Idempotência ──────────────────────────────────────────────────
  console.log("  ── Re-execução idempotente ──")
  const rerun = runSeed({ NODE_ENV: "development", PROD_SEED_ALLOW_DEV: "1" })
  expect(rerun.status === 0, `re-execução conclui com exit 0 (obtido ${rerun.status})`)
  const afterSecond = await getCounts()
  expect(
    afterSecond.categories === afterFirst.categories,
    `categorias estáveis (${afterFirst.categories} → ${afterSecond.categories})`,
  )
  expect(
    afterSecond.settings === afterFirst.settings,
    `settings estáveis (${afterFirst.settings} → ${afterSecond.settings})`,
  )
  expect(
    afterSecond.users === afterFirst.users,
    `usuários estáveis (${afterFirst.users} → ${afterSecond.users})`,
  )
  expect(
    afterSecond.categories === CATEGORY_SPEC.length,
    `total final = ${CATEGORY_SPEC.length} (obtido ${afterSecond.categories})`,
  )

  console.log(`\n📊 Resultados: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  await db.$disconnect()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error("💥 Test suite crashed:", e)
  process.exit(1)
})
