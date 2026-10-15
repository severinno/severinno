export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { getPayload } from "@/lib/push-store"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { withParams } from "@/lib/api-route"
import logger from "@/lib/logger"

/**
 * GET /api/push/payload/:id
 */
export const GET = withParams<{ id: string }>(
  "api.push.payload.:id.GET",
  async (request, { params }) => {
    await assertRateLimit(request, RATE_LIMITS.general)

    const { id } = await params
    logger.debug({ payloadId: id }, "push payload fetch requested")

    const payload = await getPayload(id)

    if (!payload) {
      return NextResponse.json({ error: "Payload não encontrado ou expirado" }, { status: 404 })
    }

    return NextResponse.json(payload)
  },
)
