export const dynamic = "force-dynamic"

import logger from "@/lib/logger"
import { NextResponse } from "next/server"
import { type QuoteStatus } from "@prisma/client"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { quoteSchema } from "@/lib/validators"
import { parseBody } from "@/lib/api-middleware"
import { badRequest, forbidden, notFound, parsePagination } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { notifyNewQuote } from "@/lib/notifications"
import { sanitizeText } from "@/lib/sanitize"

import { withRoute } from "@/lib/api-route"

// CLIENT: create a quote request with N items
export const POST = withRoute("api.quotes.POST", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.quotes)
  const session = await requireUser()
  if (session.role !== "CLIENT") {
    throw forbidden("Apenas clientes podem solicitar orçamentos")
  }
  const data = await parseBody(request, quoteSchema)

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
          description: item.description ? sanitizeText(item.description) : item.description,
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
  ).catch((err) => logger.warn({ err }, "quote notification failed (fire-and-forget)"))

  return NextResponse.json({ quote }, { status: 201 })
})

// Any user: list quote requests relevant to them
export const GET = withRoute("api.quotes.GET", async (request) => {
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
            ...(await (async () => {
              const secondaryIds = await db.quoteItem.findMany({
                where: { providerId: session.userId },
                select: { requestId: true },
                distinct: ["requestId"],
              })
              const ids = secondaryIds.map((i) => i.requestId)
              return {
                OR: [{ providerId: session.userId }, { id: { in: ids } }],
              }
            })()),
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
})
