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
 *   7. UPDATE mid-cycle — alterar icon/order no spec (SEED_SPEC_PATCH) e
 *      re-rodar: buildSeedPlan + upsert convergem para o novo estado SEM
 *      duplicar linhas; re-run canônico restaura os valores originais
 *
 * O seed é executado como SUBPROCESSO (`bun prisma/seed-prod.ts`) — o mesmo
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
  await validateTree(db, { ok, bad, expect })

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

  // ── 7. UPDATE mid-cycle — spec muda (icon/order), converge sem duplicar ─
  // Altera icon/order de categorias no spec via SEED_SPEC_PATCH (hook de
  // teste inerte em produção — só aplica com PROD_SEED_ALLOW_DEV=1) e
  // re-roda o seed: buildSeedPlan + upsert devem convergir para o NOVO
  // estado com 0 creates e MESMOS counts (nenhuma linha duplicada).
  console.log("  ── Update mid-cycle (SEED_SPEC_PATCH: icon + order) ──")

  // Patch: Elétrica troca o icon (zap → bolt); Reparos ganha order explícito 5
  // Fonte única: o JSON enviado ao seed (SEED_SPEC_PATCH) e o spec usado no
  // buildSeedPlan derivam do MESMO array — sem risco de drift entre os dois.
  const PATCHES: { name: string; icon?: string; order?: number }[] = [
    { name: "Elétrica", icon: "bolt" },
    { name: "Reparos", order: 5 },
  ]
  const PATCH = JSON.stringify(PATCHES)

  // 7a. buildSeedPlan com o spec PATCHADO (estado canônico no banco)
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

  // 7b. Roda o seed REAL com o spec patchado
  const patchedRun = runSeed({
    NODE_ENV: "development",
    PROD_SEED_ALLOW_DEV: "1",
    SEED_SPEC_PATCH: PATCH,
  })
  expect(
    patchedRun.status === 0,
    `seed com spec patchado conclui exit 0 (obtido ${patchedRun.status})`,
  )

  // 7c. Convergiu para o NOVO estado sem duplicar linhas
  const afterPatch = await getCounts()
  expect(
    afterPatch.categories === afterSecond.categories,
    `nenhuma linha duplicada (cats ${afterSecond.categories} → ${afterPatch.categories})`,
  )
  const elétricaRow = await db.category.findUnique({ where: { slug: eletricaSlug } })
  expect(
    elétricaRow?.icon === "bolt",
    `'Elétrica' convergiu para icon 'bolt' (obtido '${elétricaRow?.icon ?? "—"}')`,
  )
  const reparosRow = await db.category.findUnique({ where: { slug: reparosSlug } })
  expect(reparosRow?.order === 5, `'Reparos' convergiu para order 5 (obtido ${reparosRow?.order})`)

  // 7d. Re-run CANÔNICO (sem patch) restaura os valores originais
  const restoreRun = runSeed({ NODE_ENV: "development", PROD_SEED_ALLOW_DEV: "1" })
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
    afterRestore.categories === afterPatch.categories,
    `contagem estável após restauração (${afterPatch.categories} → ${afterRestore.categories})`,
  )

  // ── 8. RENAME mid-cycle — categoria renomeada (slug muda) ──────────────
  // Cenário PERIGOSO documentado no header: o slug é derivado do nome (e
  // filhos herdam o slug do pai), então renomear muda o slug → o upsert
  // CRIA a linha nova e a antiga vira órfã (services continuam apontando
  // para a antiga). O dry-run DEVE detectar via printPlan (⚠️ POSSÍVEL
  // RENOMEAÇÃO) e o seed DEVE criar a nova SEM destruir a antiga.
  console.log("  ── Rename mid-cycle (SEED_SPEC_PATCH: Elétrica → Eletricidade) ──")

  // 8a. buildSeedPlan + dry-run com o spec RENOMEADO → detecta a renomeação
  //     A detecção do printPlan funciona nos FILHOS: o nome casa com o spec,
  //     mas o slug difere (o slug do filho embute o slug do pai renomeado).
  const RENAME_PATCHES: { name: string; renameTo?: string; icon?: string; order?: number }[] = [
    { name: "Elétrica", renameTo: "Eletricidade" },
  ]
  const RENAME_PATCH = JSON.stringify(RENAME_PATCHES)

  // Slugs canônicos ANTES (com o pai original) e DEPOIS (com o pai renomeado)
  const eletricaParentSlug = categorySlug({ name: "Elétrica", parent: "Reparos", level: 1 })
  const eletricidadeParentSlug = categorySlug({
    name: "Eletricidade",
    parent: "Reparos",
    level: 1,
  })
  const filhosEletrica = CATEGORY_SPEC.filter((c) => c.parent === "Elétrica")
  const totalRename = 1 + filhosEletrica.length // pai renomeado + filhos (cascata)

  const renameDry = runSeed(
    {
      NODE_ENV: "development",
      PROD_SEED_ALLOW_DEV: "1",
      SEED_SPEC_PATCH: RENAME_PATCH,
    },
    ["--dry-run"],
  )
  expect(renameDry.status === 0, `dry-run com rename conclui exit 0 (obtido ${renameDry.status})`)
  expect(
    renameDry.out.includes("POSSÍVEL RENOMEAÇÃO"),
    "dry-run detecta renomeação via printPlan (⚠️ POSSÍVEL RENOMEAÇÃO)",
  )
  expect(
    renameDry.out.includes("Eletricidade") && renameDry.out.includes(eletricidadeParentSlug),
    `dry-run mostra a renomeação com slug novo '${eletricidadeParentSlug}'`,
  )

  // 8b. Roda o seed REAL com o rename → CRIA a linha nova SEM destruir a antiga
  const countsBeforeRename = await getCounts()
  const renameRun = runSeed({
    NODE_ENV: "development",
    PROD_SEED_ALLOW_DEV: "1",
    SEED_SPEC_PATCH: RENAME_PATCH,
  })
  expect(renameRun.status === 0, `seed com rename conclui exit 0 (obtido ${renameRun.status})`)
  const afterRename = await getCounts()
  expect(
    afterRename.categories === countsBeforeRename.categories + totalRename,
    `rename cria ${totalRename} linha(s) nova(s) em cascata (${countsBeforeRename.categories} → ${afterRename.categories})`,
  )

  // Linha NOVA existe com o slug renomeado
  const eletricidadeRow = await db.category.findUnique({
    where: { slug: eletricidadeParentSlug },
  })
  expect(
    eletricidadeRow?.name === "Eletricidade",
    `'Eletricidade' criada com slug '${eletricidadeParentSlug}' (obtido '${eletricidadeRow?.name ?? "—"}')`,
  )
  // Linha ANTIGA continua existindo (não destruída — serviços apontam para ela)
  const eletricaOrfa = await db.category.findUnique({ where: { slug: eletricaParentSlug } })
  expect(
    eletricaOrfa?.name === "Elétrica",
    `'Elétrica' antiga PRESERVADA (slug '${eletricaParentSlug}' — órfã, não destruída)`,
  )
  // Filhos antigos preservados + filhos novos criados em cascata
  // Guard: se o spec evoluir e 'Elétrica' ficar sem filhos, o índice [0]
  // abaixo viraria TypeError em vez de falha clara de asserção.
  expect(
    filhosEletrica.length >= 1,
    `'Elétrica' precisa de filho(s) para validar a cascata de rename (obtido ${filhosEletrica.length})`,
  )
  const filhoAntigoSlug = categorySlug(filhosEletrica[0])
  const filhoNovoSpec: CategorySeedInput = {
    ...filhosEletrica[0],
    parent: "Eletricidade",
  }
  const filhoNovoSlug = categorySlug(filhoNovoSpec)
  const filhoAntigo = await db.category.findUnique({ where: { slug: filhoAntigoSlug } })
  const filhoNovo = await db.category.findUnique({ where: { slug: filhoNovoSlug } })
  expect(filhoAntigo !== null, `filho antigo '${filhoAntigoSlug}' preservado`)
  expect(filhoNovo !== null, `filho novo '${filhoNovoSlug}' criado em cascata`)

  // 8c. Re-run CANÔNICO restaura os slugs originais (Elétrica volta a existir
  //     com o slug canônico) mas NÃO remove a linha renomeada (fora do spec).
  const canonicalAfterRename = runSeed({ NODE_ENV: "development", PROD_SEED_ALLOW_DEV: "1" })
  expect(
    canonicalAfterRename.status === 0,
    `re-run canônico pós-rename conclui exit 0 (obtido ${canonicalAfterRename.status})`,
  )
  const eletricaCanonica = await db.category.findUnique({
    where: { slug: eletricaParentSlug },
  })
  expect(
    eletricaCanonica?.icon === "zap",
    `'Elétrica' restaurada para icon 'zap' (obtido '${eletricaCanonica?.icon ?? "—"}')`,
  )
  const eletricidadeExtra = await db.category.findUnique({
    where: { slug: eletricidadeParentSlug },
  })
  expect(eletricidadeExtra !== null, "linha renomeada permanece (fora do spec — seed não a remove)")
  const afterCanonicalRename = await getCounts()
  expect(
    afterCanonicalRename.categories === afterRename.categories,
    `contagem estável pós-canônico (${afterRename.categories} → ${afterCanonicalRename.categories})`,
  )

  console.log(`\n📊 Resultados: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  await db.$disconnect()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error("💥 Test suite crashed:", e)
  process.exit(1)
})
