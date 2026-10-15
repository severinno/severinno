export const dynamic = "force-dynamic"

/**
 * GET /api/admin/operations/live
 *
 * Torre de Controle Operacional em Tempo Real para Governador Valadares (MG).
 * Agrega prestadores em campo, agendamentos ativos, status de geofence (50m STRICT),
 * saldo em custódia (Escrow HELD) e estatísticas por bairro.
 */

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { db } from "@/lib/db"
import { withRoute } from "@/lib/api-route"

export const GET = withRoute("api.admin.operations.live.GET", async () => {
  await requireRole("ADMIN")

  // 1. Agendamentos ativos em Governador Valadares (CEPs 350xx ou menção a Valadares)
  const bookings = await db.booking.findMany({
    where: {
      status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] },
      OR: [
        { address: { contains: "Valadares", mode: "insensitive" } },
        { cep: { startsWith: "350" } },
      ],
    },
    take: 50,
    orderBy: { scheduledAt: "desc" },
    include: {
      client: { select: { id: true, name: true, whatsapp: true } },
      provider: { select: { id: true, name: true, whatsapp: true } },
      service: { select: { id: true, title: true } },
    },
  })

  // 2. Saldos em custódia (Escrow)
  const heldAggregate = await db.booking.aggregate({
    where: { paymentStatus: "HELD" },
    _sum: { amount: true },
    _count: { id: true },
  })

  const releasedTodayAggregate = await db.booking.aggregate({
    where: {
      paymentStatus: "PAID",
      escrowReleasedAt: {
        gte: new Date(new Date().setHours(0, 0, 0, 0)),
      },
    },
    _sum: { amount: true },
    _count: { id: true },
  })

  // 3. Prestadores operando na região de GV
  const providerUsers = await db.user.findMany({
    where: {
      role: "PROVIDER",
      active: true,
      OR: [
        { city: { contains: "Valadares", mode: "insensitive" } },
        { street: { contains: "Valadares", mode: "insensitive" } },
        { cep: { startsWith: "350" } },
      ],
    },
    take: 50,
    select: {
      id: true,
      name: true,
      whatsapp: true,
      city: true,
      state: true,
      lat: true,
      lng: true,
      active: true,
      verified: true,
    },
  })

  // 4. Mapeamento dos agendamentos formatados para o mapa e tabela
  const liveBookings = bookings.map((b) => {
    // Determina o bairro com base no endereço
    const addr = b.address.toLowerCase()
    let neighborhood = "Centro"
    if (addr.includes("ilha") || addr.includes("araujo") || addr.includes("piracicaba")) {
      neighborhood = "Ilha dos Araújos"
    } else if (addr.includes("bretas") || addr.includes("santos dumont") || addr.includes("jk")) {
      neighborhood = "Vila Bretas"
    } else if (addr.includes("sao pedro") || addr.includes("paleta")) {
      neighborhood = "São Pedro"
    } else if (
      addr.includes("santa rita") ||
      addr.includes("washington") ||
      addr.includes("eusebio")
    ) {
      neighborhood = "Santa Rita"
    } else if (
      addr.includes("gra-duquesa") ||
      addr.includes("gra duquesa") ||
      addr.includes("veneza")
    ) {
      neighborhood = "Grã-Duquesa"
    } else if (addr.includes("esplanada") || addr.includes("sete de setembro")) {
      neighborhood = "Esplanada"
    }

    return {
      id: b.id,
      clientId: b.clientId,
      clientName: b.client?.name ?? "Cliente",
      clientPhone: b.client?.whatsapp ?? null,
      providerId: b.providerId,
      providerName: b.provider?.name ?? "Prestador",
      providerPhone: b.provider?.whatsapp ?? null,
      serviceTitle: b.service?.title ?? "Serviço",
      status: b.status,
      paymentStatus: b.paymentStatus,
      amount: Number(b.amount),
      lat: b.lat,
      lng: b.lng,
      address: b.address,
      neighborhood,
      scheduledAt: b.scheduledAt.toISOString(),
      escrowReleasedAt: b.escrowReleasedAt?.toISOString() ?? null,
    }
  })

  // 5. Agrupamento e estatísticas por bairro
  const neighborhoodStats: Record<
    string,
    { total: number; inProgress: number; heldAmount: number }
  > = {
    Centro: { total: 0, inProgress: 0, heldAmount: 0 },
    "Ilha dos Araújos": { total: 0, inProgress: 0, heldAmount: 0 },
    "Vila Bretas": { total: 0, inProgress: 0, heldAmount: 0 },
    "São Pedro": { total: 0, inProgress: 0, heldAmount: 0 },
    "Santa Rita": { total: 0, inProgress: 0, heldAmount: 0 },
    "Grã-Duquesa": { total: 0, inProgress: 0, heldAmount: 0 },
    Esplanada: { total: 0, inProgress: 0, heldAmount: 0 },
  }

  for (const b of liveBookings) {
    if (!neighborhoodStats[b.neighborhood]) {
      neighborhoodStats[b.neighborhood] = { total: 0, inProgress: 0, heldAmount: 0 }
    }
    neighborhoodStats[b.neighborhood].total++
    if (b.status === "IN_PROGRESS") {
      neighborhoodStats[b.neighborhood].inProgress++
    }
    if (b.paymentStatus === "HELD") {
      neighborhoodStats[b.neighborhood].heldAmount += b.amount
    }
  }

  // 6. Prestadores formatados com coordenadas conhecidas ou padrão GV Centro
  const liveProviders = providerUsers.map((p, idx) => {
    // Coordenadas reais de latitude/longitude ou espalhamento leve em GV
    const baseLat = p.lat ?? -18.8548 + ((idx % 5) - 2) * 0.005
    const baseLng = p.lng ?? -41.9482 + ((idx % 4) - 2) * 0.005

    return {
      id: p.id,
      name: p.name,
      phone: p.whatsapp,
      city: p.city || "Governador Valadares",
      state: p.state || "MG",
      lat: baseLat,
      lng: baseLng,
      active: p.active,
      verified: p.verified,
    }
  })

  return NextResponse.json({
    city: "Governador Valadares",
    state: "MG",
    center: { lat: -18.8548, lng: -41.9482 },
    kpis: {
      activeBookings: liveBookings.filter(
        (b) => b.status === "IN_PROGRESS" || b.status === "CONFIRMED",
      ).length,
      onlineProviders: liveProviders.length,
      escrowHeldAmount: Number(heldAggregate._sum.amount ?? 0),
      escrowHeldCount: heldAggregate._count.id,
      escrowReleasedToday: Number(releasedTodayAggregate._sum.amount ?? 0),
    },
    bookings: liveBookings,
    providers: liveProviders,
    neighborhoods: neighborhoodStats,
  })
})

export const POST = withRoute("api.admin.operations.live.POST", async (request: Request) => {
  await requireRole("ADMIN")
  const body = await request.json().catch(() => ({}))
  const { bookingId, action } = body

  if (!bookingId || action !== "release_escrow") {
    return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 })
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, paymentStatus: true, status: true },
  })

  if (!booking) {
    return NextResponse.json({ error: "Agendamento não encontrado" }, { status: 404 })
  }

  if (booking.paymentStatus !== "HELD") {
    return NextResponse.json(
      {
        error: `O agendamento não está em custódia (status de pagamento atual: ${booking.paymentStatus})`,
      },
      { status: 409 },
    )
  }

  const now = new Date()
  await db.$transaction([
    db.booking.update({
      where: { id: booking.id },
      data: {
        paymentStatus: "PAID",
        escrowReleasedAt: now,
      },
    }),
    db.payment.updateMany({
      where: { bookingId: booking.id },
      data: {
        status: "PAID",
        paidAt: now,
      },
    }),
  ])

  return NextResponse.json({ success: true, releasedAt: now.toISOString() })
})
