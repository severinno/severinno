export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { withRoute } from "@/lib/api-route"
import logger from "@/lib/logger"

/**
 * POST /api/push/click
 */
export const POST = withRoute("api.push.click.POST", async (request: Request) => {
  await assertRateLimit(request, RATE_LIMITS.general)

  const body = await request.json()
  const { notificationId, title } = body

  if (!notificationId && !title) {
    return NextResponse.json(
      { ok: false, error: "notificationId ou title required" },
      { status: 400 },
    )
  }

  if (notificationId) {
    const updated = await db.pushAnalytics
      .update({
        where: { id: notificationId },
        data: {
          status: "clicked",
          clickedAt: new Date(),
        },
      })
      .catch(() => null)

    if (updated) {
      logger.debug({ notificationId }, "push notification clicked — analytics updated")
      return NextResponse.json({ ok: true })
    }
  }

  logger.info(
    { title, notificationId: notificationId ?? "unknown" },
    "push notification clicked (no analytics record)",
  )
  return NextResponse.json({ ok: true })
})
