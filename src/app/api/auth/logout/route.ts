export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { destroySession } from "@/lib/auth"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { withRoute } from "@/lib/api-route"

export const POST = withRoute("api.auth.logout.POST", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.authMe)
  await destroySession()
  return NextResponse.json({ ok: true })
})
