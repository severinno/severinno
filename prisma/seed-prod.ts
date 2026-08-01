/**
 * Severinno Marketplace — seed de PRODUÇÃO (operações legítimas)
 * Run with: NODE_ENV=production bun run db:seed:prod
 *           (ou PROD_SEED_ALLOW_DEV=1 bun run db:seed:prod para validar
 *            contra um banco efêmero em dev/CI)
 *
 * Modo revisão (SEM escrita no banco):
 *   NODE_ENV=production bun run db:seed:prod --dry-run
 *   DRY_RUN=1 NODE_ENV=production bun run db:seed:prod
 *   → lista o que seria criado/atualizado/inalterado e encerra sem tocar o banco.
 *
 * ⚠️  DIFERENTE do prisma/seed.ts (dev):
 *   - NÃO cria usuários (nada de admin@severinno.com/admin123)
 *   - NÃO faz wipe — é IDEMPOTENTE: usa upsert por slug/key
 *   - SÓ roda com NODE_ENV=production (guard obrigatório em src/lib/prod-seed.ts)
 *
 * Popula apenas o que o marketplace precisa para operar em produção:
 *   - Árvore de categorias (3 níveis, via CATEGORY_SPEC compartilhado)
 *   - Settings padrão (site_name, pix key, raio padrão, fees, etc.)
 *
 * ⚠️ SEMÂNTICA RECONCILE (não apenas bootstrap): o upsert SINCRONIZA a
 * estrutura canônica definida em seed-data.ts (name/level/icon/order/parent)
 * — se o código renomear/reordenar uma categoria, o re-run aplica.
 * ÚNICA exceção: o flag `active` NÃO é forçado no update — uma categoria
 * que um admin desativou em produção permanece desativada.
 *
 * ⚠️ Em banco vazio, categorias ficam com search_vector nulo até rodar
 * `bun run db:search:index` (mesmo gap do seed de dev — não é regressão).
 */

import { PrismaClient } from "@prisma/client"
import { isProdSeedAllowed } from "../src/lib/prod-seed"
import {
  CATEGORY_SPEC,
  DEFAULT_SETTINGS,
  categorySlug,
  categoryOrder,
  buildSeedPlan,
  type CurrentCategoryRow,
  type CurrentSettingRow,
} from "./seed-data"

const db = new PrismaClient()

// --dry-run (argv) ou DRY_RUN=1 (env) → revisão sem escrita -----------------
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1"

/** Carrega o estado atual do banco para o plano de dry-run (somente leitura). */
async function loadCurrentState(): Promise<{
  categories: CurrentCategoryRow[]
  settings: CurrentSettingRow[]
}> {
  const [cats, settings] = await Promise.all([
    db.category.findMany({
      include: { parent: { select: { name: true } } },
    }),
    db.setting.findMany(),
  ])

  return {
    categories: cats.map((c) => ({
      slug: c.slug,
      name: c.name,
      level: c.level,
      parentName: c.parent?.name ?? null,
      icon: c.icon,
      order: c.order,
      active: c.active,
    })),
    settings: settings.map((s) => ({ key: s.key, value: s.value })),
  }
}

/** Exibe o plano de dry-run em formato legível para revisão. */
function printPlan(
  plan: ReturnType<typeof buildSeedPlan>,
  current: { categories: CurrentCategoryRow[]; settings: CurrentSettingRow[] },
): void {
  console.log("")
  console.log("🧾 DRY-RUN — nenhuma escrita será feita no banco")
  console.log("")

  console.log(`📂 CATEGORIAS (${CATEGORY_SPEC.length} no spec)`)
  for (const a of plan.categories) {
    if (a.action === "create") {
      console.log(
        `   ➕ criar    ${a.slug.padEnd(38)} ${a.name.padEnd(26)} level ${a.level} parent=${a.parent ?? "—"} icon=${a.icon ?? "—"} order=${a.order}`,
      )
    } else if (a.action === "update") {
      console.log(
        `   🔄 atualizar ${a.slug.padEnd(36)} ${a.name.padEnd(26)} mudanças: ${a.changes.join(", ")}`,
      )
    } else {
      console.log(`   ⏹ inalterada ${a.slug.padEnd(35)} ${a.name}`)
    }
  }

  console.log("")
  console.log(`⚙️  SETTINGS (${DEFAULT_SETTINGS.length} no spec)`)
  for (const a of plan.settings) {
    if (a.action === "create") {
      console.log(`   ➕ criar    ${a.key.padEnd(30)} = ${a.value}`)
    } else if (a.action === "update") {
      console.log(
        `   🔄 atualizar ${a.key.padEnd(28)} = ${a.value} (mudanças: ${a.changes.join(", ")})`,
      )
    } else {
      console.log(`   ⏹ inalterado ${a.key.padEnd(27)} = ${a.value}`)
    }
  }

  const s = plan.summary
  console.log("")
  console.log("📊 RESUMO")
  console.log(
    `   Categorias: ${s.categoriesCreate} criar, ${s.categoriesUpdate} atualizar, ${s.categoriesUnchanged} inalteradas (total ${CATEGORY_SPEC.length})`,
  )
  console.log(
    `   Settings:   ${s.settingsCreate} criar, ${s.settingsUpdate} atualizar, ${s.settingsUnchanged} inalterados (total ${DEFAULT_SETTINGS.length})`,
  )

  const inactive = current.categories.filter((c) => !c.active)
  if (inactive.length > 0) {
    console.log("")
    console.log(
      `   ℹ️  ${inactive.length} categoria(s) inativa(s) no banco: ${inactive.map((c) => c.name).join(", ")}`,
    )
    console.log("      O seed NÃO as reativa (reconcile seguro preserva a desativação do admin).")
  }

  // Entradas extras no banco (fora do spec) — o seed NÃO as toca; só avisa.
  const specCatSlugs = new Set(CATEGORY_SPEC.map((c) => categorySlug(c)))
  const extraCats = current.categories.filter((c) => !specCatSlugs.has(c.slug))
  const specSetKeys = new Set(DEFAULT_SETTINGS.map((s) => s.key))
  const extraSettings = current.settings.filter((s) => !specSetKeys.has(s.key))
  if (extraCats.length > 0 || extraSettings.length > 0) {
    console.log("")
    console.log(`   ℹ️  Fora do spec (não serão tocadas pelo seed):`)
    if (extraCats.length > 0) {
      console.log(
        `      • ${extraCats.length} categoria(s) extra(s): ${extraCats.map((c) => c.name).join(", ")}`,
      )
    }
    if (extraSettings.length > 0) {
      console.log(
        `      • ${extraSettings.length} setting(s) extra(s): ${extraSettings.map((s) => s.key).join(", ")}`,
      )
    }
  }
  console.log("")
}

