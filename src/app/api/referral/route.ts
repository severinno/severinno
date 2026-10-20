export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth"
import { withRoute } from "@/lib/api-route"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { getReferralStats, registerReferralInvite } from "@/lib/referral"
import { badRequest } from "@/lib/api-server"
import { z } from "zod"

const claimReferralSchema = z.object({
  code: z.string().min(4, "Código de indicação inválido").max(16),
  intentType: z.enum(["client", "provider"]).optional(),
})

/**
 * GET /api/referral
 * Returns user's referral code, share links, and invite performance stats.
 */
export const GET = withRoute("api.referral.GET", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.general)
  const session = await requireUser()

  const stats = await getReferralStats(session.userId)

  return NextResponse.json({
    ok: true,
    stats,
  })
})

/**
 * POST /api/referral
 * Claims or binds a referral code to the current user.
 */
export const POST = withRoute("api.referral.POST", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.general)
  const session = await requireUser()

  const body = await request.json().catch(() => ({}))
  const { code, intentType } = claimReferralSchema.parse(body)

  const success = await registerReferralInvite(session.userId, code, intentType ?? "client")

  if (!success) {
    throw badRequest("Código de indicação inválido ou você não pode indicar a si mesmo.")
  }

  return NextResponse.json({
    ok: true,
    message: "Código de indicação vinculado com sucesso!",
  })
})
