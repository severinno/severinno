import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"

/**
 * ADMIN: list ALL services (including inactive), enriched with provider +
 * category. Filters: q (title), providerId, categoryId, active.
 *
 * Returns { items, total } (no pagination in MVP — small dataset).
 */
export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")
    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q")?.trim() || undefined
    const providerId = searchParams.get("providerId") || undefined
    const categoryId = searchParams.get("categoryId") || undefined
    const active = searchParams.get("active")

    const where = {
      ...(q
        ? {
            OR: [{ title: { contains: q } }, { description: { contains: q } }],
          }
        : {}),
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
      }),
      db.service.count({ where }),
    ])

    return NextResponse.json({ items, total })
  } catch (e) {
    return handleError(e)
  }
}
