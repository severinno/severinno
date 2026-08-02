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
 *   8. RENAME mid-cycle — renomear categoria via SEED_SPEC_PATCH (renameTo):
 *      o slug muda → o upsert CRIA a linha nova e NÃO destrói a antiga
 *      (cascata de 1 nível nos filhos); dry-run detecta via printPlan
 *   9. Spec INVÁLIDO (SEED_SPEC_PATCH com nome duplicado) — o seed RECUSA
 *      com a mensagem do validateCategorySpec ANTES de qualquer escrita
 *      (fail-fast contra o banco real — counts idênticos antes/depois)
 *  10. SEED_SPEC_PATCH inválido (JSON quebrado) — o SPEC é derivado NO TOPO
 *      do módulo (`const SPEC = buildPatchedSpec(...)` no prisma/seed-prod.ts),
 *      então um JSON malformado lança 'SEED_SPEC_PATCH inválido (JSON): ...'
 *      DURANTE a avaliação do módulo, antes de main() e antes de qualquer
 *      upsert — zero-escrita comprovada nas 3 tabelas; banco segue utilizável
 *      (um run canônico conclui normalmente após a recusa)
 *  11. SEED_SPEC_PATCH com nome DESCONHECIDO (JSON válido) — entradas fora do
 *      spec são IGNORADAS sem erro: o buildPatchedSpec casa por NOME, então
 *      um name que não existe no CATEGORY_SPEC (typo, remanescente de spec
 *      antigo) não afeta nada; o seed roda NORMALMENTE (exit 0), sem recusa,
 *      sem mensagem de spec inválido e sem criar linhas novas
 *
 * O seed é executado como SUBPROCESSO (`bun prisma/seed-prod.ts`) — o mesmo
 * caminho do CI — para validar o script real, não uma importação em memória.
 */

import { spawnSync } from "node:child_process"
import { PrismaClient } from "@prisma/client"
import { CATEGORY_SPEC, DEFAULT_SETTINGS, categorySlug } from "../prisma/seed-data"
import { createReporter, validateTree } from "./seed-e2e-common"
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
// ok/bad are used internally by validateTree/assertPatchedUpdatePlan via `rep`;
// the E2E bodies only assert directly with expect()
const { expect } = rep

// ── Count guard (fonte da verdade DERIVADA) ─────────────────────────────
// Total de checks que este E2E produz — DERIVADO do código pela
// scripts/seed-e2e-count.ts (sites de asserção no source + expansão de
// loops + validateTree + assertPatchedUpdatePlan), NUNCA um literal: se uma
// asserção for adicionada/removida, o total ajusta sozinho. O guard
// estático scripts/check-e2e-counts.mjs compara os comentários dos
// workflows (seed-guards.yml, pr-check.yml, validate-seed-guards-matrix-
// local.sh) com a derivação (bun scripts/seed-e2e-count.ts --json); o
// runtime check no final de main() valida que o total REAL impresso (📊
// Resultados) bate com o esperado derivado.
export const EXPECTED_TOTAL = deriveExpectedChecks("prod")

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

