import { NextRequest, NextResponse } from "next/server"
import { createEmergencyDispatch, EmergencyRequest } from "@/lib/emergency-matchmaking"
import { requireUser } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

export async function POST(req: NextRequest) {
  try {
    await requireUser()
    await assertRateLimit(req, RATE_LIMITS.bookings)
    const body = await req.json()
    const { request, availableProviders } = body

    if (!request || typeof request.lat !== "number" || typeof request.lng !== "number") {
      return NextResponse.json(
        { success: false, error: "Emergency request with lat/lng is required" },
        { status: 400 },
      )
    }

    const emergencyReq: EmergencyRequest = {
      id: request.id || `emg-${Date.now()}`,
      clientId: request.clientId || "unknown",
      clientName: request.clientName || "Cliente",
      lat: request.lat,
      lng: request.lng,
      category: request.category || "Emergência Geral",
      description: request.description || "",
      severity: request.severity || "EMERGENCY",
      maxRadiusKm: request.maxRadiusKm || 10,
      surgeMultiplier: request.surgeMultiplier,
    }

    const providers = Array.isArray(availableProviders) ? availableProviders : []

    const dispatch = await createEmergencyDispatch(emergencyReq, providers)

    return NextResponse.json({
      success: true,
      data: dispatch,
    })
  } catch (_error) {
    return NextResponse.json(
      {
        success: false,
        error: "Emergency dispatch failed",
      },
      { status: 500 },
    )
  }
}
