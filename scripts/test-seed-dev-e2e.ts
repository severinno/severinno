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
 *   5. Settings (9 keys), services (13), bookings (4) + payments (4) + reviews (4),
 *      favorites (2), notifications (9), availabilities (36)
 *   6. Guard contra banco POPULADO: recusa E mantém os counts intactos
 *      (nunca destrói dados existentes em produção)
 *   7. Re-execução idempotente — wipe + recreate → mesmos counts
 *   8. Guard ENTRE re-execuções: seed rodado 2× em sequência com
 *      NODE_ENV=production NO MEIO — após a recusa o banco populado
 *      permanece 100% intacto (TODAS as 10 tabelas comparadas, não só
 *      users/cats/settings do cenário 6)
 *   9. SEED_SPEC_PATCH no seed dev (update): buildSeedPlan acusa update,
 *      o seed cria a árvore com icon/order patchados e o re-run canônico
 *      restaura (mesmo padrão do seed-prod)
 *  10. RENAME via SEED_SPEC_PATCH no seed dev: o wipe torna o rename SEGURO
 *      (sem órfãs — diferente do upsert do seed-prod), a cascata de um nível
 *      é validada e o re-run canônico restaura o nome original
 *
 * O seed é executado como SUBPROCESSO (`bun prisma/seed.ts`) — o mesmo
 * caminho do CI — para validar o script real, não uma importação em memória.
 */

