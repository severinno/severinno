/**
 * E2E test for prisma/seed.ts (DEV seed) against an ephemeral PostGIS database.
 *
 * Mirrors scripts/test-seed-prod-e2e.ts — closes the loop on the two seeds:
 *   - prod seed (seed-prod.ts):  guard recusa fora de produção, cria SÓ
 *     categorias + settings, ZERO usuários
 *   - dev seed (seed.ts):        guard recusa em NODE_ENV=production,
 *     cria usuários demo + árvore completa + bookings/reviews
 *
 * Usage:
 *   DATABASE_URL="postgresql://severinno:severinno_test@localhost:5433/severinno_test" \
 *   bun scripts/test-seed-dev-e2e.ts
 *   (orchestrated by scripts/test-seed-dev-e2e.sh, which spins up PostGIS)
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — at least one check failed (or the suite crashed)
 *
 * Valida:
 *   1. Guard: seed RECUSA com NODE_ENV=production (exit ≠ 0 + mensagem) e
 *      NÃO escreve nada — nem mesmo no banco VAZIO (guarda roda antes do wipe)
 *   2. Seed dev roda com NODE_ENV=development e conclui com sucesso
 *   3. Usuários demo: 9 = 1 admin + 2 clients + 6 providers (emails esperados)
 *   4. Árvore de categorias completa (27 = 3 + 7 + 17) com slugs e parentes corretos
 *   5. Settings (9 keys), services (13), bookings (4) + payments (4) + reviews (4)
 *   6. Favorites (2), notifications (9), availabilities (36)
 *   7. Guard contra banco POPULADO: recusa E mantém os counts intactos
 *      (nunca destrói dados existentes em produção)
 *   8. Re-execução idempotente — wipe + recreate → mesmos counts
 *
 * O seed é executado como SUBPROCESSO (`bun prisma/seed.ts`) — o mesmo
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

/** Roda prisma/seed.ts como subprocesso (mesmo caminho do CI). */
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

  const res = spawnSync("bun", ["prisma/seed.ts", ...args], {
    env,
    encoding: "utf8",
    cwd: process.cwd(),
  })
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

type Counts = {
  users: number
  categories: number
  settings: number
  services: number
  bookings: number
  payments: number
  reviews: number
  favorites: number
  notifications: number
  availabilities: number
}

async function getCounts(): Promise<Counts> {
  const [
    users,
    categories,
    settings,
    services,
    bookings,
    payments,
    reviews,
    favorites,
    notifications,
    availabilities,
  ] = await Promise.all([
    db.user.count(),
    db.category.count(),
    db.setting.count(),
    db.service.count(),
    db.booking.count(),
    db.payment.count(),
    db.review.count(),
    db.favorite.count(),
    db.notification.count(),
    db.providerAvailability.count(),
  ])
  return {
    users,
    categories,
    settings,
    services,
    bookings,
    payments,
    reviews,
    favorites,
    notifications,
    availabilities,
  }
}

/** Emails demo esperados por role (fonte: prisma/seed.ts). */
const EXPECTED_EMAILS = {
  ADMIN: ["admin@severinno.com"],
  CLIENT: ["cliente@severinno.com", "maria@severinno.com"],
  PROVIDER: [
    "carlos@severinno.com",
    "ricardo@severinno.com",
    "lima@severinno.com",
    "fernanda@severinno.com",
    "pedro@severinno.com",
    "antonio@severinno.com",
  ],
}

