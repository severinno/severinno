import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { categorySchema } from "@/lib/validators"
import { handleError, notFound, cacheControlPublic, syncCategorySearch, invalidateCategoryCache } from "@/lib/api-server"
import { withCache, cacheInvalidate } from "@/lib/redis"

type CategoryWithCount = Awaited<ReturnType<typeof db.category.findMany>>[number] & {
  serviceCount?: number
}

// Public: list categories, optionally filtered by level / parentId
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const level = searchParams.get("level")
    const parentId = searchParams.get("parentId")
    const includeCount = searchParams.get("includeCount") === "true"

    // Build a deterministic cache key from params (omit includeCount — it
    // changes the shape, so we include it for correctness)
    const cacheKey = `categories:l=${level ?? "all"}:p=${parentId ?? "none"}:c=${includeCount}`

    const result = await withCache<CategoryWithCount[]>(cacheKey, async () => {
      const categories = await db.category.findMany({
        where: {
          ...(level !== null && level !== undefined && level !== ""
            ? { level: Number(level) }
            : {}),
          ...(parentId ? { parentId } : {}),
        },
        orderBy: [{ order: "asc" }, { name: "asc" }],
      })

      if (!includeCount || categories.length === 0) return categories

      const counts = await db.service.groupBy({
        by: ["categoryId"],
        where: {
          categoryId: { in: categories.map((c) => c.id) },
          active: true,
          deletedAt: null,
        },
        _count: { id: true },
      })
      const countMap = new Map(counts.map((c) => [c.categoryId, c._count.id]))
      return categories.map((cat) => ({
        ...cat,
        serviceCount: countMap.get(cat.id) ?? 0,
      }))
    }, 120)

    return cacheControlPublic(NextResponse.json(result), 120, 600)
  } catch (e) {
    return handleError(e)
  }
}

// Admin only: create category
export async function POST(request: Request) {
  try {
    await requireRole("ADMIN")
    const body = await request.json()
    const data = categorySchema.parse(body)

    // Validate parent exists if provided
    if (data.parentId) {
      const parent = await db.category.findUnique({
        where: { id: data.parentId },
        select: { id: true, level: true },
      })
      if (!parent) throw notFound("Categoria pai não encontrada")
      // child level must be parent.level + 1 (if not explicitly set)
    }

    const created = await db.category.create({
      data: {
        name: data.name,
        slug: data.slug,
        parentId: data.parentId || null,
        level: data.level,
        icon: data.icon || null,
        order: data.order,
        active: data.active,
      },
    })

    // Invalidate all cached category lists so fresh data is served
    Promise.all([
      cacheInvalidate("categories:*"),
      invalidateCategoryCache(),
    ]).catch(() => {})
    // Queue search reindex (non-critical — don't fail the request)
    syncCategorySearch(created).catch(() => {})
    return NextResponse.json({ category: created }, { status: 201 })
  } catch (e) {
    return handleError(e)
  }
}
