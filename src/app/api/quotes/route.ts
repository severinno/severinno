import { NextResponse } from "next/server"
import { type QuoteStatus } from "@prisma/client"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { quoteSchema } from "@/lib/validators"
import { badRequest, forbidden, handleError, notFound, parsePagination } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { notifyNewQuote } from "@/lib/notifications"

// CLIENT: create a quote request with N items
export async function POST(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.quotes)
    const session = await requireUser()
    if (session.role !== "CLIENT") {
      throw forbidden("Apenas clientes podem solicitar orçamentos")
    }
    const body = await request.json()
    const data = quoteSchema.parse(body)

    // Validate provider exists & is verified/active
    const provider = await db.user.findFirst({
      where: { id: data.providerId, role: "PROVIDER", active: true },
      select: { id: true, verified: true },
    })
    if (!provider) throw notFound("Prestador não encontrado")
    if (!provider.verified) {
      throw badRequest("Prestador não está verificado")
    }

    // Validate every service belongs to the chosen provider
    const services = await db.service.findMany({
      where: { id: { in: data.items.map((i) => i.serviceId) } },
      select: { id: true, providerId: true },
    })
    for (const item of data.items) {
      const svc = services.find((s) => s.id === item.serviceId)
      if (!svc) throw badRequest(`Serviço ${item.serviceId} não encontrado`)
      if (svc.providerId !== data.providerId) {
        throw badRequest(`Serviço ${item.serviceId} não pertence ao prestador informado`)
      }
    }

    const expiresAt = data.expiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000)

    const quote = await db.quoteRequest.create({
      data: {
        clientId: session.userId,
        providerId: data.providerId,
        address: data.address,
        cep: data.cep,
        lat: data.lat,
        lng: data.lng,
        expiresAt,
        status: "PENDING",
        items: {
          create: data.items.map((item) => ({
            providerId: data.providerId,
            serviceId: item.serviceId,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            photos: item.photos,
            status: "PENDING",
          })),
        },
      },
      include: {
        items: {
          include: {
            service: true,
            provider: { select: { id: true, name: true, avatarUrl: true } },
          },
        },
        provider: { select: { id: true, name: true, avatarUrl: true } },
        client: { select: { id: true, name: true, avatarUrl: true } },
      },
    })

    // Notificar provider sobre novo orçamento (best-effort)
    notifyNewQuote(
      session.userId,
      data.providerId,
      quote.id,
      data.items.length,
      quote.client?.name ?? "Cliente",
    ).catch(() => {})

    return NextResponse.json({ quote }, { status: 201 })
  } catch (e) {
    return handleError(e)
  }
}

// Any user: list quote requests relevant to them
export async function GET(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.quotes)
    const session = await requireUser()
    const { searchParams } = new URL(request.url)
    const role = (searchParams.get("role") || session.role) as "CLIENT" | "PROVIDER" | "ADMIN"
    const status = (searchParams.get("status") || undefined) as QuoteStatus | undefined
    const { page, limit, skip, take } = parsePagination(searchParams)

    const where =
      role === "CLIENT"
        ? { clientId: session.userId, ...(status ? { status } : {}) }
        : role === "PROVIDER"
          ? {
              ...(status ? { status } : {}),
              OR: [
                { providerId: session.userId },
                { items: { some: { providerId: session.userId } } },
              ],
            }
          : // ADMIN: see all
            { ...(status ? { status } : {}) }

    const [items, total] = await Promise.all([
      db.quoteRequest.findMany({
        where,
        include: {
          items: {
            include: {
              service: true,
              provider: {
                select: { id: true, name: true, avatarUrl: true },
              },
            },
          },
          provider: { select: { id: true, name: true, avatarUrl: true } },
          client: { select: { id: true, name: true, avatarUrl: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      db.quoteRequest.count({ where }),
    ])

    return NextResponse.json({ items, total, page, limit })
  } catch (e) {
    return handleError(e)
  }
}
