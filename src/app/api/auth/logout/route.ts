export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { destroySession, getSession, revokeAllUserSessions } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { withRoute } from "@/lib/api-route"

export const POST = withRoute("api.auth.logout.POST", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.authMe)

  let allDevices = false
  try {
    const body = (await request.json().catch(() => null)) as { allDevices?: boolean } | null
    if (body?.allDevices) {
      allDevices = true
    }
  } catch {
    allDevices = false
  }

  if (allDevices) {
    const session = await getSession()
    if (session?.userId) {
      await revokeAllUserSessions(session.userId)
    }
  }

  await destroySession()
  return NextResponse.json(allDevices ? { ok: true, allDevicesRevoked: true } : { ok: true })
})
