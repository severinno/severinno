#!/usr/bin/env node
// =============================================================================
// migrate-category-rename.mjs — Renomeação SEGURA de categoria em produção
// =============================================================================
//
// Fecha o cenário PERIGOSO que hoje é só documentado no seed-prod: renomear
// uma categoria muda o slug derivado do nome, e o upsert do seed criaria uma
// NOVA linha deixando a antiga órfã — com services ainda apontando para ela.
//
// Este script faz a migração correta em UMA transação:
//   1. Cria a NOVA linha (nome novo + slug canônico derivado, copiando
//      parentId/level/icon/order/description do original)
//   2. Re-aponta os FILHOS (parentId → nova linha) e corrige o slug deles
//      (filhos EMBUTEM o slug do pai — ex.: "tomadas-e-interruptores-eletrica"
//      vira "tomadas-e-interruptores-eletricidade")
//   3. Re-aponta os SERVICES (categoryId → nova linha)
//   4. Desativa a linha ANTIGA (active = false) — nunca apaga (FK Restrict
//      do Service e histórico de bookings/quotes apontam para a linha)
//
// Resultado: a árvore fica 100% consistente com o CATEGORY_SPEC canônico —
// um re-run do seed-prod dry-run NÃO acusa mais renomeação pendente.
//
// Guard: igual ao seed-prod (isProdSeedAllowed) — exige NODE_ENV=production
// ou PROD_SEED_ALLOW_DEV=1 (banco efêmero/CI).
//
// Usage:
//   node scripts/migrate-category-rename.mjs --from <slug|nome> --to <novo-nome>
//   node scripts/migrate-category-rename.mjs --from <slug|nome> --move-to <slug-do-pai>
//   node scripts/migrate-category-rename.mjs --from <slug|nome> --to <novo-nome> --move-to <slug-do-pai>
//   node scripts/migrate-category-rename.mjs --from eletrica-reparos --to Eletricidade
//   node scripts/migrate-category-rename.mjs --from pintura-reparos --move-to reforma
//   node scripts/migrate-category-rename.mjs --from eletrica-reparos --to Eletricidade --dry-run
//   node scripts/migrate-category-rename.mjs --from eletrica-reparos --to Eletricidade --yes
//
// Flags:
//   --from <slug|nome>    categoria a renomear/mover (resolve por slug primeiro, depois nome exato)
//   --to   <novo-nome>    novo nome da categoria (slug derivado automaticamente). OPCIONAL se
//                         --move-to for informado (move-only preserva o nome)
//   --move-to <slug|nome> NOVO parent da categoria (resolve por slug primeiro, depois nome
//                         exato). OPCIONAL — move a categoria para outro pai além de renomear
//   --dry-run             mostra o plano SEM escrever no banco
//   --yes                 pula a confirmação interativa (CI/automação)
//   --help                mostra esta ajuda
//
// Exit codes:
//   0 — migração concluída (ou dry-run validado sem conflitos)
//   1 — erro (guard recusado, args inválidos, categoria não encontrada,
//       conflito de slug, colisão de slug de filho, confirmação negada)
// =============================================================================

import { createInterface } from "node:readline"
import { pathToFileURL } from "node:url"
import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

// True apenas quando o script é executado diretamente (node ...) — permite
// importar as funções puras (buildMigrationPlan, slugify, categorySlug) em
// testes unitários sem disparar main().
const IS_DIRECT_RUN =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

// ---------------------------------------------------------------------------
// Helpers puros (exportados para teste unitário)
// ---------------------------------------------------------------------------

/**
 * Normaliza texto para slug (mesma regra do prisma/seed-data.ts).
 * @param {string} s
 * @returns {string}
 */
