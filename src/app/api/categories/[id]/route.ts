import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { categorySchema } from "@/lib/validators"
import {
  badRequest,
  conflict,
  handleError,
  invalidateCategoryCache,
  notFound,
} from "@/lib/api-server"
import { cacheInvalidate } from "@/lib/redis"

type Params = { params: Promise<{ id: string }> }

// Admin: update category
export async function PATCH(request: Request, { params }: Params) {
  try {
    await requireRole("ADMIN")
    const { id } = await params
    const existing = await db.category.findUnique({ where: { id } })
    if (!existing) throw notFound("Categoria não encontrada")

    const body = await request.json()
    const data = categorySchema.partial().parse(body)

    // If parentId is being changed, validate it exists & isn't self
    if (data.parentId !== undefined) {
      if (data.parentId === id) {
        throw badRequest("Categoria não pode ser pai de si mesma")
      }
      if (data.parentId) {
        const parent = await db.category.findUnique({
          where: { id: data.parentId },
          select: { id: true, level: true },
        })
        if (!parent) throw notFound("Categoria pai não encontrada")
      }
    }
    // Slug uniqueness
    if (data.slug && data.slug !== existing.slug) {
      const dupe = await db.category.findUnique({
        where: { slug: data.slug },
        select: { id: true },
      })
      if (dupe) throw conflict("Slug já utilizado")
    }

    const updated = await db.category.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.slug !== undefined ? { slug: data.slug } : {}),
        ...(data.parentId !== undefined ? { parentId: data.parentId || null } : {}),
        ...(data.level !== undefined ? { level: data.level } : {}),
        ...(data.icon !== undefined ? { icon: data.icon || null } : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
    })
    await Promise.all([cacheInvalidate("categories:*"), invalidateCategoryCache()])
    return NextResponse.json({ category: updated })
  } catch (e) {
    return handleError(e)
  }
}

// Admin: delete category (block if it has children or services)
export async function DELETE(_request: Request, { params }: Params) {
  try {
    await requireRole("ADMIN")
    const { id } = await params
    const existing = await db.category.findUnique({ where: { id } })
    if (!existing) throw notFound("Categoria não encontrada")

    const [childrenCount, servicesCount] = await Promise.all([
      db.category.count({ where: { parentId: id } }),
      db.service.count({ where: { categoryId: id } }),
    ])
    if (childrenCount > 0 || servicesCount > 0) {
      throw conflict("Não é possível excluir: existem categorias filhas ou serviços vinculados")
    }

    await db.category.delete({ where: { id } })
    await Promise.all([cacheInvalidate("categories:*"), invalidateCategoryCache()])
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
