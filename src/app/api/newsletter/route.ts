export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { handleError } from "@/lib/api-server"
import { assertRateLimit } from "@/lib/rate-limit"
import { newsletterSchema } from "@/lib/validators"

/**
 * POST /api/newsletter
 *
 * Subscribe an email to the newsletter.
 * Uses the Setting model with key "newsletter:{email}" to store subscriptions.
 * Simple dedup: if already subscribed, returns 200 with a friendly message.
 */
export async function POST(req: NextRequest) {
  await assertRateLimit(req, { prefix: "newsletter", max: 5, windowMs: 60_000 })
  try {
    const body = await req.json()
    const { email } = newsletterSchema.parse(body)

    // Check if already subscribed (using Setting as a KV store)
    const key = `newsletter:${email}`
    const existing = await db.setting.findUnique({ where: { key } })

    if (existing) {
      return NextResponse.json({
        ok: true,
        message: "Este e-mail já está inscrito!",
        alreadySubscribed: true,
      })
    }

    // Save subscription
    await db.setting.create({
      data: {
        key,
        value: JSON.stringify({
          email,
          subscribedAt: new Date().toISOString(),
          source: "footer",
        }),
      },
    })

    return NextResponse.json({
      ok: true,
      message: "Inscrição confirmada!",
    })
  } catch (e) {
    return handleError(e)
  }
}
