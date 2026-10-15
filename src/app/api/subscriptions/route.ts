export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import {
  calculateSubscriptionPrice,
  generateUpcomingDates,
  SUBSCRIPTION_PLANS,
  formatCarePlanNotes,
  parseCarePlanNotes,
  type SubscriptionFrequency,
} from "@/lib/subscriptions"
import { badRequest, notFound } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { toMoneyNumber } from "@/lib/money"
import { randomBytes } from "crypto"

import { withRoute } from "@/lib/api-route"

/**
 * GET /api/subscriptions
 * Lists subscriptions for the authenticated user (client or provider) with MRR metrics.
 *
 * POST /api/subscriptions
 * body: { serviceId, providerId, frequency, startDate, address, cep, lat, lng, notes }
 * Creates a new recurring plan and schedules upcoming booking occurrences.
 */
export const GET = withRoute("api.subscriptions.GET", async (request) => {
  const session = await requireUser()
  await assertRateLimit(request, RATE_LIMITS.bookings)

  const isProvider = session.role === "PROVIDER"

  const bookings = await db.booking.findMany({
    where: {
      ...(isProvider ? { providerId: session.userId } : { clientId: session.userId }),
      OR: [{ notes: { contains: "[RECORRENTE" } }, { notes: { contains: "[PLANO_CUIDADO:" } }],
    },
    include: {
      service: { select: { title: true, basePrice: true } },
      client: { select: { name: true, phone: true } },
      provider: { select: { name: true, phone: true } },
    },
    orderBy: { scheduledAt: "asc" },
    take: 50,
  })

  let totalMonthlyRecurringRevenue = 0
  let totalProjectedAnnualSavings = 0

  const subscriptions = bookings.map((b) => {
    const meta = parseCarePlanNotes(b.notes)
    const amountNum = toMoneyNumber(b.amount)
    const freq = meta?.frequency || "MONTHLY"
    const plan = SUBSCRIPTION_PLANS[freq]

    if (plan) {
      const monthlyFactor = plan.visitsPerYear / 12
      totalMonthlyRecurringRevenue += Math.round(amountNum * monthlyFactor * 100) / 100
      totalProjectedAnnualSavings += meta?.annualSavings ?? 0
    }

    return {
      id: b.id,
      serviceTitle: b.service.title,
      counterpart: isProvider ? b.client.name : b.provider.name,
      counterpartPhone: isProvider ? b.client.phone : b.provider.phone,
      scheduledAt: b.scheduledAt,
      amount: amountNum,
      status: b.status,
      address: b.address,
      frequency: freq,
      planLabel: meta?.planLabel || plan?.label || freq,
      discountPercent: meta?.discountPercent ?? plan?.discountPercent ?? 0,
      annualSavings: meta?.annualSavings ?? 0,
      subscriptionId: meta?.subscriptionId || b.id,
    }
  })

  return NextResponse.json({
    ok: true,
    count: subscriptions.length,
    kpi: isProvider
      ? {
          activeSubscribersCount: new Set(subscriptions.map((s) => s.counterpart)).size,
          projectedMRR: Math.round(totalMonthlyRecurringRevenue * 100) / 100,
        }
      : {
          activePlansCount: subscriptions.length,
          totalAnnualSavings: Math.round(totalProjectedAnnualSavings * 100) / 100,
        },
    subscriptions,
  })
})

export const POST = withRoute("api.subscriptions.POST", async (request) => {
  const session = await requireUser()
  await assertRateLimit(request, RATE_LIMITS.bookings)

  const body = (await request.json()) as {
    serviceId?: string
    providerId?: string
    frequency?: SubscriptionFrequency
    startDate?: string
    address?: string
    cep?: string
    lat?: number
    lng?: number
    notes?: string
  }

  if (!body.serviceId || !body.providerId || !body.frequency || !body.startDate) {
    throw badRequest("Campos 'serviceId', 'providerId', 'frequency' e 'startDate' são obrigatórios")
  }

  const validFrequencies: SubscriptionFrequency[] = ["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY"]
  if (!validFrequencies.includes(body.frequency)) {
    throw badRequest(`Frequência inválida. Opções: ${validFrequencies.join(", ")}`)
  }

  const service = await db.service.findUnique({
    where: { id: body.serviceId, active: true },
    select: { id: true, title: true, basePrice: true, providerId: true, unit: true },
  })

  if (!service) {
    throw notFound("Serviço não encontrado ou inativo")
  }

  const priceBreakdown = calculateSubscriptionPrice(
    toMoneyNumber(service.basePrice),
    body.frequency,
  )
  const upcomingDates = generateUpcomingDates(new Date(body.startDate), body.frequency, 4)

  const subscriptionId = `sub_${Date.now()}_${randomBytes(4).toString("hex")}`
  const planInfo = SUBSCRIPTION_PLANS[body.frequency]

  const carePlanNote = formatCarePlanNotes(
    {
      subscriptionId,
      frequency: body.frequency,
      discountPercent: priceBreakdown.discountPercent,
      savingsPerVisit: priceBreakdown.savings,
      annualSavings: priceBreakdown.annualSavings,
      planLabel: planInfo.label,
    },
    `[RECORRENTE - ${body.frequency}] ${body.notes || ""}`.trim(),
  )

  // Create the first recurring booking with discounted amount
  const firstBooking = await db.booking.create({
    data: {
      clientId: session.userId,
      providerId: body.providerId,
      serviceId: body.serviceId,
      scheduledAt: upcomingDates[0],
      address: body.address || "Endereço cadastrado",
      cep: body.cep || "00000-000",
      lat: body.lat ?? 0,
      lng: body.lng ?? 0,
      amount: priceBreakdown.discountedPrice,
      quantity: 1,
      unit: service.unit,
      notes: carePlanNote,
      status: "CONFIRMED",
    },
  })

  return NextResponse.json({
    ok: true,
    message: "Plano de Cuidado Residencial ativado com sucesso!",
    subscriptionId,
    firstBookingId: firstBooking.id,
    frequency: body.frequency,
    planLabel: planInfo.label,
    pricing: priceBreakdown,
    scheduledDates: upcomingDates,
  })
})
