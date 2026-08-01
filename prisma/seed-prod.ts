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
 *
 * ⚠️ CENÁRIOS DE PRODUÇÃO (documentados — ver assertValidCategorySpec em
 * seed-data.ts para as proteções fail-fast):
 *
 *   1. NOVAS categorias mid-cycle (spec cresce entre deploys): SEGURO — o
 *      upsert por slug cria as novas sem tocar nas existentes. Sem ação.
 *
 *   2. RENOMEAR uma categoria: PERIGOSO — o slug é derivado do nome (filhos
 *      herdam o slug do pai), então renomear muda o slug → o upsert cria uma
 *      NOVA linha e a antiga vira órfã, com services ainda apontando para ela.
 *      NÃO é bloqueável por validação (é decisão de migração): renomear exige
 *      migração manual de parentId/FKs, NUNCA re-run do seed. Se necessário,
 *      rode --dry-run primeiro para ver o plano de renomeação.
 *
 *   3. NOMES duplicados / parent inexistente (typo) / parent com level >= filho
 *      / level 0 com parent / slugs duplicados: o spec é validado por
 *      assertValidCategorySpec() ANTES de qualquer escrita — o seed RECUSA com
 *      erro claro em vez de corromper a árvore silenciosamente (ex.: um typo
 *      no parent viraria parentId=null sem a proteção).
 */

import { PrismaClient } from "@prisma/client"
import { isProdSeedAllowed } from "../src/lib/prod-seed"
import {
  CATEGORY_SPEC,
  DEFAULT_SETTINGS,
  buildPatchedSpec,
  categorySlug,
  categoryOrder,
  assertValidCategorySpec,
  buildSeedPlan,
  type CategorySeedInput,
  type CurrentCategoryRow,
  type CurrentSettingRow,
} from "./seed-data"

const db = new PrismaClient()

// --dry-run (argv) ou DRY_RUN=1 (env) → revisão sem escrita -----------------
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1"

