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
  DEFAULT_SETTINGS,
  buildPatchedSpec,
  categorySlug,
  categoryOrder,
  assertValidCategorySpec,
  buildSeedPlan,
  printPlan,
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
