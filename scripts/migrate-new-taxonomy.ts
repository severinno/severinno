/**
 * scripts/migrate-new-taxonomy.ts
 *
 * Implanta a nova taxonomia oficial de 7 macro-domínios e 129 especialidades
 * no PostgreSQL e sincroniza com o Redis de forma idempotente e segura.
 *
 * Usage:
 *   bun run scripts/migrate-new-taxonomy.ts
 *
 * Exit codes:
 *   0 — sucesso
 *   1 — falha na migração
 */

import { PrismaClient } from "@prisma/client"
import {
  CATEGORY_SPEC,
  categorySlug,
  categoryOrder,
  assertValidCategorySpec,
  type CategorySeedInput,
} from "../prisma/seed-data"

const db = new PrismaClient()

async function main() {
  console.log("🚀 Iniciando migração da nova taxonomia de categorias do Severinno...")

  // 1. Validação estrutural do spec antes de qualquer escrita
  console.log(`📋 Validando spec de ${CATEGORY_SPEC.length} categorias...`)
  assertValidCategorySpec(CATEGORY_SPEC)
  console.log("✅ Spec 100% válido (sem duplicidades de nome ou slug, relações consistentes).")

  // 2. Ordenar por nível: level 0 primeiro, depois level 1, depois level 2
  const level0 = CATEGORY_SPEC.filter((c) => c.level === 0)
  const level1 = CATEGORY_SPEC.filter((c) => c.level === 1)
  const level2 = CATEGORY_SPEC.filter((c) => c.level === 2)

  const idBySlug = new Map<string, string>()

  // Pré-carregar categorias existentes para reaproveitar IDs quando já existirem
  const existingCats = await db.category.findMany({
    select: { id: true, slug: true, name: true },
  })
  for (const c of existingCats) {
    idBySlug.set(c.slug, c.id)
  }

  // 3. Upsert Level 0 (7 Macro-Domínios Raiz)
  console.log("📌 Upserting 7 Macro-Categorias (Level 0)...")
  for (const item of level0) {
    const slug = categorySlug(item)
    const row = await db.category.upsert({
      where: { slug },
      create: {
        name: item.name,
        slug,
        level: item.level,
        icon: item.icon ?? null,
        description: item.description ?? null,
        order: categoryOrder(item),
        active: true,
      },
      update: {
        name: item.name,
        level: item.level,
        icon: item.icon ?? undefined,
        description: item.description ?? undefined,
        order: categoryOrder(item),
      },
    })
    idBySlug.set(slug, row.id)
  }

  // 4. Upsert Level 1 (Subcategorias Intermediárias e Itens Diretos)
  console.log("📌 Upserting 36 Subcategorias/Itens Diretos (Level 1)...")
  for (const item of level1) {
    const slug = categorySlug(item)
    const parentSlug = item.parent
      ? categorySlug(CATEGORY_SPEC.find((c) => c.name === item.parent)!)
      : null
    const parentId = parentSlug ? idBySlug.get(parentSlug) : null

    const row = await db.category.upsert({
      where: { slug },
      create: {
        name: item.name,
        slug,
        level: item.level,
        parentId: parentId ?? null,
        icon: item.icon ?? null,
        description: item.description ?? null,
        order: categoryOrder(item),
        active: true,
      },
      update: {
        name: item.name,
        level: item.level,
        parentId: parentId ?? null,
        icon: item.icon ?? undefined,
        description: item.description ?? undefined,
        order: categoryOrder(item),
      },
    })
    idBySlug.set(slug, row.id)
  }

  // 5. Upsert Level 2 (Especialidades Finais)
  console.log("📌 Upserting 86 Especialidades Finais (Level 2)...")
  for (const item of level2) {
    const slug = categorySlug(item)
    const parentSlug = item.parent
      ? categorySlug(CATEGORY_SPEC.find((c) => c.name === item.parent)!)
      : null
    const parentId = parentSlug ? idBySlug.get(parentSlug) : null

    const row = await db.category.upsert({
      where: { slug },
      create: {
        name: item.name,
        slug,
        level: item.level,
        parentId: parentId ?? null,
        icon: item.icon ?? null,
        description: item.description ?? null,
        order: categoryOrder(item),
        active: true,
      },
      update: {
        name: item.name,
        level: item.level,
        parentId: parentId ?? null,
        icon: item.icon ?? undefined,
        description: item.description ?? undefined,
        order: categoryOrder(item),
      },
    })
    idBySlug.set(slug, row.id)
  }

  // 6. Mapeamento de Serviços Legados (Retrocompatibilidade)
  console.log("🔗 Ajustando serviços legados para apontar para as novas categorias...")
  const legacyToNewMappings: Record<string, string> = {
    // Slugs raiz antigos
    reparos: "reparos-e-instalacoes",
    limpeza: "limpeza-e-casa",
    reforma: "reforma-e-construcao",
    manutencao: "reparos-e-instalacoes",
    jardim: "jardim-e-piscina",
    transporte: "mudanca-e-organizacao",
    servicos: "reparos-e-instalacoes",
    cuidados: "limpeza-e-casa",
    saude: "limpeza-e-casa",

    // Slugs filhos antigos
    "eletrica-reparos": "eletricista-eletrica",
    "hidraulica-reparos": "encanador-hidraulica",
    "pintura-reparos": "pintura-residencial-pintura",
    "pintura-interna-pintura": "pintura-residencial-pintura",
    "pintura-externa-pintura": "pintura-predial-pintura",
    "textura-e-grafiato-pintura": "textura-e-efeitos-pintura",
    "residencial-limpeza": "diarista-e-faxina-limpeza-e-casa",
    "limpeza-geral-residencial": "diarista-e-faxina-limpeza-e-casa",
    "pos-obra-limpeza": "faxina-pos-obra-limpeza-e-casa",
    "limpeza-pos-obra-pos-obra": "faxina-pos-obra-limpeza-e-casa",
    "pisos-reforma": "porcelanato-e-ceramica-pisos",
    "assentamento-de-piso-pisos": "porcelanato-e-ceramica-pisos",
    "alvenaria-reforma": "alvenaria-obra",
    "pequenas-reformas-alvenaria": "alvenaria-obra",
    "poda-de-arvores-alvenaria": "poda-de-arvores-jardim",

    // Slugs filhos adicionais de seeds legados
    "tomadas-e-interruptores-eletrica": "eletricista-eletrica",
    "curto-circuito-eletrica": "eletricista-eletrica",
    "quadro-eletrico-eletrica": "quadro-de-energia-eletrica",
    "vazamento-hidraulica": "encanador-hidraulica",
    "caixa-de-descarga-hidraulica": "encanador-hidraulica",
    "organizacao-residencial": "personal-organizer-mudanca-e-organizacao",
    "rejunte-pisos": "porcelanato-e-ceramica-pisos",
    "instalacao-ar-condicionado-clima": "instalacao-de-ar-condicionado-climatizacao",
    "higienizacao-ar-condicionado-clima": "limpeza-de-ar-condicionado-climatizacao",
    "montagem-de-moveis-marcenaria": "montador-de-moveis-reparos-gerais",
    "corte-grama-jardinagem": "jardineiro-jardim",
  }

  let remappedCount = 0
  for (const [oldSlug, newSlug] of Object.entries(legacyToNewMappings)) {
    const oldCat = await db.category.findUnique({ where: { slug: oldSlug } })
    const targetCat = await db.category.findUnique({ where: { slug: newSlug } })

    if (oldCat && targetCat) {
      const updateResult = await db.service.updateMany({
        where: { categoryId: oldCat.id },
        data: { categoryId: targetCat.id },
      })
      remappedCount += updateResult.count
    }
  }
  console.log(`✅ ${remappedCount} serviço(s) legados remanejados para a nova taxonomia.`)

  // 6.1. Desativar categorias antigas que não fazem parte do CATEGORY_SPEC canônico
  const canonicalSlugs = new Set(CATEGORY_SPEC.map((c) => categorySlug(c)))
  const deactivatedResult = await db.category.updateMany({
    where: {
      slug: { notIn: Array.from(canonicalSlugs) },
      active: true,
    },
    data: { active: false },
  })
  console.log(
    `🛡️ ${deactivatedResult.count} categoria(s) legadas desativadas para manter a vitrine 100% canônica.`,
  )

  // 7. Invalidação de Cache no Redis
  console.log("🧹 Invalidando cache Redis 'categories:all'...")
  try {
    const { getClient } = await import("../src/lib/redis")
    const redis = getClient()
    if (redis) {
      await redis.del("categories:all")
      await redis.del("cache:categories:all")
      console.log("✅ Cache Redis invalidado com sucesso.")
    }
  } catch (err) {
    console.warn("⚠️ Aviso: não foi possível invalidar cache Redis diretamente:", err)
  }

  // 8. Relatório final de contagem
  const totalCats = await db.category.count()
  const activeCats = await db.category.count({ where: { active: true } })
  console.log("================================================================================")
  console.log(
    `🎉 MIGRAÇÃO DA NOVA TAXONOMIA CONCLUÍDA! Total no Banco: ${totalCats} (${activeCats} ativas)`,
  )
  console.log("================================================================================")
}

main()
  .catch((err) => {
    console.error("❌ Erro fatal durante a migração da taxonomia:", err)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