// ── SEED_SPEC_PATCH: hook de teste p/ cenários de UPDATE e RENAME ────────
// Permite ao E2E (scripts/test-seed-prod-e2e.ts) validar convergência do
// upsert contra um spec mutado. Formato (JSON array):
//   SEED_SPEC_PATCH='[{"name":"Elétrica","icon":"bolt"},{"name":"Limpeza","order":5}]'
//   SEED_SPEC_PATCH='[{"name":"Elétrica","renameTo":"Eletricidade"}]'
// Suporta: icon/order (update in-place) e renameTo (renomeia com cascata de
// um nível — ver buildPatchedSpec em seed-data.ts, função compartilhada com
// o seed de dev). SÓ é aplicado quando PROD_SEED_ALLOW_DEV=1 (banco
// efêmero/CI) — em produção real (NODE_ENV=production sem override) o patch
// é IGNORADO, mesmo se a env existir: produção SEMPRE usa o CATEGORY_SPEC
// canônico.
const SPEC: CategorySeedInput[] = buildPatchedSpec(
  process.env.SEED_SPEC_PATCH,
  process.env.PROD_SEED_ALLOW_DEV === "1",
)

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
  spec: CategorySeedInput[] = CATEGORY_SPEC,
): void {
  console.log("")
  console.log("🧾 DRY-RUN — nenhuma escrita será feita no banco")
  console.log("")

  console.log(`📂 CATEGORIAS (${spec.length} no spec)`)
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
    `   Categorias: ${s.categoriesCreate} criar, ${s.categoriesUpdate} atualizar, ${s.categoriesUnchanged} inalteradas (total ${spec.length})`,
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

  // ── Renomeações em andamento (nome bate com o spec, slug difere) ──────
  // Cenário PERIGOSO documentado no header: o slug é derivado do nome, então
  // renomear uma categoria (ou o parent dela) muda o slug → o upsert cria uma
  // NOVA linha e a antiga vira órfã, com services ainda apontando para ela.
  // Aqui detectamos a renomeação na HORA da revisão: uma categoria no banco
  // cujo nome casa com o spec mas cujo slug não é o canônico do spec.
  // ⚠️ LIMITAÇÃO: a detecção dispara via FILHOS — o nome deles continua no
  // spec, mas o slug muda porque embute o slug do pai. Um pai renomeado SEM
  // filhos é indistinguível de uma categoria removida do spec (sem o spec
  // anterior não há como saber) — ele só aparece na seção 'Fora do spec'.
  const specByName = new Map(spec.map((c) => [c.name, c]))
  // Filhos por nome de parent — para detectar pais renomeados que ficaram
  // órfãos com filhos ainda apontando para eles no banco.
  const childrenByParent = new Map<string, number>()
  for (const c of current.categories) {
    if (c.parentName) {
      childrenByParent.set(c.parentName, (childrenByParent.get(c.parentName) ?? 0) + 1)
    }
  }
  const renameSlugs = new Set<string>()
  const renames: { dbSlug: string; specSlug: string; name: string }[] = []
  for (const c of current.categories) {
    const specEntry = specByName.get(c.name)
    if (!specEntry) continue // nome nem existe no spec — tratado em 'Fora do spec'
    const canonical = categorySlug(specEntry)
    if (c.slug !== canonical) {
      renames.push({ dbSlug: c.slug, specSlug: canonical, name: c.name })
      renameSlugs.add(c.slug)
    }
  }
  if (renames.length > 0) {
    console.log("")
    console.log("   ⚠️  POSSÍVEL RENOMEAÇÃO DETECTADA — atenção antes de rodar:")
    for (const r of renames) {
      const kids = childrenByParent.get(r.name) ?? 0
      console.log(
        `      • '${r.name}': banco tem slug '${r.dbSlug}', o spec quer '${r.specSlug}'` +
          (kids > 0 ? ` — ${kids} filho(s) no banco ainda aponta(m) para a linha antiga` : ""),
      )
    }
    console.log(
      "      O upsert CRIARÁ a linha nova e DEIXARÁ a antiga órfã — services" +
        " continuam apontando para a antiga. Renomear exige migração manual" +
        " de parentId/FKs, NUNCA re-run do seed.",
    )
  }

  // Entradas extras no banco (fora do spec) — o seed NÃO as toca; só avisa.
  // Linhas já listadas como renomeação ficam de fora para não duplicar.
  const specCatSlugs = new Set(spec.map((c) => categorySlug(c)))
  const extraCats = current.categories.filter(
    (c) => !specCatSlugs.has(c.slug) && !renameSlugs.has(c.slug),
  )
  const specSetKeys = new Set(DEFAULT_SETTINGS.map((s) => s.key))
  const extraSettings = current.settings.filter((s) => !specSetKeys.has(s.key))
  if (extraCats.length > 0 || extraSettings.length > 0) {
    console.log("")
    console.log(`   ℹ️  Fora do spec (não serão tocadas pelo seed):`)
    if (extraCats.length > 0) {
      const extraWithKids = extraCats.map((c) => {
        const kids = childrenByParent.get(c.name) ?? 0
        return kids > 0 ? `${c.name} (${kids} filho(s) no banco — possível pai renomeado)` : c.name
      })
      console.log(`      • ${extraCats.length} categoria(s) extra(s): ${extraWithKids.join(", ")}`)
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
  // ── Validação estrutural do spec (fail-fast ANTES de qualquer escrita) ──
  // Protege contra nomes duplicados, parent inexistente (typo), parent com
  // level >= filho, level 0 com parent e colisões de slug — cenários que
  // corromperiam a árvore silenciosamente sem esta validação.
  assertValidCategorySpec(SPEC)

  if (DRY_RUN) {
    console.log("   (modo revisão — --dry-run / DRY_RUN=1, nenhuma escrita)")
    const current = await loadCurrentState()
    const plan = buildSeedPlan(current.categories, current.settings, SPEC)
    printPlan(plan, current, SPEC)
    console.log("✅ Dry-run concluído — nada foi escrito no banco.")
    return
  }

  // --- CATEGORIES (upsert por slug — idempotente) ----------------------
  console.log("   • upsert de categorias...")
  const catByName: Record<string, { id: string }> = {}
  // Ordena por level para que pais existam antes dos filhos
  const sorted = [...SPEC].sort((a, b) => a.level - b.level)

  for (const c of sorted) {
    const slug = categorySlug(c)
    // Defense-in-depth: assertValidCategorySpec já garante que todo parent
    // existe e é único — mas um parent não resolvido aqui seria parentId=null
    // silencioso (categoria órfã). Nunca deve acontecer; falhe se acontecer.
    const parent = c.parent ? (catByName[c.parent] ?? null) : null
    if (c.parent && !parent) {
      throw new Error(
        `Seed recusado: parent '${c.parent}' de '${c.name}' não foi resolvido (spec inválido ou duplicado).`,
      )
    }
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
