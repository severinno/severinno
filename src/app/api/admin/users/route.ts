import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError, parsePagination, USER_PUBLIC_SELECT } from "@/lib/api-server"

// ADMIN: paginated user list with optional role / q filter
export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")
    const { searchParams } = new URL(request.url)
    const role = searchParams.get("role") || undefined
    const q = searchParams.get("q")?.trim() || undefined
    const { page, limit, skip, take } = parsePagination(searchParams)

    const where = {
      ...(role ? { role } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { email: { contains: q } },
              { city: { contains: q } },
            ],
          }
        : {}),
    }

    const [items, total] = await Promise.all([
      db.user.findMany({
        where,
        select: USER_PUBLIC_SELECT,
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      db.user.count({ where }),
    ])

    return NextResponse.json({ items, total, page, limit })
  } catch (e) {
    return handleError(e)
  }
}
