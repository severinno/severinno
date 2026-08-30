import logger from "@/lib/logger"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { serviceSchema } from "@/lib/validators"
import {
  badRequest,
  forbidden,
  handleError,
  syncServiceSearch,
  cacheControlPublic,
} from "@/lib/api-server"
import { withCache, cacheInvalidate } from "@/lib/redis"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

// Public: list services, optionally filtered by providerId and/or categoryId
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const providerId = searchParams.get("providerId") || undefined
    const categoryId = searchParams.get("categoryId") || undefined
    const q = searchParams.get("q")?.trim() || undefined

    const cacheKey = `services:${providerId ?? "all"}:${categoryId ?? "all"}:${q ?? ""}`
    const services = await withCache(
      cacheKey,
      async () => {
        return db.service.findMany({
          where: {
            active: true,
            ...(providerId ? { providerId } : {}),
            ...(categoryId ? { categoryId } : {}),
            ...(q
              ? {
                  OR: [{ title: { contains: q } }, { description: { contains: q } }],
                }
              : {}),
          },
          include: {
            category: { select: { id: true, name: true, slug: true, icon: true } },
            provider: {
              select: {
                id: true,
                name: true,
                avatarUrl: true,
                city: true,
                state: true,
                verified: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        })
      },
      30,
    )

    return cacheControlPublic(NextResponse.json(services), 30, 120)
  } catch (e) {
    return handleError(e)
  }
}

// PROVIDER or ADMIN: create a service
export async function POST(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.general)
    const session = await requireUser()
    if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
      throw forbidden("Apenas prestadores podem cadastrar serviços")
    }
    const body = await request.json()
    const data = serviceSchema.parse(body)

    // Validate category exists
    const category = await db.category.findUnique({
      where: { id: data.categoryId },
      select: { id: true },
    })
    if (!category) throw badRequest("Categoria inválida")

    // providerId is always the current user (admins act on behalf via separate admin route)
    const providerId = session.userId

    const created = await db.service.create({
      data: {
        providerId,
        categoryId: data.categoryId,
        title: data.title,
        description: data.description,
        basePrice: data.basePrice,
        unit: data.unit,
        photos: data.photos,
        active: data.active,
      },
      include: { category: true },
    })
    // Queue search reindex (non-critical — don't fail the request)
    syncServiceSearch(created).catch((err) => logger.warn({ err }, "search index sync failed"))

    // Invalidate service list cache so new services appear immediately
    cacheInvalidate("services:*").catch((err) => logger.warn({ err }, "search index sync failed"))
    return NextResponse.json({ service: created }, { status: 201 })
  } catch (e) {
    return handleError(e)
  }
}