async function main() {
  console.log("🚀 Severinno seed-prod — categorias + settings (sem usuários)...")

  // ── Guard: produção obrigatória ──────────────────────────────────────
  // Este script toca o banco produtivo. Sem NODE_ENV=production (ou o
  // override explícito PROD_SEED_ALLOW_DEV=1), recusa ANTES de qualquer
  // operação de banco. Throw (não return) → process.exit(1) → CI falha.
  if (!isProdSeedAllowed()) {
    console.error(
      "❌ Seed de produção recusado: NODE_ENV deve ser 'production' (ou PROD_SEED_ALLOW_DEV=1 para banco efêmero).",
    )
    console.error("   Este script NÃO cria usuários demo — é a operação legítima de produção.")
    throw new Error("Seed de produção recusado: NODE_ENV não é production")
  }

  // ── DRY-RUN: revisão sem escrita ─────────────────────────────────────
  // Carrega o estado atual (somente SELECTs), calcula o plano e encerra
  // sem nenhum INSERT/UPDATE. O guard acima continua obrigatório — o dry-run
  // ainda precisa de um banco legítimo (produção ou override efêmero).
  if (DRY_RUN) {
    console.log("   (modo revisão — --dry-run / DRY_RUN=1, nenhuma escrita)")
    const current = await loadCurrentState()
    const plan = buildSeedPlan(current.categories, current.settings)
    printPlan(plan, current)
    console.log("✅ Dry-run concluído — nada foi escrito no banco.")
    return
  }

  // --- CATEGORIES (upsert por slug — idempotente) ----------------------
  console.log("   • upsert de categorias...")
  const catByName: Record<string, { id: string }> = {}
  // Ordena por level para que pais existam antes dos filhos
  const sorted = [...CATEGORY_SPEC].sort((a, b) => a.level - b.level)

  for (const c of sorted) {
    const slug = categorySlug(c)
    const parent = c.parent ? catByName[c.parent] : null
    const created = await db.category.upsert({
      where: { slug },
      create: {
        name: c.name,
        slug,
        parentId: parent?.id ?? null,
        level: c.level,
        icon: c.icon ?? null,
        order: categoryOrder(c),
        active: true,
      },
      update: {
        name: c.name,
        parentId: parent?.id ?? null,
        level: c.level,
        icon: c.icon ?? null,
        order: categoryOrder(c),
        // active NÃO é forçado no update: se um admin desativou a categoria
        // em produção, o re-run preserva a decisão manual (reconcile seguro).
      },
    })
    catByName[c.name] = { id: created.id }
  }
  console.log(`   ✅ ${sorted.length} categorias garantidas (upsert)`)

  // --- SETTINGS (upsert por key — idempotente) -------------------------
  console.log("   • upsert de settings...")
  for (const s of DEFAULT_SETTINGS) {
    await db.setting.upsert({
      where: { key: s.key },
      create: { key: s.key, value: s.value },
      update: { value: s.value },
    })
  }
  console.log(`   ✅ ${DEFAULT_SETTINGS.length} settings garantidos (upsert)`)

  // ── Sincroniza search_vector das categorias (via trigger/consumer) ───
  // Nota: sem usuários/serviços aqui — nada a sincronizar no PostGIS.

  console.log("")
  console.log("✅ Seed de produção concluído — categorias + settings ok.")
  console.log("   • Usuários: NENHUM (sem contas demo — por design)")
  console.log("   • Categorias: " + sorted.length + " (3 níveis, upsert idempotente)")
  console.log("   • Settings: " + DEFAULT_SETTINGS.length + " (upsert idempotente)")
  console.log(
    "   • Dica: rode `bun run db:search:index` para indexar search_vector das categorias em banco vazio.",
  )
}

main()
  .catch((e) => {
    console.error("❌ Seed de produção falhou:", e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
