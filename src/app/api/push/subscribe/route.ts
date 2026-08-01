import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { handleError, badRequest } from "@/lib/api-server"
import { assertRateLimit } from "@/lib/rate-limit"
import logger from "@/lib/logger"

export async function POST(request: Request) {
  try {
    await assertRateLimit(request, { prefix: "push-sub", max: 10, windowMs: 60_000 })
    const session = await requireUser()
    const body = await request.json()
    const { endpoint, p256dh, auth, userAgent } = body

    if (!endpoint || !p256dh || !auth) {
      throw badRequest("endpoint, p256dh, and auth are required")
    }

    await db.pushSubscription.upsert({
      where: { endpoint },
      create: { userId: session.userId, endpoint, p256dh, auth, userAgent: userAgent ?? null },
      update: { userId: session.userId, p256dh, auth, userAgent: userAgent ?? null },
    })

    logger.info({ userId: session.userId }, "push subscription saved")
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}

export async function DELETE(request: Request) {
  try {
    await assertRateLimit(request, { prefix: "push-del", max: 10, windowMs: 60_000 })
    const session = await requireUser()
    const body = await request.json()
    const { endpoint } = body

    if (!endpoint) throw badRequest("endpoint is required")

    await db.pushSubscription.deleteMany({
      where: { endpoint, userId: session.userId },
    })

    logger.info({ userId: session.userId }, "push subscription removed")
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
