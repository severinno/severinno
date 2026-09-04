export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { handleError, parsePagination } from "@/lib/api-server"

// Authenticated: list user's notifications (unread first, then by date desc)
export async function GET(request: Request) {
  await assertRateLimit(request, RATE_LIMITS.general)
  try {
    const session = await requireUser()
    const { searchParams } = new URL(request.url)
    const { page, limit, skip, take } = parsePagination(searchParams)
    const unreadOnly = searchParams.get("unread") === "1"
    const typeFilter = searchParams.get("type")
    const includeUnreadCount = searchParams.get("unreadCount") === "1"

    const where = {
      userId: session.userId,
      ...(unreadOnly ? { read: false } : {}),
      ...(typeFilter ? { type: typeFilter } : {}),
    }

    const [items, total, unreadCount] = await Promise.all([
      db.notification.findMany({
        where,
        orderBy: [{ read: "asc" }, { createdAt: "desc" }],
        skip,
        take,
      }),
      db.notification.count({ where }),
      includeUnreadCount
        ? db.notification.count({ where: { userId: session.userId, read: false } })
        : Promise.resolve(undefined),
    ])

    return NextResponse.json({ items, total, page, limit, unreadCount })
  } catch (e) {
    return handleError(e)
  }
}
