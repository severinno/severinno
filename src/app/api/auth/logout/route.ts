export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { destroySession } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

export async function POST(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.authMe)
    await destroySession()
    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
