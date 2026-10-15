export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { withRoute } from "@/lib/api-route"

export const GET = withRoute("api.admin.badges.GET", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.admin)
  await requireRole("ADMIN")

  const [
    activeBookingsCount,
    pendingKycCount,
    openDisputesCount,
    servicesCount,
    categoriesCount,
    verifiedProvidersCount,
  ] = await Promise.all([
    db.booking.count({
      where: {
        status: { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] },
      },
    }),
    db.user.count({
      where: {
        role: "PROVIDER",
        identityStatus: "PENDING",
      },
    }),
    db.dispute.count({
      where: {
        status: "OPEN",
      },
    }),
    db.service.count({
      where: {
        active: true,
      },
    }),
    db.category.count({
      where: {
        active: true,
      },
    }),
    db.user.count({
      where: {
        role: "PROVIDER",
        verified: true,
        active: true,
      },
    }),
  ])

  return NextResponse.json(
    {
      activeBookings: activeBookingsCount,
      pendingKyc: pendingKycCount,
      openDisputes: openDisputesCount,
      services: servicesCount,
      taxonomy: categoriesCount,
      verifiedProviders: verifiedProvidersCount,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  )
})
