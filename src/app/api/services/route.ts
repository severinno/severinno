import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { serviceSchema } from "@/lib/validators"
import { badRequest, forbidden, handleError } from "@/lib/api-server"

// Public: list services, optionally filtered by providerId and/or categoryId
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const providerId = searchParams.get("providerId") || undefined
    const categoryId = searchParams.get("categoryId") || undefined
    const q = searchParams.get("q")?.trim() || undefined

    const services = await db.service.findMany({
      where: {
        active: true,
        ...(providerId ? { providerId } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(q
          ? {
              OR: [
                { title: { contains: q } },
                { description: { contains: q } },
              ],
            }
          : {}),
      },
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
          },
        },
      },
      orderBy: { createdAt: "desc" },
    })

    // Return the array directly so `apiGet<ProviderService[]>` works.
    return NextResponse.json(services)
  } catch (e) {
    return handleError(e)
  }
}

// PROVIDER or ADMIN: create a service
export async function POST(request: Request) {
  try {
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
    return NextResponse.json({ service: created }, { status: 201 })
  } catch (e) {
    return handleError(e)
  }
}
