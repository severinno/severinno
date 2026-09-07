export const dynamic = "force-dynamic"

import logger from "@/lib/logger"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { serviceSchema } from "@/lib/validators"
import { forbidden, handleError, syncEntitySearch, cacheControlPublic } from "@/lib/api-server"
import { withCache, cacheInvalidate } from "@/lib/redis"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { createHash } from "crypto"

// GET: list services (with optional filtering)
export async function GET(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.general)
    const { searchParams } = new URL(request.url)
    const categoryId = searchParams.get("categoryId")
    const providerId = searchParams.get("providerId")

    const where: Record<string, unknown> = { active: true }
    if (categoryId) where.categoryId = categoryId
    if (providerId) where.providerId = providerId

    const q = searchParams.get("q")
    if (q) {
      where.OR = [{ title: { contains: q } }, { description: { contains: q } }]
    }

    const cacheKey = `services:${createHash("sha256").update(JSON.stringify(where)).digest("hex").slice(0, 8)}`
    const services = await withCache(
      cacheKey,
      async () => {
        return db.service.findMany({
          where,
          include: { category: { select: { id: true, name: true, slug: true } } },
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      },
      30,
    )

    return cacheControlPublic(NextResponse.json(services), 30, 120)
  } catch (e) {
    return handleError(e)
  }
}

// POST: create a new service (provider only)
export async function POST(request: Request) {
  try {
    const session = await requireUser()
    if (session.role !== "PROVIDER") throw forbidden("Only providers can create services")

    const body = await request.json()
    const data = serviceSchema.parse(body)
    const { sanitizeText } = await import("@/lib/sanitize")

    const created = await db.service.create({
      data: {
        providerId: session.userId,
        categoryId: data.categoryId,
        title: sanitizeText(data.title),
        description: sanitizeText(data.description),
        basePrice: data.basePrice,
        unit: data.unit,
        photos: data.photos,
        active: data.active,
      },
      include: { category: true },
    })
    // Queue search reindex (non-critical — don't fail the request)
    syncEntitySearch("service", created).catch((err) =>
      logger.warn({ err }, "search index sync failed"),
    )

    // Invalidate service list cache so new services appear immediately
    cacheInvalidate("services:*").catch((err) => logger.warn({ err }, "search index sync failed"))
    return NextResponse.json({ service: created }, { status: 201 })
  } catch (e) {
    return handleError(e)
  }
}