type Counts = {
  categories: number
  settings: number
  users: number
}

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
  await validateTree(db, rep)

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
  // buildSeedPlan derivam do MESMO helper (seed-e2e-utils → buildPatchedSpec
  // do seed-data) — sem risco de drift entre os dois.
  const { plan: planPatched, eletricaSlug, reparosSlug } = await buildPatchedUpdatePlan(db)

  // 7a. buildSeedPlan com o spec PATCHADO (estado canônico no banco)
  //     → deve acusar update (icon/order), nunca create
  assertPatchedUpdatePlan(rep, planPatched, eletricaSlug, reparosSlug)

  // 7b. Roda o seed REAL com o spec patchado
  const patchedRun = runSeed({
    NODE_ENV: "development",
    PROD_SEED_ALLOW_DEV: "1",
    SEED_SPEC_PATCH: UPDATE_PATCH,
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
  // Slugs canônicos ANTES (com o pai original) e DEPOIS (com o pai renomeado)
  // — derivados do spec pelo helper compartilhado (nunca hardcoded).
  const {
    oldSlug: eletricaParentSlug,
    newSlug: eletricidadeParentSlug,
    filhos: filhosEletrica,
    totalRename,
  } = deriveRenameContext()

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
  const filhoNovoSlug = renamedChildSlug(filhosEletrica[0])
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

  // ── 9. Spec INVÁLIDO — seed RECUSA com a mensagem do validateCategorySpec ──
  // Injeta um spec estruturalmente inválido via SEED_SPEC_PATCH e valida o
  // fail-fast do assertValidCategorySpec CONTRA o banco real: o seed recusa
  // com a mensagem do validateCategorySpec e NENHUMA linha é escrita.
  //
  // Por que nome duplicado e não "parent com typo": o hook só RENOMEIA
  // entradas existentes (renameTo cascateia nos filhos — nunca deixa parent
  // órfão), então a invalidez alcançável pelo hook é a colisão de nome:
  // renomear 'Elétrica' → 'Hidráulica' cria DOIS 'Hidráulica' no spec →
  // validateCategorySpec acusa 'nome duplicado' (mesmo fail-fast que
  // bloquearia um parent inexistente — é o mesmo assertValidCategorySpec).
  console.log("  ── Spec inválido (SEED_SPEC_PATCH com nome duplicado) ──")

  // 9a. Injetar o spec inválido (renameTo cria nome duplicado 'Hidráulica')
  const INVALID_PATCHES = [{ name: "Elétrica", renameTo: "Hidráulica" }]
  const INVALID_PATCH = JSON.stringify(INVALID_PATCHES)
  const countsBeforeInvalid = await getCounts()

  // 9b. Seed REAL com o spec inválido → deve RECUSAR (exit ≠ 0) com a
  //     mensagem do validateCategorySpec, ANTES de qualquer escrita.
  const invalidRun = runSeed({
    NODE_ENV: "development",
    PROD_SEED_ALLOW_DEV: "1",
    SEED_SPEC_PATCH: INVALID_PATCH,
  })
  expect(invalidRun.status !== 0, `seed recusa com spec inválido (exit ${invalidRun.status})`)
  expect(
    invalidRun.out.includes("CATEGORY_SPEC inválido"),
    "recusa com a mensagem do validateCategorySpec (CATEGORY_SPEC inválido)",
  )
  expect(
    invalidRun.out.includes("nome duplicado 'Hidráulica'"),
    "mensagem aponta o problema estrutural (nome duplicado 'Hidráulica')",
  )
  expect(
    !invalidRun.out.includes("upsert de categorias"),
    "seed não chegou à fase de escrita (fail-fast antes do upsert)",
  )

  // 9c. NENHUMA escrita no banco real — counts idênticos antes/depois
  const countsAfterInvalid = await getCounts()
  expect(
    countsAfterInvalid.categories === countsBeforeInvalid.categories &&
      countsAfterInvalid.settings === countsBeforeInvalid.settings &&
      countsAfterInvalid.users === countsBeforeInvalid.users,
    `nenhuma escrita no banco real (cats ${countsBeforeInvalid.categories}→${countsAfterInvalid.categories}, settings ${countsBeforeInvalid.settings}→${countsAfterInvalid.settings}, users ${countsBeforeInvalid.users}→${countsAfterInvalid.users})`,
  )

  // ── 10. SEED_SPEC_PATCH inválido (JSON quebrado) — fail-fast ANTES de ────
  // qualquer escrita. No seed-prod, `const SPEC = buildPatchedSpec(...)` roda
  // NO TOPO do módulo (linha ~81 do prisma/seed-prod.ts) e o gate do patch usa
  // o MESMO override do guard (PROD_SEED_ALLOW_DEV=1) — com override + JSON
  // malformado, o throw `SEED_SPEC_PATCH inválido (JSON): ...` ocorre DURANTE
  // a avaliação do módulo, antes de main() e antes de qualquer upsert. Este
  // cenário exercita o throw real do buildPatchedSpec no caminho real
  // (subprocesso) e prova zero-escrita comparando as 3 tabelas.
  console.log("  ── SEED_SPEC_PATCH inválido (JSON quebrado — fail-fast) ──")

  const countsBeforeBroken = await getCounts()
  const brokenRun = runSeed({
    NODE_ENV: "development",
    PROD_SEED_ALLOW_DEV: "1",
    SEED_SPEC_PATCH: "{não é json",
  })
  expect(brokenRun.status !== 0, `seed-prod recusa com patch inválido (exit ${brokenRun.status})`)
  expect(
    brokenRun.out.includes("SEED_SPEC_PATCH inválido (JSON)"),
    "mensagem de JSON inválido presente (throw do buildPatchedSpec)",
  )
  expect(
    !brokenRun.out.includes("Seed de produção concluído"),
    "não reporta sucesso no meio da recusa",
  )
  // Zero-escrita: as 3 tabelas idênticas (o throw é no topo do módulo, nem o
  // upsert chegou a rodar)
  const countsAfterBroken = await getCounts()
  for (const [k, v] of Object.entries(countsBeforeBroken)) {
    expect(
      countsAfterBroken[k as keyof Counts] === v,
      `'${k}' intacto após patch inválido (${v} → ${countsAfterBroken[k as keyof Counts]})`,
    )
  }
  // O banco segue utilizável: um run canônico conclui normalmente e NÃO
  // altera nada. ATENÇÃO: NÃO comparar com CATEGORY_SPEC.length aqui — o seed
  // prod é um upsert NÃO-destrutivo (linhas fora do spec persistem, ex.: as
  // linhas renomeadas do cenário 8), então a árvore real tem mais linhas que
  // o spec. O contrato correto é ESTABILIDADE em relação ao estado pré-recusa.
  const runAfterBroken = runSeed({ NODE_ENV: "development", PROD_SEED_ALLOW_DEV: "1" })
  expect(
    runAfterBroken.status === 0,
    `run canônico pós-recusa conclui exit 0 (obtido ${runAfterBroken.status})`,
  )
  const countsAfterRecovery = await getCounts()
  expect(
    countsAfterRecovery.categories === countsBeforeBroken.categories &&
      countsAfterRecovery.settings === countsBeforeBroken.settings &&
      countsAfterRecovery.users === countsBeforeBroken.users,
    `árvore inalterada pelo fluxo de recusa (cats ${countsBeforeBroken.categories}→${countsAfterRecovery.categories}, settings ${countsBeforeBroken.settings}→${countsAfterRecovery.settings}, users ${countsBeforeBroken.users}→${countsAfterRecovery.users})`,
  )

  // ── 11. SEED_SPEC_PATCH com nome DESCONHECIDO — entradas fora do spec ───
  // são IGNORADAS sem erro. JSON VÁLIDO, mas o name não existe no
  // CATEGORY_SPEC (typo de "Elétrica", ou categoria que ainda não existe).
  // O buildPatchedSpec casa por NOME — entradas sem correspondência não
  // afetam nada (nem icon/order, nem renameTo). Contraste com o cenário 10
  // (JSON quebrado → recusa) e com o 9 (spec estruturalmente inválido →
  // recusa): aqui NÃO há erro, o seed roda normalmente e NADA é criado.
  console.log("  ── SEED_SPEC_PATCH com nome desconhecido (ignorado sem erro) ──")

  // Patch com 2 entradas desconhecidas: um typo ("Elétricaa" não casa com
  // "Elétrica") e um nome que não existe no spec com renameTo — nenhuma deve
  // ter efeito (nem criar linha, nem renomear nada).
  const UNKNOWN_NAME_PATCH = JSON.stringify([
    { name: "Elétricaa", icon: "ghost" },
    { name: "Categoria Fantasma", renameTo: "Outra Fantasma" },
  ])
  const countsBeforeUnknown = await getCounts()
  const unknownRun = runSeed({
    NODE_ENV: "development",
    PROD_SEED_ALLOW_DEV: "1",
    SEED_SPEC_PATCH: UNKNOWN_NAME_PATCH,
  })
  expect(
    unknownRun.status === 0,
    `patch com nome desconhecido NÃO recusa (exit ${unknownRun.status})`,
  )
  expect(
    !unknownRun.out.includes("CATEGORY_SPEC inválido"),
    "sem mensagem de spec inválido (entradas desconhecidas são ignoradas)",
  )
  expect(
    unknownRun.out.includes("Seed de produção concluído"),
    "seed conclui NORMALMENTE com o patch desconhecido",
  )
  const countsAfterUnknown = await getCounts()
  expect(
    countsAfterUnknown.categories === countsBeforeUnknown.categories &&
      countsAfterUnknown.settings === countsBeforeUnknown.settings &&
      countsAfterUnknown.users === countsBeforeUnknown.users,
    `nenhuma linha criada pelo patch desconhecido (cats ${countsBeforeUnknown.categories}→${countsAfterUnknown.categories}, settings ${countsBeforeUnknown.settings}→${countsAfterUnknown.settings}, users ${countsBeforeUnknown.users}→${countsAfterUnknown.users})`,
  )
  // A categoria "fantasma" do patch NÃO foi criada no banco (o spec derivado
  // ignora entradas desconhecidas — nada entra no upsert).
  const ghostRow = await db.category.findUnique({ where: { slug: "categoria-fantasma" } })
  expect(ghostRow === null, "categoria desconhecida não é criada no banco")

  console.log(
    `\n📊 Resultados: ${rep.passed} passed, ${rep.failed} failed, ${rep.total} total (esperado ${EXPECTED_TOTAL} derivado)`,
  )

  // ── Count guard (runtime) ──────────────────────────────────────────────
  // O total REAL impresso acima deve bater com o esperado DERIVADO
  // (EXPECTED_TOTAL = deriveExpectedChecks("prod")). Se a derivação ficar
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