import { spawnSync } from "node:child_process"
import { PrismaClient } from "@prisma/client"
import {
  CATEGORY_SPEC,
  DEFAULT_SETTINGS,
  buildSeedPlan,
  categorySlug,
  type CategorySeedInput,
} from "../prisma/seed-data"
import { validateTree } from "./seed-e2e-common"

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
  await validateTree(db, { ok, bad, expect })

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

  // ── 8. Guard ENTRE re-execuções — banco 100% intacto após a recusa ────
  // Contrato anti-destruição REFORÇADO: o seed roda 2× em sequência com
  // NODE_ENV=production NO MEIO. Diferente do cenário 6 (que compara só
  // users/cats/settings), aqui TODAS as 10 tabelas são comparadas antes vs
  // depois da recusa — o guard não pode tocar NADA, nem tabelas secundárias
  // (payments, reviews, favorites, availabilities, ...). Após a recusa, um
  // novo run dev prova que o banco segue utilizável (wipe + recreate ok).
  console.log("  ── Guard entre re-execuções (NODE_ENV=production no meio) ──")

  // 8a. 1º run dev (popula do zero — wipe + recreate) → baseline completo
  const runFirst = runSeed({ NODE_ENV: "development" })
  expect(runFirst.status === 0, `1º run dev conclui exit 0 (obtido ${runFirst.status})`)
  const intactBefore = await getCounts()

  // 8b. Recusa NO MEIO do fluxo (entre dois runs dev)
  const refuseMid = runSeed({ NODE_ENV: "production" })
  expect(refuseMid.status !== 0, `recusa no meio do fluxo (exit ${refuseMid.status})`)
  expect(refuseMid.out.includes("Seed recusado"), "mensagem de recusa presente")

  // 8c. Banco 100% intacto — TODAS as 10 tabelas idênticas
  const intactAfter = await getCounts()
  for (const [k, v] of Object.entries(intactBefore)) {
    expect(
      intactAfter[k as keyof Counts] === v,
      `'${k}' intacto após recusa (${v} → ${intactAfter[k as keyof Counts]})`,
    )
  }

  // 8d. 2º run dev — o banco segue utilizável após a recusa
  const runSecond = runSeed({ NODE_ENV: "development" })
  expect(
    runSecond.status === 0,
    `2º run dev após recusa conclui exit 0 (obtido ${runSecond.status})`,
  )
  const afterRefusalFlow = await getCounts()
  expect(
    afterRefusalFlow.categories === CATEGORY_SPEC.length,
    `árvore canônica restaurada após o fluxo (${afterRefusalFlow.categories} categorias)`,
  )

  // ── 9. SEED_SPEC_PATCH no seed de DEV — convergência de update ──────────
  // O seed de dev faz wipe+recreate, então o patch flui pelo MESMO loop de
  // criação (helper compartilhado buildPatchedSpec): o estado final reflete
  // o spec patchado e o re-run canônico restaura o estado original.
  console.log("  ── SEED_SPEC_PATCH no seed dev (update mid-cycle) ──")

  const PATCHES: { name: string; icon?: string; order?: number }[] = [
    { name: "Elétrica", icon: "bolt" },
    { name: "Reparos", order: 5 },
  ]
  const PATCH = JSON.stringify(PATCHES)

  // 9a. buildSeedPlan com o spec PATCHADO contra o estado canônico atual
  //     → deve acusar update (icon/order), nunca create
  const patchedSpec: CategorySeedInput[] = CATEGORY_SPEC.map((c) => {
    const p = PATCHES.find((x) => x.name === c.name)
    if (!p) return c
    return {
      ...c,
      ...(p.icon !== undefined ? { icon: p.icon } : {}),
      ...(p.order !== undefined ? { order: p.order } : {}),
    }
  })
  // Slugs derivados do spec (nunca hardcoded — robusto a renomeações futuras)
  const eletricaSlug = categorySlug({ name: "Elétrica", parent: "Reparos", level: 1 })
  const reparosSlug = categorySlug({ name: "Reparos", level: 0 })

  const currentCats = await db.category.findMany({
    include: { parent: { select: { name: true } } },
  })
  const currentSettings = await db.setting.findMany()
  const planPatched = buildSeedPlan(
    currentCats.map((c) => ({
      slug: c.slug,
      name: c.name,
      level: c.level,
      parentName: c.parent?.name ?? null,
      icon: c.icon,
      order: c.order,
      active: c.active,
    })),
    currentSettings.map((s) => ({ key: s.key, value: s.value })),
    patchedSpec,
  )
  expect(
    planPatched.summary.categoriesCreate === 0,
    `plano patchado não cria linhas (0 create — obtido ${planPatched.summary.categoriesCreate})`,
  )
  const elétricaPlan = planPatched.categories.find((a) => a.slug === eletricaSlug)
  expect(
    elétricaPlan?.action === "update" &&
      elétricaPlan.action === "update" &&
      elétricaPlan.changes.includes("icon"),
    "plano detecta update de icon na 'Elétrica'",
  )
  const reparosPlan = planPatched.categories.find((a) => a.slug === reparosSlug)
  expect(
    reparosPlan?.action === "update" &&
      reparosPlan.action === "update" &&
      reparosPlan.changes.includes("order"),
    "plano detecta update de order na 'Reparos'",
  )

  // 9b. Roda o seed de DEV com o patch → o estado CRIADO reflete o patch
  const patchedRun = runSeed({ NODE_ENV: "development", SEED_SPEC_PATCH: PATCH })
  expect(patchedRun.status === 0, `seed dev com patch conclui exit 0 (obtido ${patchedRun.status})`)
  const afterPatch = await getCounts()
  expect(
    afterPatch.categories === CATEGORY_SPEC.length,
    `nenhuma linha duplicada — wipe mantém ${CATEGORY_SPEC.length} categorias (obtido ${afterPatch.categories})`,
  )
  expect(
    afterPatch.services === 13,
    `services continuam linkados por nome (obtido ${afterPatch.services})`,
  )
  const elétricaRow = await db.category.findUnique({ where: { slug: eletricaSlug } })
  expect(
    elétricaRow?.icon === "bolt",
    `'Elétrica' criada com icon 'bolt' (obtido '${elétricaRow?.icon ?? "—"}')`,
  )
  const reparosRow = await db.category.findUnique({ where: { slug: reparosSlug } })
  expect(reparosRow?.order === 5, `'Reparos' criada com order 5 (obtido ${reparosRow?.order})`)

  // 9c. Re-run CANÔNICO (sem patch) restaura os valores originais
  const restoreRun = runSeed({ NODE_ENV: "development" })
  expect(restoreRun.status === 0, `re-run canônico conclui exit 0 (obtido ${restoreRun.status})`)
  const elétricaRestored = await db.category.findUnique({ where: { slug: eletricaSlug } })
  expect(
    elétricaRestored?.icon === "zap",
    `'Elétrica' restaurada para icon 'zap' (obtido '${elétricaRestored?.icon ?? "—"}')`,
  )
  const reparosRestored = await db.category.findUnique({ where: { slug: reparosSlug } })
  expect(
    reparosRestored?.order === 0,
    `'Reparos' restaurada para order 0 (obtido ${reparosRestored?.order})`,
  )
  const afterRestore = await getCounts()
  expect(
    afterRestore.categories === CATEGORY_SPEC.length && afterRestore.services === 13,
    `contagem estável após restauração (cats ${afterRestore.categories}, services ${afterRestore.services})`,
  )

  // ── 10. RENAME via SEED_SPEC_PATCH no seed de DEV ───────────────────────
  // No seed dev o wipe torna o rename SEGURO (sem órfãs — diferente do
  // upsert do seed-prod): o estado final tem o nome novo, a cascata de um
  // nível é validada e o re-run canônico restaura o nome original.
  console.log("  ── RENAME via SEED_SPEC_PATCH no seed dev ──")

  const RENAME_PATCH = JSON.stringify([{ name: "Elétrica", renameTo: "Eletricidade" }])
  const eletricidadeSlug = categorySlug({ name: "Eletricidade", parent: "Reparos", level: 1 })

  const renameRun = runSeed({ NODE_ENV: "development", SEED_SPEC_PATCH: RENAME_PATCH })
  expect(renameRun.status === 0, `seed dev com rename conclui exit 0 (obtido ${renameRun.status})`)
  const eletricidadeRow = await db.category.findUnique({ where: { slug: eletricidadeSlug } })
  expect(
    eletricidadeRow?.name === "Eletricidade",
    `'Eletricidade' criada com slug '${eletricidadeSlug}' (obtido '${eletricidadeRow?.name ?? "—"}')`,
  )
  const countsRename = await getCounts()
  expect(
    countsRename.categories === CATEGORY_SPEC.length,
    `wipe + rename mantém ${CATEGORY_SPEC.length} categorias (obtido ${countsRename.categories})`,
  )
  expect(
    countsRename.services === 13,
    `services linkados por nome permanecem (obtido ${countsRename.services})`,
  )

  // Filho em cascata: o primeiro filho de 'Elétrica' passa a herdar o slug
  // da 'Eletricidade' (slug embute o slug do pai renomeado)
  const filhosEletrica = CATEGORY_SPEC.filter((c) => c.parent === "Elétrica")
  expect(
    filhosEletrica.length >= 1,
    `'Elétrica' precisa de filho(s) para validar a cascata de rename (obtido ${filhosEletrica.length})`,
  )
  const filhoNovoSlug = categorySlug({
    name: filhosEletrica[0].name,
    parent: "Eletricidade",
    level: 2,
  })
  const filhoNovo = await db.category.findUnique({ where: { slug: filhoNovoSlug } })
  expect(
    filhoNovo !== null,
    `filho '${filhosEletrica[0].name}' criado sob 'Eletricidade' (slug '${filhoNovoSlug}')`,
  )

  // Re-run canônico restaura 'Elétrica' (e o slug original)
  const restoreRename = runSeed({ NODE_ENV: "development" })
  expect(
    restoreRename.status === 0,
    `re-run canônico pós-rename conclui exit 0 (obtido ${restoreRename.status})`,
  )
  const eletricaBack = await db.category.findUnique({ where: { slug: eletricaSlug } })
  expect(
    eletricaBack?.name === "Elétrica",
    `'Elétrica' restaurada após re-run canônico (obtido '${eletricaBack?.name ?? "—"}')`,
  )
  const countsFinal = await getCounts()
  expect(
    countsFinal.categories === CATEGORY_SPEC.length,
    `contagem estável pós-restauração (${countsFinal.categories})`,
  )

  console.log(`\n📊 Resultados: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  await db.$disconnect()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error("💥 Test suite crashed:", e)
  process.exit(1)
})
