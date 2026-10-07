export const dynamic = "force-dynamic"

import logger from "@/lib/logger"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { categorySchema, categoryUpdateSchema } from "@/lib/validators"
import { parseBody } from "@/lib/api-middleware"
import {
  notFound,
  noStoreJson,
  cacheControlPublic,
  syncEntitySearch,
  invalidateCategoryCache,
} from "@/lib/api-server"
import { withCache, cacheInvalidate } from "@/lib/redis"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { type Prisma } from "@prisma/client"

import { withRoute } from "@/lib/api-route"

type CategoryNode = Prisma.CategoryGetPayload<Record<string, never>> & {
  children: CategoryNode[]
}

// GET: list categories (public, cached)
export async function GET(request?: Request) {
  try {
    await assertRateLimit(request!, RATE_LIMITS.general)
    const categories = await withCache(
      "categories:all",
      async () => {
        // Flat query — fetch all active categories in one pass, no nested includes
        const all = await db.category.findMany({
          where: { active: true },
          orderBy: [{ order: "asc" }, { name: "asc" }],
        })
        // Build tree in memory (avoids N+1 with nested includes)
        const byId = new Map<string, CategoryNode>(all.map((c) => [c.id, { ...c, children: [] }]))
        const roots: CategoryNode[] = []
        for (const cat of all) {
          const node = byId.get(cat.id)!
          if (cat.parentId && byId.has(cat.parentId)) {
            byId.get(cat.parentId)!.children.push(node)
          } else {
            roots.push(node)
          }
        }
        return roots
      },
      60,
    )
    return cacheControlPublic(NextResponse.json(categories), 120, 600)
  } catch {
    return noStoreJson({ error: "Erro interno" }, { status: 500 })
  }
}

// POST: create a category (admin only)
export const POST = withRoute("api.categories.POST", async (request) => {
  await requireRole("ADMIN")
  const data = await parseBody(request, categorySchema)

  // Check slug uniqueness
  const existing = await db.category.findUnique({ where: { slug: data.slug } })
  if (existing) return NextResponse.json({ error: "Slug já existe" }, { status: 409 })

  const created = await db.category.create({
    data: {
      name: data.name,
      slug: data.slug,
      parentId: data.parentId || null,
      level: data.level ?? 0,
      icon: data.icon || null,
      order: data.order,
      active: data.active,
    },
  })

  // Invalidate all cached category lists so fresh data is served
  Promise.all([cacheInvalidate("categories:*"), invalidateCategoryCache()]).catch((err) =>
    logger.warn({ err }, "category cache invalidation failed"),
  )
  // Queue search reindex (non-critical — don't fail the request)
  syncEntitySearch("category", created).catch((err) =>
    logger.warn({ err }, "category search reindex failed"),
  )
  return NextResponse.json({ category: created }, { status: 201 })
})

// PUT: update a category (admin only)
export const PUT = withRoute("api.categories.PUT", async (request) => {
  await requireRole("ADMIN")
  const { id, ...data } = await parseBody(request, categoryUpdateSchema)

  const category = await db.category.findUnique({ where: { id } })
  if (!category) throw notFound()

  const updated = await db.category.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.slug !== undefined ? { slug: data.slug } : {}),
      ...(data.parentId !== undefined ? { parentId: data.parentId } : {}),
      ...(data.level !== undefined ? { level: data.level } : {}),
      ...(data.icon !== undefined ? { icon: data.icon } : {}),
      ...(data.order !== undefined ? { order: data.order } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
    },
  })

  Promise.all([cacheInvalidate("categories:*"), invalidateCategoryCache()]).catch((err) =>
    logger.warn({ err }, "category cache invalidation failed"),
  )
  syncEntitySearch("category", updated).catch((err) =>
    logger.warn({ err }, "category search reindex failed"),
  )
  return NextResponse.json({ category: updated })
})

// DELETE: soft-delete a category (admin only)
export const DELETE = withRoute("api.categories.DELETE", async (request) => {
  await requireRole("ADMIN")
  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "ID obrigatório" }, { status: 400 })

  const category = await db.category.findUnique({ where: { id } })
  if (!category) throw notFound()

  await db.category.update({
    where: { id },
    data: { active: false },
  })

  cacheInvalidate("categories:*").catch((err) =>
    logger.warn({ err }, "category cache invalidation failed"),
  )
  return NextResponse.json({ success: true })
})
