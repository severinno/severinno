export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError, parsePagination } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * ADMIN: list services with server-side filtering + pagination.
 * Filters: q (title), providerId, categoryId, active.
 */
export async function GET(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.admin)
    await requireRole("ADMIN")
    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q")?.trim() || undefined
    const providerId = searchParams.get("providerId") || undefined
    const categoryId = searchParams.get("categoryId") || undefined
    const active = searchParams.get("active")
    const { page, limit, skip, take } = parsePagination(searchParams)

    const where = {
      ...(q ? { OR: [{ title: { contains: q } }, { description: { contains: q } }] } : {}),
      ...(providerId ? { providerId } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(active === "true" ? { active: true } : active === "false" ? { active: false } : {}),
    }

    const [items, total] = await Promise.all([
      db.service.findMany({
        where,
        include: {
          category: true,
          provider: {
            select: {
              id: true,
              name: true,
              avatarUrl: true,
              city: true,
              state: true,
              verified: true,
              active: true,
            },
          },
          _count: { select: { bookings: true, reviews: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      db.service.count({ where }),
    ])

    return NextResponse.json({ items, total, page, limit })
  } catch (e) {
    return handleError(e)
  }
}