export function slugify(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Slug canônico: nome + (parent ? "-" + slugify(parent) : "") — espelha
 * categorySlug do seed-data.
 * @param {string} name
 * @param {string | null | undefined} parentName
 * @returns {string}
 */
export function categorySlug(name, parentName) {
  return slugify(name) + (parentName ? "-" + slugify(parentName) : "")
}

/**
 * Monta o plano de migração (função PURA — testável sem banco).
 *
 * @typedef {Object} OldCategory
 * @property {string} id
 * @property {string | null} parentId
 * @property {number} level
 * @property {string | null} icon
 * @property {number} order
 * @property {string | null} description
 *
 * @typedef {Object} ChildCategory
 * @property {string} id
 * @property {string} name
 * @property {string} slug
 *
 * @param {{ oldCat: OldCategory, newName: string, parentName: string | null | undefined, parentId?: string | null | undefined, children?: ChildCategory[], serviceCount?: number }} params
 * @returns {{ newSlug: string, created: OldCategory & { name: string, slug: string }, children: { id: string, name: string, oldSlug: string, newSlug: string }[], serviceCount: number }}
 */
export function buildMigrationPlan({
  oldCat,
  newName,
  parentName,
  parentId,
  children = [],
  serviceCount = 0,
}) {
  const newSlug = categorySlug(newName, parentName)
  return {
    newSlug,
    created: {
      name: newName,
      slug: newSlug,
      parentId: parentId !== undefined ? parentId : oldCat.parentId,
      level: oldCat.level,
      icon: oldCat.icon,
      order: oldCat.order,
      description: oldCat.description,
    },
    children: children.map((c) => ({
      id: c.id,
      name: c.name,
      oldSlug: c.slug,
      newSlug: categorySlug(c.name, newName),
    })),
    serviceCount,
  }
}

// ---------------------------------------------------------------------------
// Parsing de args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { from: null, to: null, moveTo: null, dryRun: false, yes: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--from") args.from = argv[++i]
    else if (a === "--to") args.to = argv[++i]
    else if (a === "--move-to") args.moveTo = argv[++i]
    else if (a === "--dry-run") args.dryRun = true
    else if (a === "--yes") args.yes = true
    else if (a === "--help" || a === "-h") args.help = true
    else {
      console.error(`❌ Argumento desconhecido: ${a}`)
      process.exit(1)
    }
  }
  return args
}

const HELP = `migrate-category-rename.mjs — Renomeação/MOVIMENTAÇÃO SEGURA de categoria em produção

USO:
  node scripts/migrate-category-rename.mjs --from <slug|nome> --to <novo-nome>
  node scripts/migrate-category-rename.mjs --from <slug|nome> --move-to <slug-do-pai>
  node scripts/migrate-category-rename.mjs --from <slug|nome> --to <novo-nome> --move-to <slug-do-pai>
  node scripts/migrate-category-rename.mjs --from eletrica-reparos --to Eletricidade
  node scripts/migrate-category-rename.mjs --from pintura-reparos --move-to reforma
  node scripts/migrate-category-rename.mjs --from <slug|nome> --to <novo-nome> --dry-run
  node scripts/migrate-category-rename.mjs --from <slug|nome> --to <novo-nome> --yes

--to e --move-to são OPCIONAIS ENTRE SI (pelo menos um obrigatório):
  - --to sozinho      = renomear (comportamento original)
  - --move-to sozinho = mover para outro parent mantendo o nome
  - ambos             = renomear E mover

VALIDAÇÕES do --move-to:
  - a categoria não pode ser raiz (level 0) — raiz não tem parent
  - o parent de destino deve estar ativo
  - o parent de destino não pode ser a própria categoria nem um descendente (ciclo)
  - o parent de destino deve ter level ESTRITAMENTE menor (árvore 3 níveis)

O QUE FAZ (uma transação):
  1. Cria a NOVA linha (slug canônico derivado do novo nome)
  2. Re-aponta FILHOS (parentId) e corrige o slug deles (embutem o slug do pai)
  3. Re-aponta SERVICES (categoryId)
  4. Desativa a linha ANTIGA (active=false — nunca apaga)

GUARD: exige NODE_ENV=production ou PROD_SEED_ALLOW_DEV=1 (banco efêmero).
`

// ---------------------------------------------------------------------------
// Guard — espelha src/lib/prod-seed.ts (isProdSeedAllowed)
// ---------------------------------------------------------------------------