/** Valida os usuários demo: 9 = 1 + 2 + 6, roles e emails corretos. */
async function validateUsers(): Promise<void> {
  const users = await db.user.findMany({ select: { email: true, role: true } })
  const byEmail = new Map(users.map((u) => [u.email, u.role]))

  expect(users.length === 9, `total de usuários = 9 (obtido ${users.length})`)

  for (const [role, emails] of Object.entries(EXPECTED_EMAILS)) {
    for (const email of emails) {
      expect(byEmail.get(email) === role, `'${email}' existe com role ${role}`)
    }
  }

  // Roles no total: 1 ADMIN + 2 CLIENT + 6 PROVIDER
  const byRole = new Map<string, number>()
  for (const u of users) byRole.set(u.role, (byRole.get(u.role) ?? 0) + 1)
  expect(byRole.get("ADMIN") === 1, `1 ADMIN (obtido ${byRole.get("ADMIN") ?? 0})`)
  expect(byRole.get("CLIENT") === 2, `2 CLIENT (obtido ${byRole.get("CLIENT") ?? 0})`)
  expect(byRole.get("PROVIDER") === 6, `6 PROVIDER (obtido ${byRole.get("PROVIDER") ?? 0})`)
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
  console.log("🧪 E2E — prisma/seed.ts (DEV) contra PostGIS efêmero\n")

  // ── 1. Guard contra banco (recusa + NADA escrito) ───────────────────
  console.log("  ── Guard (recusa em NODE_ENV=production, sem escrita) ──")
  // Snapshot ANTES do runSeed — se o guard escrever qualquer coisa, o
  // before/after diverge e o check falha. Robust o tanto para o pipeline
  // padrão (container tmpfs vazio) quanto para --skip-docker com um
  // container que já rodou o seed uma vez.
  const countsBeforeGuard = await getCounts()
  const refuseEmpty = runSeed({ NODE_ENV: "production" })
  expect(refuseEmpty.status !== 0, `seed recusa em production (exit ${refuseEmpty.status})`)
  expect(refuseEmpty.out.includes("Seed recusado"), "mensagem de recusa presente")
  expect(
    !refuseEmpty.out.includes("Seed completed successfully"),
    "não reporta sucesso no meio da recusa",
  )
  const countsAfterGuard = await getCounts()
  expect(
    countsAfterGuard.users === countsBeforeGuard.users &&
      countsAfterGuard.categories === countsBeforeGuard.categories &&
      countsAfterGuard.settings === countsBeforeGuard.settings,
    `guard não escreve nada (users/cats/settings inalterados: ${countsBeforeGuard.users}/${countsBeforeGuard.categories}/${countsBeforeGuard.settings})`,
  )

  // ── 2. Seed dev roda ─────────────────────────────────────────────────
  console.log("  ── Seed dev (NODE_ENV=development) ──")
  const seed = runSeed({ NODE_ENV: "development" })
  expect(seed.status === 0, `seed conclui com exit 0 (obtido ${seed.status})`)
  expect(seed.out.includes("Seed completed successfully"), "confirmação final presente")
  expect(seed.out.includes("Login credentials"), "credenciais demo listadas no output")

  // ── 3. Usuários demo ─────────────────────────────────────────────────
  console.log("  ── Usuários demo ──")
  await validateUsers()

  // ── 4. Árvore de categorias ──────────────────────────────────────────
  console.log("  ── Árvore de categorias ──")
  await validateTree()

  // ── 5. Settings + services + bookings/payments/reviews ───────────────
  console.log("  ── Settings / Services / Bookings ──")
  const settings = await db.setting.findMany()
  expect(
    settings.length === DEFAULT_SETTINGS.length,
    `settings = ${DEFAULT_SETTINGS.length} (obtido ${settings.length})`,
  )
  const keys = new Set(settings.map((s) => s.key))
  for (const s of DEFAULT_SETTINGS) {
    expect(keys.has(s.key), `key '${s.key}' presente`)
  }

  const afterFirst = await getCounts()
  expect(afterFirst.services === 13, `services = 13 (obtido ${afterFirst.services})`)
  expect(afterFirst.bookings === 4, `bookings = 4 (obtido ${afterFirst.bookings})`)
  expect(afterFirst.payments === 4, `payments = 4 (obtido ${afterFirst.payments})`)
  expect(afterFirst.reviews === 4, `reviews = 4 (obtido ${afterFirst.reviews})`)
  expect(afterFirst.favorites === 2, `favorites = 2 (obtido ${afterFirst.favorites})`)
  expect(afterFirst.notifications === 9, `notifications = 9 (obtido ${afterFirst.notifications})`)
  expect(
    afterFirst.availabilities === 36,
    `availabilities = 36 (6 providers × 6 dias — obtido ${afterFirst.availabilities})`,
  )

  // ── 6. Guard contra banco POPULADO ───────────────────────────────────
  // O guard roda ANTES do wipe — recusa E preserva todos os dados.
  console.log("  ── Guard contra banco populado (nunca destrói dados) ──")
  const refusePopulated = runSeed({ NODE_ENV: "production" })
  expect(refusePopulated.status !== 0, `recusa com banco populado (exit ${refusePopulated.status})`)
  expect(refusePopulated.out.includes("Seed recusado"), "mensagem de recusa presente")
  const countsAfterGuardPopulated = await getCounts()
  expect(
    countsAfterGuardPopulated.users === afterFirst.users &&
      countsAfterGuardPopulated.categories === afterFirst.categories &&
      countsAfterGuardPopulated.settings === afterFirst.settings,
    `guard não destrói dados (users/cats/settings inalterados: ${afterFirst.users}/${afterFirst.categories}/${afterFirst.settings})`,
  )

  // ── 7. Idempotência ─────────────────────────────────────────────────
  console.log("  ── Re-execução idempotente (wipe + recreate) ──")
  const rerun = runSeed({ NODE_ENV: "development" })
  expect(rerun.status === 0, `re-execução conclui com exit 0 (obtido ${rerun.status})`)
  const afterSecond = await getCounts()
  for (const [k, v] of Object.entries(afterFirst)) {
    expect(
      afterSecond[k as keyof Counts] === v,
      `'${k}' estável (${v} → ${afterSecond[k as keyof Counts]})`,
    )
  }
  expect(
    afterSecond.categories === CATEGORY_SPEC.length,
    `total final de categorias = ${CATEGORY_SPEC.length} (obtido ${afterSecond.categories})`,
  )

  console.log(`\n📊 Resultados: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  await db.$disconnect()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error("💥 Test suite crashed:", e)
  process.exit(1)
})
