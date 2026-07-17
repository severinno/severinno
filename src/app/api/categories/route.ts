import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { categorySchema } from "@/lib/validators"
import { handleError, notFound } from "@/lib/api-server"

// Public: list categories, optionally filtered by level / parentId
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const level = searchParams.get("level")
    const parentId = searchParams.get("parentId")

    const categories = await db.category.findMany({
      where: {
        ...(level !== null && level !== undefined && level !== ""
          ? { level: Number(level) }
          : {}),
        ...(parentId ? { parentId } : {}),
      },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    })

    // Return the array directly so the typed fetch wrapper `apiGet<Category[]>`
    // works without unwrapping.
    return NextResponse.json(categories)
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
    return NextResponse.json({ category: created }, { status: 201 })
  } catch (e) {
    return handleError(e)
  }
}
