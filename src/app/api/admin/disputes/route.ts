export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { withRoute } from "@/lib/api-route"
import { toMoneyNumber } from "@/lib/money"
import { parsePagination } from "@/lib/api-server"

export const GET = withRoute("api.admin.disputes.GET", async (request) => {
  await requireRole("ADMIN")
  await assertRateLimit(request, RATE_LIMITS.admin)

  const { searchParams } = new URL(request.url)
  const statusParam = searchParams.get("status") || "OPEN"
  const { page, limit, skip, take } = parsePagination(searchParams)

  const whereClause =
    statusParam === "ALL"
      ? {}
      : {
          status: statusParam,
        }

  const disputes = await db.dispute.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    skip,
    take,
    include: {
      booking: {
        select: {
          id: true,
          amount: true,
          status: true,
          paymentStatus: true,
          scheduledAt: true,
          createdAt: true,
          beforePhotos: true,
          afterPhotos: true,
          completionNote: true,
          escrowDisputeReason: true,
          escrowReleasedAt: true,
          client: {
            select: {
              id: true,
              name: true,
              email: true,
              whatsapp: true,
              avatarUrl: true,
            },
          },
          provider: {
            select: {
              id: true,
              name: true,
              email: true,
              whatsapp: true,
              avatarUrl: true,
            },
          },
          service: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      },
    },
  })

  // Métricas agregadas
  const allDisputesCount = await db.dispute.count()
  const openDisputesCount = await db.dispute.count({ where: { status: "OPEN" } })

  let totalAmountInDispute = 0
  const items = disputes.map((d) => {
    const amountNumber = toMoneyNumber(d.booking.amount, 0)
    if (d.status === "OPEN") {
      totalAmountInDispute += amountNumber
    }

    const openDays = Math.floor(
      (Date.now() - new Date(d.createdAt).getTime()) / (1000 * 60 * 60 * 24),
    )

    return {
      id: d.id,
      bookingId: d.bookingId,
      reason: d.reason,
      status: d.status,
      resolution: d.resolution,
      createdAt: d.createdAt,
      resolvedAt: d.resolvedAt,
      openDays,
      booking: {
        ...d.booking,
        amount: amountNumber,
      },
    }
  })

  return NextResponse.json({
    items,
    meta: {
      page,
      limit,
      total: allDisputesCount,
      open: openDisputesCount,
      totalAmountInDispute: Number(totalAmountInDispute.toFixed(2)),
    },
  })
})
