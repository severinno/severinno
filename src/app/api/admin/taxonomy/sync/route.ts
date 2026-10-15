export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { withRoute } from "@/lib/api-route"
import logger from "@/lib/logger"
import { cacheInvalidate } from "@/lib/redis"
import { invalidateCategoryCache } from "@/lib/api-server"
import {
  CATEGORY_SPEC,
  categorySlug,
  categoryOrder,
  assertValidCategorySpec,
} from "../../../../../../prisma/seed-data"

/**
 * POST /api/admin/taxonomy/sync
 *
 * Sincroniza a taxonomia oficial de 7 macro-domínios, 36 subcategorias e 86 especialidades
 * (129 categorias ativas) no PostgreSQL de forma idempotente e segura, invalidando
 * caches de borda e do Redis.
 */
export const POST = withRoute("api.admin.taxonomy.sync.POST", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.admin)
  await requireRole("ADMIN")

  try {
    // 1. Validação defensiva do spec canônico
    assertValidCategorySpec(CATEGORY_SPEC)

    const level0 = CATEGORY_SPEC.filter((c) => c.level === 0)
    const level1 = CATEGORY_SPEC.filter((c) => c.level === 1)
    const level2 = CATEGORY_SPEC.filter((c) => c.level === 2)

    const idBySlug = new Map<string, string>()

    // 2. Upsert Nível 0 (Macro-Domínios)
    for (const item of level0) {
      const slug = categorySlug(item)
      const row = await db.category.upsert({
        where: { slug },
        create: {
          name: item.name,
          slug,
          level: 0,
          parentId: null,
          icon: item.icon ?? null,
          description: item.description ?? null,
          order: categoryOrder(item),
          active: true,
        },
        update: {
          name: item.name,
          level: 0,
          parentId: null,
          icon: item.icon ?? undefined,
          description: item.description ?? undefined,
          order: categoryOrder(item),
          active: true,
        },
      })
      idBySlug.set(slug, row.id)
    }

    // 3. Upsert Nível 1 (Subcategorias)
    for (const item of level1) {
      const slug = categorySlug(item)
      const parentItem = item.parent ? CATEGORY_SPEC.find((c) => c.name === item.parent) : null
      const parentSlug = parentItem ? categorySlug(parentItem) : null
      const parentId = parentSlug ? idBySlug.get(parentSlug) : null

      const row = await db.category.upsert({
        where: { slug },
        create: {
          name: item.name,
          slug,
          level: 1,
          parentId: parentId ?? null,
          icon: item.icon ?? null,
          description: item.description ?? null,
          order: categoryOrder(item),
          active: true,
        },
        update: {
          name: item.name,
          level: 1,
          parentId: parentId ?? null,
          icon: item.icon ?? undefined,
          description: item.description ?? undefined,
          order: categoryOrder(item),
          active: true,
        },
      })
      idBySlug.set(slug, row.id)
    }

    // 4. Upsert Nível 2 (Especialidades)
    for (const item of level2) {
      const slug = categorySlug(item)
      const parentItem = item.parent ? CATEGORY_SPEC.find((c) => c.name === item.parent) : null
      const parentSlug = parentItem ? categorySlug(parentItem) : null
      const parentId = parentSlug ? idBySlug.get(parentSlug) : null

      const row = await db.category.upsert({
        where: { slug },
        create: {
          name: item.name,
          slug,
          level: 2,
          parentId: parentId ?? null,
          icon: item.icon ?? null,
          description: item.description ?? null,
          order: categoryOrder(item),
          active: true,
        },
        update: {
          name: item.name,
          level: 2,
          parentId: parentId ?? null,
          icon: item.icon ?? undefined,
          description: item.description ?? undefined,
          order: categoryOrder(item),
          active: true,
        },
      })
      idBySlug.set(slug, row.id)
    }

    // 5. Invalidação de Cache
    Promise.all([cacheInvalidate("categories:*"), invalidateCategoryCache()]).catch((err) =>
      logger.warn({ err }, "taxonomy sync cache invalidation failed"),
    )

    return NextResponse.json({
      ok: true,
      message: "Taxonomia canônica sincronizada com sucesso.",
      total: CATEGORY_SPEC.length,
      roots: level0.length,
      subcategories: level1.length,
      specialties: level2.length,
    })
  } catch (error) {
    logger.error({ error }, "Erro ao sincronizar taxonomia")
    return NextResponse.json({ error: "Falha ao sincronizar taxonomia canônica" }, { status: 500 })
  }
})
