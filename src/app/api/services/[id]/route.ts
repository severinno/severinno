import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { serviceSchema } from "@/lib/validators"
import { badRequest, forbidden, handleError, notFound } from "@/lib/api-server"

type Params = { params: Promise<{ id: string }> }

// Public: get a service
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params
    const service = await db.service.findUnique({
      where: { id },
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
            whatsapp: true,
          },
        },
      },
    })
    if (!service) throw notFound("Serviço não encontrado")
    return NextResponse.json({ service })
  } catch (e) {
    return handleError(e)
  }
}

// Owner provider or admin: update a service
// NOTE: basePrice can only INCREASE per business rule.
export async function PATCH(request: Request, { params }: Params) {
  try {
    const session = await requireUser()
    const { id } = await params

    const service = await db.service.findUnique({
      where: { id },
      select: { id: true, providerId: true, basePrice: true },
    })
    if (!service) throw notFound("Serviço não encontrado")

    const isOwner = service.providerId === session.userId
    const isAdmin = session.role === "ADMIN"
    if (!isOwner && !isAdmin) {
      throw forbidden("Você não tem permissão para editar este serviço")
    }

    const body = await request.json()
    const data = serviceSchema.partial().parse(body)

    // Business rule: basePrice may only increase
    if (
      data.basePrice !== undefined &&
      data.basePrice < service.basePrice
    ) {
      throw badRequest(
        "O preço base só pode ser reajustado para cima (mínimo atual: R$ " +
          service.basePrice.toFixed(2) +
          ")",
      )
    }

    // Validate category if changed
    if (data.categoryId && data.categoryId !== service.providerId) {
      const category = await db.category.findUnique({
        where: { id: data.categoryId },
        select: { id: true },
      })
      if (!category) throw badRequest("Categoria inválida")
    }

    const updated = await db.service.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.categoryId !== undefined ? { categoryId: data.categoryId } : {}),
        ...(data.basePrice !== undefined ? { basePrice: data.basePrice } : {}),
        ...(data.unit !== undefined ? { unit: data.unit } : {}),
        ...(data.photos !== undefined ? { photos: data.photos } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
      include: { category: true },
    })
    return NextResponse.json({ service: updated })
  } catch (e) {
    return handleError(e)
  }
}

// Owner provider or admin: delete a service
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const session = await requireUser()
    const { id } = await params

    const service = await db.service.findUnique({
      where: { id },
      select: { id: true, providerId: true },
    })
    if (!service) throw notFound("Serviço não encontrado")

    const isOwner = service.providerId === session.userId
    const isAdmin = session.role === "ADMIN"
    if (!isOwner && !isAdmin) {
      throw forbidden("Você não tem permissão para excluir este serviço")
    }

    await db.service.update({ where: { id }, data: { deletedAt: new Date() } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
