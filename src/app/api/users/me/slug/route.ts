import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { slugSchema } from "@/lib/validators"
import { handleError, conflict, USER_PUBLIC_SELECT } from "@/lib/api-server"

/**
 * POST /api/users/me/slug
 *
 * Set or update the authenticated user's public slug.
 * The slug must be unique across all users.
 *
 * Body: { slug: "meu-nome" }
 */
export async function POST(request: Request) {
  try {
    const session = await requireUser()
    const body = await request.json()
    const slug = slugSchema.parse(body.slug)

    // Check uniqueness (case-insensitive)
    const existing = await db.user.findFirst({
      where: {
        slug: { equals: slug, mode: "insensitive" },
        id: { not: session.userId },
      },
      select: { id: true },
    })

    if (existing) {
      throw conflict(
        `O slug "${slug}" já está em uso. Escolha outro.`,
      )
    }

    const updated = await db.user.update({
      where: { id: session.userId },
      data: { slug },
      select: USER_PUBLIC_SELECT,
    })

    return NextResponse.json({ user: updated })
  } catch (e) {
    return handleError(e)
  }
}
