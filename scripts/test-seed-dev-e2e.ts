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
 *  11. SEED_SPEC_PATCH inválido (JSON quebrado): o SPEC é derivado NO TOPO do
 *      módulo (const SPEC = buildPatchedSpec(...)), então um JSON malformado
 *      lança DURANTE a avaliação do módulo — antes de main() e antes do wipe.
 *      O seed recusa com erro claro e NENHUMA das 10 tabelas é tocada
 *      (exercita o throw real do buildPatchedSpec no caminho real)
 *
 * O seed é executado como SUBPROCESSO (`bun prisma/seed.ts`) — o mesmo
 * caminho do CI — para validar o script real, não uma importação em memória.
 */

import { spawnSync } from "node:child_process"
import { PrismaClient } from "@prisma/client"
import { CATEGORY_SPEC, DEFAULT_SETTINGS } from "../prisma/seed-data"
import { createReporter, validateTree, validateUsers } from "./seed-e2e-common"
import { deriveExpectedChecks } from "./seed-e2e-count"
import {
  UPDATE_PATCH,
  RENAME_PATCH,
  assertPatchedUpdatePlan,
  buildPatchedUpdatePlan,
  deriveRenameContext,
  renamedChildSlug,
} from "./seed-e2e-utils"

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://severinno:severinno_test@localhost:5433/severinno_test"

const db = new PrismaClient()

// Reporter de asserções compartilhado (seed-e2e-common.ts). Destructure SÓ as
// funções — passed/failed são getters VIVOS, lidos no summary final via rep.*
// (um destructuring `const { passed } = rep` congelaria o getter em 0).
const rep = createReporter()
// ok/bad are used internally by the shared helpers (validateTree,
// assertPatchedUpdatePlan, validateUsers) via `rep`; the E2E bodies only
// assert directly with expect()
const { expect } = rep

// ── Count guard (fonte da verdade DERIVADA) ─────────────────────────────
// Total de checks que este E2E produz — DERIVADO do código pela
// scripts/seed-e2e-count.ts (sites de asserção no source + expansão de
// loops + validateTree + validateUsers + assertPatchedUpdatePlan), NUNCA um
// literal: se uma asserção for adicionada/removida, o total ajusta sozinho.
// O guard estático scripts/check-e2e-counts.mjs compara os comentários dos
// workflows (seed-guards.yml, pr-check.yml, validate-seed-guards-matrix-
// local.sh) com a derivação (bun scripts/seed-e2e-count.ts --json); o
// runtime check no final de main() valida que o total REAL impresso (📊
// Resultados) bate com o esperado derivado.
export const EXPECTED_TOTAL = deriveExpectedChecks("dev")

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
  await validateUsers(db, rep)

  // ── 4. Árvore de categorias ──────────────────────────────────────────
  console.log("  ── Árvore de categorias ──")
  await validateTree(db, rep)

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

  // 9a. buildSeedPlan com o spec PATCHADO contra o estado canônico atual
  //     → deve acusar update (icon/order), nunca create
  const { plan: planPatched, eletricaSlug, reparosSlug } = await buildPatchedUpdatePlan(db)
  assertPatchedUpdatePlan(rep, planPatched, eletricaSlug, reparosSlug)

  // 9b. Roda o seed de DEV com o patch → o estado CRIADO reflete o patch
  const patchedRun = runSeed({ NODE_ENV: "development", SEED_SPEC_PATCH: UPDATE_PATCH })
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

  const { newSlug: eletricidadeSlug } = deriveRenameContext()

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
  const { filhos: filhosEletrica } = deriveRenameContext()
  expect(
    filhosEletrica.length >= 1,
    `'Elétrica' precisa de filho(s) para validar a cascata de rename (obtido ${filhosEletrica.length})`,
  )
  const filhoNovoSlug = renamedChildSlug(filhosEletrica[0])
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

  // ── 11. SEED_SPEC_PATCH inválido (JSON quebrado) — fail-fast ANTES de ────
  // qualquer escrita. No seed dev, `const SPEC = buildPatchedSpec(...)` roda
  // NO TOPO do módulo (linha ~35 do prisma/seed.ts) e o gate do patch usa o
  // MESMO isDemoAccountsEnabled do guard — em dev o patch está HABILITADO,
  // então um JSON malformado lança `SEED_SPEC_PATCH inválido (JSON): ...`
  // DURANTE a avaliação do módulo, antes de main() e antes do wipe. Este
  // cenário exercita o throw real do buildPatchedSpec no caminho real
  // (subprocesso) e prova zero-escrita comparando TODAS as 10 tabelas.
  console.log("  ── SEED_SPEC_PATCH inválido (JSON quebrado — fail-fast) ──")

  const countsBeforeInvalid = await getCounts()
  const invalidRun = runSeed({
    NODE_ENV: "development",
    SEED_SPEC_PATCH: "{não é json",
  })
  expect(invalidRun.status !== 0, `seed recusa com patch inválido (exit ${invalidRun.status})`)
  expect(
    invalidRun.out.includes("SEED_SPEC_PATCH inválido (JSON)"),
    "mensagem de JSON inválido presente (throw do buildPatchedSpec)",
  )
  expect(
    !invalidRun.out.includes("Seed completed successfully"),
    "não reporta sucesso no meio da recusa",
  )
  // Zero-escrita: TODAS as 10 tabelas idênticas (o throw é no topo do módulo,
  // nem o wipe chegou a rodar)
  const countsAfterInvalid = await getCounts()
  for (const [k, v] of Object.entries(countsBeforeInvalid)) {
    expect(
      countsAfterInvalid[k as keyof Counts] === v,
      `'${k}' intacto após patch inválido (${v} → ${countsAfterInvalid[k as keyof Counts]})`,
    )
  }
  // O banco segue utilizável: um run dev canônico conclui normalmente
  const runAfterInvalid = runSeed({ NODE_ENV: "development" })
  expect(
    runAfterInvalid.status === 0,
    `run dev canônico pós-recusa conclui exit 0 (obtido ${runAfterInvalid.status})`,
  )
  const countsAfterRecovery = await getCounts()
  expect(
    countsAfterRecovery.categories === CATEGORY_SPEC.length,
    `árvore canônica restaurada após o fluxo (${countsAfterRecovery.categories} categorias)`,
  )

  console.log(
    `\n📊 Resultados: ${rep.passed} passed, ${rep.failed} failed, ${rep.total} total (esperado ${EXPECTED_TOTAL} derivado)`,
  )

  // ── Count guard (runtime) ──────────────────────────────────────────────
  // O total REAL impresso acima deve bater com o esperado DERIVADO
  // (EXPECTED_TOTAL = deriveExpectedChecks("dev")). Se a derivação ficar
  // desatualizada em relação ao código (novo loop dirigido por dados, novo
  // helper com asserções, etc.), o E2E falha aqui com mensagem clara — e o
  // guard estático scripts/check-e2e-counts.mjs compara a derivação com os
  // comentários dos workflows (seed-guards.yml / pr-check.yml /
  // validate-seed-guards-matrix-local.sh).
  if (rep.total !== EXPECTED_TOTAL) {
    console.error(
      `\n💥 COUNT DRIFT: o E2E produziu ${rep.total} checks, mas a derivação espera ${EXPECTED_TOTAL}. ` +
        `Atualize a derivação em scripts/seed-e2e-count.ts (ou as asserções) E os comentários dos workflows (ver scripts/check-e2e-counts.mjs).`,
    )
    await db.$disconnect()
    process.exit(1)
  }

  await db.$disconnect()
  process.exit(rep.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error("💥 Test suite crashed:", e)
  process.exit(1)
})