function isProdSeedAllowed() {
  return process.env.NODE_ENV === "production" || process.env.PROD_SEED_ALLOW_DEV === "1"
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log(HELP)
    process.exit(0)
  }

  if (!isProdSeedAllowed()) {
    console.error(
      "❌ Migração recusada: NODE_ENV deve ser 'production' (ou PROD_SEED_ALLOW_DEV=1 para banco efêmero).",
    )
    process.exit(1)
  }

  if (!args.from || (!args.to && !args.moveTo)) {
    console.error(
      "❌ Argumentos obrigatórios: --from <slug|nome> e pelo menos um de --to <novo-nome> / --move-to <slug-do-pai>",
    )
    console.error("   Use --help para a documentação completa.")
    process.exit(1)
  }

  // ── Resolve a categoria antiga (slug primeiro, depois nome exato) ────────
  const oldCat = await db.category.findFirst({
    where: { OR: [{ slug: args.from }, { name: args.from }] },
  })
  if (!oldCat) {
    console.error(`❌ Categoria não encontrada: '${args.from}' (nenhum slug nem nome exato casou).`)
    process.exit(1)
  }

  // Parent atual (para exibição e fallback de slug quando sem --move-to)
  const oldParent = oldCat.parentId
    ? await db.category.findUnique({ where: { id: oldCat.parentId } })
    : null

  // ── --move-to: resolve o parent de destino com validações ──────────────
  let newParent = null
  if (args.moveTo) {
    if (oldCat.level === 0) {
      console.error(
        `❌ '${oldCat.name}' é raiz (level 0) — raiz não pode ser movida para baixo de um parent.`,
      )
      process.exit(1)
    }
    newParent = await db.category.findFirst({
      where: { OR: [{ slug: args.moveTo }, { name: args.moveTo }] },
    })
    if (!newParent) {
      console.error(
        `❌ Parent de destino não encontrado: '${args.moveTo}' (nenhum slug nem nome exato casou).`,
      )
      process.exit(1)
    }
    if (!newParent.active) {
      console.error(
        `❌ Parent de destino '${newParent.name}' está inativo — reative antes de mover.`,
      )
      process.exit(1)
    }
    // Ciclo: o destino não pode ser a própria categoria nem um descendente dela
    // (roda ANTES do check de level para dar mensagem mais específica)
    let cursor = newParent
    const seen = new Set()
    while (cursor) {
      if (cursor.id === oldCat.id || seen.has(cursor.id)) {
        console.error(
          `❌ '${newParent.name}' é a própria categoria ou um descendente dela — mover criaria um ciclo.`,
        )
        process.exit(1)
      }
      seen.add(cursor.id)
      cursor = cursor.parentId
        ? await db.category.findUnique({ where: { id: cursor.parentId } })
        : null
    }
    if (newParent.level >= oldCat.level) {
      console.error(
        `❌ '${newParent.name}' (level ${newParent.level}) não pode ser parent de '${oldCat.name}' (level ${oldCat.level}) — o parent deve ter level estritamente menor.`,
      )
      process.exit(1)
    }
  }

  const newName = args.to ?? oldCat.name
  const finalParentId = newParent?.id ?? oldCat.parentId
  const finalParentName = newParent?.name ?? oldParent?.name ?? null

  const newSlug = categorySlug(newName, finalParentName)
  if (newSlug === oldCat.slug) {
    console.error(
      `❌ O novo slug '${newSlug}' é igual ao atual — nada para renomear/mover. ` +
        `Escolha um nome diferente de '${oldCat.name}' ou um parent diferente.`,
    )
    process.exit(1)
  }

  // ── Conflitos ─────────────────────────────────────────────────────────────
  const existing = await db.category.findUnique({ where: { slug: newSlug } })
  if (existing) {
    console.error(
      `❌ Já existe uma categoria com o slug '${newSlug}': '${existing.name}' (id ${existing.id}, active=${existing.active}).`,
    )
    console.error("   Escolha outro nome ou resolva a linha conflitante antes de migrar.")
    process.exit(1)
  }

  const children = await db.category.findMany({
    where: { parentId: oldCat.id },
    orderBy: { level: "asc" },
  })
  const serviceCount = await db.service.count({ where: { categoryId: oldCat.id } })

  const plan = buildMigrationPlan({
    oldCat,
    newName,
    parentName: finalParentName,
    parentId: finalParentId,
    children,
    serviceCount,
  })

  // Colisão de slug dos filhos (embutem o nome do pai). CRÍTICO no move-only:
  // quando só o parent muda (nome preservado), os slugs dos filhos NÃO mudam
  // (embutem o NOME do pai, não o slug do pai) — sem excluir os próprios
  // filhos, o guard acusaria colisão falsa com as próprias linhas.
  const childNewSlugs = plan.children.map((c) => c.newSlug)
  const ownIds = [oldCat.id, ...plan.children.map((c) => c.id)]
  const collidingChildren = await db.category.findMany({
    where: { slug: { in: childNewSlugs }, id: { notIn: ownIds } },
  })
  if (collidingChildren.length > 0) {
    console.error(
      `❌ Slugs dos filhos colidiriam com categorias existentes: ${collidingChildren
        .map((c) => `${c.slug} ('${c.name}')`)
        .join(", ")}.`,
    )
    console.error("   Resolva as colisões antes de migrar (a árvore ficaria inconsistente).")
    process.exit(1)
  }

  // ── Dry-run ───────────────────────────────────────────────────────────────
  console.log("🧾 PLANO DE MIGRAÇÃO")
  console.log("")
  console.log(
    `   ANTIGA   '${oldCat.name}'  slug '${oldCat.slug}'  (level ${oldCat.level}, parent=${oldParent?.name ?? "—"}, active=${oldCat.active})`,
  )
  console.log(
    `   NOVA     '${newName}'  slug '${newSlug}'  (level ${oldCat.level}, parent=${finalParentName ?? "—"})`,
  )
  if (newParent) {
    console.log(`   MOVE     parent: '${oldParent?.name ?? "—"}' → '${newParent.name}'`)
  }
  console.log(`   FILHOS   ${plan.children.length} re-apontados + slugs corrigidos:`)
  for (const c of plan.children) {
    console.log(`      • '${c.name}': '${c.oldSlug}' → '${c.newSlug}'`)
  }
  console.log(`   SERVICES ${plan.serviceCount} re-apontados para a nova linha`)
  console.log(`   ANTIGA   desativada (active = false — nunca apagada)`)
  console.log("")

  if (args.dryRun) {
    console.log("✅ DRY-RUN — nada foi escrito no banco.")
    process.exit(0)
  }

  // ── Confirmação interativa ───────────────────────────────────────────────
  if (!args.yes) {
    if (!process.stdin.isTTY) {
      console.error(
        "❌ Terminal não interativo: passe --yes para confirmar a migração (ou --dry-run para apenas revisar).",
      )
      process.exit(1)
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await new Promise((resolve) => {
      rl.question("   Confirmar a migração? (y/N) ", (ans) => resolve(ans.trim().toLowerCase()))
    })
    rl.close()
    if (answer !== "y" && answer !== "yes") {
      console.error("❌ Migração cancelada pelo usuário.")
      process.exit(1)
    }
  }

  // ── Executa em UMA transação ──────────────────────────────────────────────
  console.log("🚀 Executando migração...")
  const created = await db.$transaction(async (tx) => {
    const row = await tx.category.create({
      data: {
        ...plan.created,
        active: true,
      },
    })

    // Re-aponta filhos + corrige slugs (embutem o slug do pai)
    for (const c of plan.children) {
      await tx.category.update({
        where: { id: c.id },
        data: { parentId: row.id, slug: c.newSlug },
      })
    }

    // Re-aponta services
    if (plan.serviceCount > 0) {
      await tx.service.updateMany({
        where: { categoryId: oldCat.id },
        data: { categoryId: row.id },
      })
    }

    // Desativa a linha antiga (nunca apaga)
    await tx.category.update({
      where: { id: oldCat.id },
      data: { active: false },
    })

    return row
  })

  console.log("")
  console.log(`✅ Migração concluída!`)
  console.log(`   Nova linha: '${created.name}' (${created.slug}) — id ${created.id}`)
  console.log(`   Filhos re-apontados: ${plan.children.length}`)
  console.log(`   Services re-apontados: ${plan.serviceCount}`)
  console.log(`   Antiga '${oldCat.name}' desativada (active=false)`)
  console.log("")
  console.log(
    "   Dica: rode `bun run db:search:index` para indexar search_vector das categorias (mesmo gap do seed).",
  )
  console.log(
    "   Dica: re-rode `bun run db:seed:prod --dry-run` para confirmar que a árvore ficou consistente.",
  )
}

if (IS_DIRECT_RUN) {
  main()
    .catch((e) => {
      console.error("❌ Migração falhou:", e)
      process.exit(1)
    })
    .finally(async () => {
      await db.$disconnect()
    })
}
