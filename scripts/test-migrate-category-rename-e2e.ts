/**
 * E2E test for scripts/migrate-category-rename.mjs against an ephemeral
 * PostGIS database.
 *
 * Fecha o ciclo da renomeação SEGURA de categoria: antes a migração era só
 * documentada (seed-prod header) — agora há um script automatizado e este
 * E2E prova que ele funciona contra o banco real:
 *   1. Guard: recusa sem NODE_ENV=production e sem PROD_SEED_ALLOW_DEV=1
 *   2. Guard: recusa com --from inexistente
 *   3. Dry-run: não escreve nada (counts inalterados)
 *   4. Renomeia "Elétrica" → "Eletricidade": cria nova linha com slug canônico
 *      "eletricidade-reparos", re-aponta os 3 filhos (parentId + slug
 *      corrigido para embutir o novo slug do pai), NENHUM service direto na
 *      antiga, e desativa a linha antiga
 *   5. Renomeia uma subcategoria COM services ("Desentupimento" → "Desentupimento
 *      profissional"): re-aponta o service e corrige o slug do filho
 *   6. Re-run da mesma migração recusa (nome já igual — "nada para renomear")
 *      sem corromper nada
 *   6b. Guard de colisão de slug: migrar "Pintura" → "Eletricidade" recusa com
 *      "Já existe uma categoria" (slug 'eletricidade-reparos' já ocupado pela
 *      linha migrada) e NÃO toca em nada
 *   7. A árvore resultante é consistente: categorySlug(seed-data) casa com
 *      todos os slugs das linhas migradas
 *   8. MOVE-ONLY (--move-to sem --to): "Pintura" → parent "Reforma" — nome
 *      preservado, slug muda só pelo parent novo ("pintura-reforma"), filhos
 *      re-apontados SEM mudar o slug (embutem o NOME do pai, inalterado),
 *      antiga desativada. Valida o fix de colisão falsa dos filhos.
 *   9. MOVE + RENAME (--to + --move-to): "Pisos" → "Pisos e revestimentos"
 *      sob "Reparos" — slug novo embute o parent novo, filhos com slug novo
 *   10. Guards --move-to: raiz não pode ser movida; parent inexistente;
 *      ciclo (mover um pai para baixo do próprio filho)
 *
 * O script é executado como SUBPROCESSO (`node scripts/migrate-category-rename.mjs`)
 * — o mesmo caminho do operador em produção.
 *
 * Usage:
 *   DATABASE_URL="postgresql://severinno:severinno_test@localhost:5433/severinno_test" \
 *   PROD_SEED_ALLOW_DEV=1 bun scripts/test-migrate-category-rename-e2e.ts
 *   (orchestrated by scripts/test-migrate-category-rename-e2e.sh)
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — at least one check failed (or the suite crashed)
 */

import { spawnSync } from "node:child_process"
import { PrismaClient } from "@prisma/client"
import { CATEGORY_SPEC, categorySlug } from "../prisma/seed-data"

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

