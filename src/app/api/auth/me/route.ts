export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getOptionalSession } from "@/lib/auth"
import { USER_PUBLIC_SELECT } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { withRoute } from "@/lib/api-route"

export const GET = withRoute("api.auth.me.GET", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.authMe)
  const session = await getOptionalSession()
  if (!session) {
    return NextResponse.json({ user: null })
  }
  const user = await db.user.findUnique({
    where: { id: session.userId },
    // Sessão PRÓPRIA: cidade/estado alimentam o chip de localização do
    // onboarding/painel (USER_PUBLIC_SELECT sozinho não os traz).
    select: { ...USER_PUBLIC_SELECT, city: true, state: true },
  })
  if (!user) {
    return NextResponse.json({ user: null })
  }
  return NextResponse.json({ user })
})
