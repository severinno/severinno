export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { z } from "zod"
import { requireRole } from "@/lib/auth"
import { withRoute } from "@/lib/api-route"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import {
  getProviderTransportProfile,
  setProviderTransportMode,
} from "@/lib/provider-transport-preferences"
import type { TransportMode } from "@/lib/tsp-route-optimizer"

const transportPreferenceSchema = z.object({
  mode: z.enum(["MOTO", "CAR", "BICYCLE"]),
})

export const GET = withRoute("api.provider.preferences.transport.GET", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.general)
  const session = await requireRole("PROVIDER")

  const profile = await getProviderTransportProfile(session.userId)

  return NextResponse.json({
    mode: profile.mode,
    profile,
  })
})

export const PUT = withRoute("api.provider.preferences.transport.PUT", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.general)
  const session = await requireRole("PROVIDER")

  const body = await request.json()
  const parsed = transportPreferenceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Modo de transporte inválido. Escolha MOTO, CAR ou BICYCLE." },
      { status: 400 },
    )
  }

  const profile = await setProviderTransportMode(session.userId, parsed.data.mode as TransportMode)

  return NextResponse.json({
    ok: true,
    mode: profile.mode,
    profile,
  })
})
