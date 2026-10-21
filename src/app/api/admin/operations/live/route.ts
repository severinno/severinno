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

  // 4. Mapeamento dos 20 bairros de Governador Valadares
  const GV_NEIGHBORHOODS_MAP: Record<
    string,
    { name: string; lat: number; lng: number; keywords: string[] }
  > = {
    centro: {
      name: "Centro",
      lat: -18.8511,
      lng: -41.9422,
      keywords: ["centro", "israel pinheiro", "peçanha", "pecanha", "rio branco"],
    },
    "ilha-dos-araujos": {
      name: "Ilha dos Araújos",
      lat: -18.8584,
      lng: -41.9515,
      keywords: ["ilha", "araujo", "araújo", "piracicaba"],
    },
    "vila-isa": {
      name: "Vila Isa",
      lat: -18.8701,
      lng: -41.9582,
      keywords: ["vila isa", "rio doce"],
    },
    esplanada: {
      name: "Esplanada",
      lat: -18.8465,
      lng: -41.9458,
      keywords: ["esplanada", "sete de setembro"],
    },
    "gra-duquesa": {
      name: "Grã-Duquesa",
      lat: -18.8385,
      lng: -41.9352,
      keywords: ["gra-duquesa", "grã-duquesa", "gra duquesa", "veneza"],
    },
    "sao-pedro": {
      name: "São Pedro",
      lat: -18.8621,
      lng: -41.9392,
      keywords: ["sao pedro", "são pedro", "paleta", "univale"],
    },
    lourdes: {
      name: "Lourdes",
      lat: -18.8492,
      lng: -41.9331,
      keywords: ["lourdes"],
    },
    "santa-rita": {
      name: "Santa Rita",
      lat: -18.8752,
      lng: -41.9654,
      keywords: ["santa rita", "washington", "eusebio", "eusébio"],
    },
    castanheiras: {
      name: "Castanheiras",
      lat: -18.8312,
      lng: -41.9485,
      keywords: ["castanheiras", "castanheira"],
    },
    "lagoa-santa": {
      name: "Lagoa Santa",
      lat: -18.8415,
      lng: -41.9215,
      keywords: ["lagoa santa", "lagoa"],
    },
    "vila-bretas": {
      name: "Vila Bretas",
      lat: -18.8412,
      lng: -41.9542,
      keywords: ["bretas", "vila bretas"],
    },
    altinopolis: {
      name: "Altinópolis",
      lat: -18.868,
      lng: -41.936,
      keywords: ["altinopolis", "altinópolis"],
    },
    "santa-efigenia": {
      name: "Santa Efigênia",
      lat: -18.871,
      lng: -41.948,
      keywords: ["santa efigenia", "santa efigênia", "efigenia"],
    },
    esperanca: {
      name: "Esperança",
      lat: -18.859,
      lng: -41.968,
      keywords: ["esperanca", "esperança"],
    },
    carapina: {
      name: "Carapina",
      lat: -18.851,
      lng: -41.932,
      keywords: ["carapina"],
    },
    "jardim-perola": {
      name: "Jardim Pérola",
      lat: -18.835,
      lng: -41.972,
      keywords: ["jardim perola", "jardim pérola", "perola"],
    },
    "morada-do-vale": {
      name: "Morada do Vale",
      lat: -18.828,
      lng: -41.94,
      keywords: ["morada do vale", "morada"],
    },
    "vila-dos-montes": {
      name: "Vila dos Montes",
      lat: -18.847,
      lng: -41.985,
      keywords: ["vila dos montes", "montes"],
    },
    "nova-jk": {
      name: "Nova JK",
      lat: -18.832,
      lng: -41.965,
      keywords: ["nova jk", "jk"],
    },
    "santos-dumont": {
      name: "Santos Dumont",
      lat: -18.874,
      lng: -41.94,
      keywords: ["santos dumont", "dumont"],
    },
  }

  // 5. Mapeamento dos agendamentos formatados para o mapa e tabela
  const liveBookings = bookings.map((b) => {
    const addr = b.address.toLowerCase()
    let detected = "Centro"

    for (const item of Object.values(GV_NEIGHBORHOODS_MAP)) {
      if (item.keywords.some((k) => addr.includes(k))) {
        detected = item.name
        break
      }
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
      neighborhood: detected,
      scheduledAt: b.scheduledAt.toISOString(),
      escrowReleasedAt: b.escrowReleasedAt?.toISOString() ?? null,
    }
  })

  // 6. Agrupamento e estatísticas para todos os 20 bairros de GV
  const neighborhoodStats: Record<
    string,
    { total: number; inProgress: number; heldAmount: number; lat: number; lng: number }
  > = {}

  for (const item of Object.values(GV_NEIGHBORHOODS_MAP)) {
    neighborhoodStats[item.name] = {
      total: 0,
      inProgress: 0,
      heldAmount: 0,
      lat: item.lat,
      lng: item.lng,
    }
  }

  for (const b of liveBookings) {
    if (!neighborhoodStats[b.neighborhood]) {
      neighborhoodStats[b.neighborhood] = {
        total: 0,
        inProgress: 0,
        heldAmount: 0,
        lat: -18.8511,
        lng: -41.9422,
      }
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

  const { acquireEscrowLock } = await import("@/lib/escrow-lock")
  const lock = await acquireEscrowLock(booking.id, 15)
  if (!lock.acquired) {
    return NextResponse.json(
      {
        error: "A liberação de custódia deste agendamento já está em processamento concorrente.",
      },
      { status: 409 },
    )
  }

  try {
    const now = new Date()
    const [bookingUpdateResult] = await db.$transaction([
      db.booking.updateMany({
        where: {
          id: booking.id,
          paymentStatus: "HELD",
        },
        data: {
          paymentStatus: "PAID",
          status: "COMPLETED",
          escrowReleasedAt: now,
        },
      }),
      db.payment.updateMany({
        where: {
          bookingId: booking.id,
          status: { in: ["HELD", "PENDING"] },
        },
        data: {
          status: "PAID",
          paidAt: now,
        },
      }),
    ])

    if (bookingUpdateResult.count === 0) {
      return NextResponse.json(
        {
          error: "A custódia deste agendamento já foi liberada por outra operação concorrente.",
        },
        { status: 409 },
      )
    }

    return NextResponse.json({ success: true, releasedAt: now.toISOString() })
  } finally {
    await lock.release()
  }
})