/** Roda scripts/migrate-category-rename.mjs como subprocesso (mesmo caminho do operador). */
function runMigration(
  args: string[],
  overrides: Record<string, string> = {},
): { status: number | null; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL }
  Object.assign(env, overrides)
  const res = spawnSync("node", ["scripts/migrate-category-rename.mjs", ...args], {
    env,
    encoding: "utf8",
    cwd: process.cwd(),
  })
  return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` }
}

type Counts = { categories: number; services: number; activeCategories: number }

async function getCounts(): Promise<Counts> {
  const [categories, services, activeCategories] = await Promise.all([
    db.category.count(),
    db.service.count(),
    db.category.count({ where: { active: true } }),
  ])
  return { categories, services, activeCategories }
}

/** Busca categoria por slug e valida os campos essenciais. */
async function findCat(slug: string) {
  return db.category.findUnique({ where: { slug } })
}

async function main() {
  console.log("🧪 E2E — migrate-category-rename.mjs contra PostGIS efêmero\n")

  const before = await getCounts()
  expect(before.categories > 0, `banco populado pelo seed dev (${before.categories} categorias)`)

  // ── 1. Guard: recusa sem produção ─────────────────────────────────────
  console.log("  ── Guard (recusa fora de produção) ──")
  const noProd = runMigration(["--from", "eletrica-reparos", "--to", "Eletricidade", "--yes"], {
    PROD_SEED_ALLOW_DEV: "0",
    NODE_ENV: "development",
  })
  expect(noProd.status !== 0, `recusa sem produção (exit ${noProd.status})`)
  expect(noProd.out.includes("Migração recusada"), "mensagem de recusa presente")
  const afterGuard = await getCounts()
  expect(
    afterGuard.categories === before.categories,
    `guard não escreve nada (${before.categories} → ${afterGuard.categories})`,
  )

  // ── 2. Guard: --from inexistente ──────────────────────────────────────
  console.log("  ── Guard (categoria inexistente) ──")
  const missing = runMigration(["--from", "nao-existe-xyz", "--to", "Qualquer", "--yes"], {
    PROD_SEED_ALLOW_DEV: "1",
    NODE_ENV: "development",
  })
  expect(missing.status !== 0, `recusa com --from inexistente (exit ${missing.status})`)
  expect(missing.out.includes("Categoria não encontrada"), "mensagem de não encontrada presente")

  // ── 3. Dry-run: não escreve ───────────────────────────────────────────
  console.log("  ── Dry-run (nenhuma escrita) ──")
  const dry = runMigration(["--from", "eletrica-reparos", "--to", "Eletricidade", "--dry-run"], {
    PROD_SEED_ALLOW_DEV: "1",
    NODE_ENV: "development",
  })
  expect(dry.status === 0, `dry-run conclui com exit 0 (obtido ${dry.status})`)
  expect(dry.out.includes("DRY-RUN"), "confirmação de dry-run presente")
  const afterDry = await getCounts()
  expect(
    afterDry.categories === before.categories && afterDry.services === before.services,
    `dry-run não escreve nada (${before.categories}/${before.services} → ${afterDry.categories}/${afterDry.services})`,
  )

  // ── 4. Renomeia "Elétrica" → "Eletricidade" (pai com 3 filhos) ────────
  console.log("  ── Migração 1: Elétrica → Eletricidade (3 filhos) ──")
  const mig1 = runMigration(["--from", "eletrica-reparos", "--to", "Eletricidade", "--yes"], {
    PROD_SEED_ALLOW_DEV: "1",
    NODE_ENV: "development",
  })
  expect(mig1.status === 0, `migração 1 conclui exit 0 (obtido ${mig1.status})`)

  const nova = await findCat("eletricidade-reparos")
  expect(nova !== null, "nova linha 'Eletricidade' criada com slug 'eletricidade-reparos'")
  if (nova) {
    expect(nova.active === true, "nova linha ativa")
    expect(nova.level === 1, `level 1 preservado (obtido ${nova.level})`)
    expect(nova.parentId !== null, "parent preservado")
    expect(nova.icon === "zap", "icon preservado (zap)")
  }
  const antiga = await findCat("eletrica-reparos")
  expect(antiga !== null, "linha antiga 'Elétrica' ainda existe (nunca apagada)")
  if (antiga) {
    expect(antiga.active === false, "linha antiga desativada (active=false)")
  }

  // Filhos re-apontados + slug corrigido (embutem o slug do pai)
  const filhos = await db.category.findMany({
    where: { parentId: nova?.id ?? "none" },
    orderBy: { name: "asc" },
  })
  expect(filhos.length === 3, `3 filhos re-apontados para a nova linha (obtido ${filhos.length})`)
  for (const nome of ["Tomadas e interruptores", "Curto-circuito", "Quadro elétrico"]) {
    const filho = await findCat(categorySlug({ name: nome, parent: "Eletricidade", level: 2 }))
    expect(
      filho !== null && filho.parentId === nova?.id,
      `filho '${nome}' com slug canônico novo e parent correto`,
    )
  }

  const afterMig1 = await getCounts()
  expect(
    afterMig1.categories === before.categories + 1,
    `+1 categoria (${before.categories} → ${afterMig1.categories})`,
  )
  expect(
    afterMig1.categories === CATEGORY_SPEC.length + 1,
    `total = CATEGORY_SPEC.length + 1 (${CATEGORY_SPEC.length} + 1 = ${afterMig1.categories})`,
  )
  expect(
    afterMig1.activeCategories === before.activeCategories,
    `categorias ativas estáveis (${before.activeCategories} → ${afterMig1.activeCategories})`,
  )

  // ── 5. Renomeia subcategoria COM service ("Desentupimento") ───────────
  console.log("  ── Migração 2: Desentupimento → Desentupimento profissional (1 service) ──")
  const desentupimento = await findCat("desentupimento-hidraulica")
  expect(desentupimento !== null, "subcategoria 'Desentupimento' existe")
  if (desentupimento) {
    const servicesBefore = await db.service.count({ where: { categoryId: desentupimento.id } })
    expect(servicesBefore >= 1, `'Desentupimento' tem ${servicesBefore} service(s) direto(s)`)
  }

  const mig2 = runMigration(
    ["--from", "desentupimento-hidraulica", "--to", "Desentupimento profissional", "--yes"],
    { PROD_SEED_ALLOW_DEV: "1", NODE_ENV: "development" },
  )
  expect(mig2.status === 0, `migração 2 conclui exit 0 (obtido ${mig2.status})`)

  const novaDesc = await findCat("desentupimento-profissional-hidraulica")
  expect(novaDesc !== null, "nova linha 'Desentupimento profissional' criada")
  if (novaDesc && desentupimento) {
    const servicesAfter = await db.service.count({ where: { categoryId: novaDesc.id } })
    const servicesOld = await db.service.count({ where: { categoryId: desentupimento.id } })
    expect(
      servicesAfter >= 1 && servicesOld === 0,
      `service re-apontado (novo: ${servicesAfter}, antigo: ${servicesOld})`,
    )
  }

  const afterMig2 = await getCounts()
  expect(
    afterMig2.categories === afterMig1.categories + 1,
    `+1 categoria na migração 2 (${afterMig1.categories} → ${afterMig2.categories})`,
  )

  // ── 6b. Guard de colisão de slug: migrar "Pintura" → "Eletricidade" ─────
  // Pintura (level 1, parent Reparos) teria slug canônico "eletricidade-reparos"
  // — que JÁ pertence à linha migrada na migração 1. O guard "Já existe uma
  // categoria" deve recusar ANTES de qualquer escrita (zero corrupção).
  console.log("  ── Guard de colisão de slug (Pintura → Eletricidade) ──")
  const collision = runMigration(["--from", "pintura-reparos", "--to", "Eletricidade", "--yes"], {
    PROD_SEED_ALLOW_DEV: "1",
    NODE_ENV: "development",
  })
  expect(collision.status !== 0, `colisão de slug recusa (exit ${collision.status})`)
  expect(collision.out.includes("Já existe uma categoria"), "mensagem de conflito de slug presente")
  const afterCollision = await getCounts()
  expect(
    afterCollision.categories === afterMig2.categories,
    `colisão não corrompe nada (${afterMig2.categories} → ${afterCollision.categories})`,
  )
  const pinturaIntacta = await findCat("pintura-reparos")
  expect(
    pinturaIntacta !== null && pinturaIntacta.active === true,
    "'Pintura' intacta (active=true)",
  )

  // ── 6. Idempotência: re-rodar a mesma migração é recusado sem corromper ──
  // Após a migração 1, a linha 'eletricidade-reparos' JÁ É a nova "Eletricidade".
  // Re-rodar --from eletricidade-reparos --to Eletricidade encontra a linha já
  // renomeada → o script recusa com "nada para renomear" (slug igual), não
  // duplica nada. O slug 'eletricidade-reparos' agora pertence à nova linha,
  // então o guard de colisão ("Já existe uma categoria") NÃO é o caminho — o
  // guard de nome-igual é. Ambos protegem; o cenário real aqui é o idempotente.
  console.log("  ── Idempotência (re-run da migração 1) ──")
  const rerun = runMigration(["--from", "eletricidade-reparos", "--to", "Eletricidade", "--yes"], {
    PROD_SEED_ALLOW_DEV: "1",
    NODE_ENV: "development",
  })
  expect(rerun.status !== 0, `re-run recusa (exit ${rerun.status})`)
  expect(
    rerun.out.includes("nada para renomear"),
    "mensagem de nome-igual presente (nada para renomear)",
  )
  const afterRerun = await getCounts()
  expect(
    afterRerun.categories === afterCollision.categories,
    `re-run não corrompe nada (${afterCollision.categories} → ${afterRerun.categories})`,
  )

  // ── 8. MOVE-ONLY (--move-to sem --to): Pintura → parent Reforma ──────
  // "Pintura" está intacta (pintura-reparos, active=true). Move para baixo
  // de "Reforma" (level 0) preservando o NOME: o slug muda só pelo parent
  // novo ("pintura-reforma"). Os 3 filhos mantêm o slug (embutem o NOME
  // "Pintura", inalterado) — valida o fix de colisão falsa do guard.
  console.log("  ── Migração 3: Pintura → parent Reforma (--move-to, nome preservado) ──")
  const reforma = await findCat("reforma")
  expect(reforma !== null, "parent 'Reforma' existe")
  const mig3 = runMigration(["--from", "pintura-reparos", "--move-to", "reforma", "--yes"], {
    PROD_SEED_ALLOW_DEV: "1",
    NODE_ENV: "development",
  })
  expect(mig3.status === 0, `migração 3 (move-only) exit 0 (obtido ${mig3.status})`)
  expect(mig3.out.includes("MOVE"), "plano mostra a linha MOVE (troca de parent)")

  const pinturaNova = await findCat("pintura-reforma")
  expect(pinturaNova !== null, "nova linha 'Pintura' criada sob 'Reforma' (slug 'pintura-reforma')")
  if (pinturaNova && reforma) {
    expect(pinturaNova.active === true, "nova linha ativa")
    expect(pinturaNova.level === 1, `level 1 preservado (obtido ${pinturaNova.level})`)
    expect(pinturaNova.parentId === reforma.id, "parentId aponta para 'Reforma'")
  }
  const pinturaAntiga = await findCat("pintura-reparos")
  expect(
    pinturaAntiga !== null && pinturaAntiga.active === false,
    "linha antiga 'pintura-reparos' desativada",
  )

  // Filhos re-apontados SEM mudar o slug (embutem o NOME 'Pintura')
  const filhosPintura = await db.category.findMany({
    where: { parentId: pinturaNova?.id ?? "none" },
    orderBy: { name: "asc" },
  })
  expect(filhosPintura.length === 3, `3 filhos re-apontados (obtido ${filhosPintura.length})`)
  for (const nome of ["Pintura interna", "Pintura externa", "Textura e grafiato"]) {
    const filho = await findCat(categorySlug({ name: nome, parent: "Pintura", level: 2 }))
    expect(
      filho !== null && filho.parentId === pinturaNova?.id,
      `filho '${nome}' re-apontado com slug INALTERADO (embute o nome 'Pintura')`,
    )
  }

  const afterMig3 = await getCounts()
  expect(
    afterMig3.categories === afterRerun.categories + 1,
    `+1 categoria na migração 3 (${afterRerun.categories} → ${afterMig3.categories})`,
  )

  // ── 9. MOVE + RENAME (--to + --move-to): Pisos → 'Pisos e revestimentos' ──
  // Move "Pisos" de "Reforma" para "Reparos" E renomeia: slug novo embute
  // o parent novo ("pisos-e-revestimentos-reparos"), filhos com slug novo
  // (embutem o nome novo 'Pisos e revestimentos').
  console.log("  ── Migração 4: Pisos → 'Pisos e revestimentos' sob Reparos (--to + --move-to) ──")
  const reparos = await findCat("reparos")
  expect(reparos !== null, "parent 'Reparos' existe")
  const mig4 = runMigration(
    ["--from", "pisos-reforma", "--to", "Pisos e revestimentos", "--move-to", "reparos", "--yes"],
    { PROD_SEED_ALLOW_DEV: "1", NODE_ENV: "development" },
  )
  expect(mig4.status === 0, `migração 4 (move+rename) exit 0 (obtido ${mig4.status})`)

  const pisosNova = await findCat("pisos-e-revestimentos-reparos")
  expect(
    pisosNova !== null,
    "nova linha 'Pisos e revestimentos' criada sob 'Reparos' (slug 'pisos-e-revestimentos-reparos')",
  )
  if (pisosNova && reparos) {
    expect(pisosNova.active === true, "nova linha ativa")
    expect(pisosNova.level === 1, `level 1 preservado (obtido ${pisosNova.level})`)
    expect(pisosNova.parentId === reparos.id, "parentId aponta para 'Reparos'")
  }
  const pisosAntiga = await findCat("pisos-reforma")
  expect(
    pisosAntiga !== null && pisosAntiga.active === false,
    "linha antiga 'pisos-reforma' desativada",
  )

  // Filhos com slug NOVO (embutem o nome novo 'Pisos e revestimentos')
  const filhosPisos = await db.category.findMany({
    where: { parentId: pisosNova?.id ?? "none" },
    orderBy: { name: "asc" },
  })
  expect(filhosPisos.length === 2, `2 filhos re-apontados (obtido ${filhosPisos.length})`)
  for (const nome of ["Assentamento de piso", "Rejunte"]) {
    const filho = await findCat(
      categorySlug({ name: nome, parent: "Pisos e revestimentos", level: 2 }),
    )
    expect(
      filho !== null && filho.parentId === pisosNova?.id,
      `filho '${nome}' re-apontado com slug NOVO (embute o nome novo)`,
    )
  }

  const afterMig4 = await getCounts()
  expect(
    afterMig4.categories === afterMig3.categories + 1,
    `+1 categoria na migração 4 (${afterMig3.categories} → ${afterMig4.categories})`,
  )

  // ── 10. Guards --move-to ───────────────────────────────────────────────
  console.log("  ── Guards --move-to ──")
  // 10a. Raiz (level 0) não pode ser movida para baixo de um parent
  const moveRoot = runMigration(["--from", "reparos", "--move-to", "limpeza", "--yes"], {
    PROD_SEED_ALLOW_DEV: "1",
    NODE_ENV: "development",
  })
  expect(moveRoot.status !== 0, `mover raiz recusa (exit ${moveRoot.status})`)
  expect(moveRoot.out.includes("raiz não pode ser movida"), "mensagem de raiz presente")

  // 10b. Parent de destino inexistente
  const moveMissing = runMigration(
    ["--from", "pintura-reforma", "--move-to", "nao-existe-xyz", "--yes"],
    { PROD_SEED_ALLOW_DEV: "1", NODE_ENV: "development" },
  )
  expect(moveMissing.status !== 0, `--move-to inexistente recusa (exit ${moveMissing.status})`)
  expect(
    moveMissing.out.includes("Parent de destino não encontrado"),
    "mensagem de parent inexistente presente",
  )

  // 10c. Ciclo: mover um pai para baixo do PRÓPRIO filho
  // 'Eletricidade' (criada na migração 1) tem filho 'Tomadas e interruptores'.
  // Mover a Eletricidade para baixo do filho criaria um ciclo — o walk-up
  // pelo parentId do destino encontra a própria categoria.
  const moveCycle = runMigration(
    [
      "--from",
      "eletricidade-reparos",
      "--move-to",
      "tomadas-e-interruptores-eletricidade",
      "--yes",
    ],
    { PROD_SEED_ALLOW_DEV: "1", NODE_ENV: "development" },
  )
  expect(moveCycle.status !== 0, `mover para descendente recusa (exit ${moveCycle.status})`)
  expect(moveCycle.out.includes("ciclo"), "mensagem de ciclo presente")

  const afterGuards = await getCounts()
  expect(
    afterGuards.categories === afterMig4.categories,
    `guards --move-to não corrompem nada (${afterMig4.categories} → ${afterGuards.categories})`,
  )

  // ── 7. Consistência: slugs canônicos batem com o seed-data ────────────
  console.log("  ── Consistência da árvore migrada ──")
  const migradas = [
    "eletricidade-reparos",
    "desentupimento-profissional-hidraulica",
    "pintura-reforma",
    "pisos-e-revestimentos-reparos",
  ]
  for (const slug of migradas) {
    const c = await findCat(slug)
    if (c) {
      const parent = c.parentId ? await db.category.findUnique({ where: { id: c.parentId } }) : null
      expect(
        c.slug ===
          categorySlug({ name: c.name, parent: parent?.name ?? undefined, level: c.level }),
        `slug '${slug}' consistente com a regra canônica`,
      )
    }
  }

  // ── Resumo ────────────────────────────────────────────────────────────
  console.log("")
  console.log(`📊 Resultados: ${passed} passed, ${failed} failed, ${passed + failed} total`)
  await db.$disconnect()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error("❌ E2E crashou:", e)
  process.exit(1)
})
