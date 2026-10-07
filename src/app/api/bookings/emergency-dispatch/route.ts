export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { createEmergencyDispatch, EmergencyRequest } from "@/lib/emergency-matchmaking"
import { requireUser } from "@/lib/auth"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { emergencyDispatchSchema } from "@/lib/validators"

import { withRoute } from "@/lib/api-route"

export const POST = withRoute("api.bookings.emergency-dispatch.POST", async (req) => {
  await requireUser()
  await assertRateLimit(req, RATE_LIMITS.bookings)
  const body = await req.json()
  const parsed = emergencyDispatchSchema.parse(body)

  const emergencyReq: EmergencyRequest = {
    id: parsed.request.id || `emg-${Date.now()}`,
    clientId: parsed.request.clientId,
    clientName: parsed.request.clientName,
    lat: parsed.request.lat,
    lng: parsed.request.lng,
    category: parsed.request.category,
    description: parsed.request.description,
    severity: parsed.request.severity,
    maxRadiusKm: parsed.request.maxRadiusKm,
    surgeMultiplier: parsed.request.surgeMultiplier,
  }

  const dispatch = await createEmergencyDispatch(emergencyReq, parsed.availableProviders)

  return NextResponse.json({
    success: true,
    data: dispatch,
  })
})
