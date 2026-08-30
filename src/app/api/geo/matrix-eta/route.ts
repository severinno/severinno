import { NextRequest, NextResponse } from "next/server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { calculate1xNDistanceMatrix, TargetDestination } from "@/lib/osrm-table"

export async function POST(req: NextRequest) {
  await assertRateLimit(req, RATE_LIMITS.geo)
  try {
    const body = await req.json()
    const { origin, destinations } = body

    if (!origin || typeof origin.lat !== "number" || typeof origin.lng !== "number") {
      return NextResponse.json(
        { success: false, error: "Origin coordinates (lat, lng) are required" },
        { status: 400 },
      )
    }

    if (!Array.isArray(destinations) || destinations.length === 0) {
      return NextResponse.json(
        { success: false, error: "Destinations array is required (at least 1 destination)" },
        { status: 400 },
      )
    }

    // Limit batch size to 50 destinations per request
    const cappedDestinations: TargetDestination[] = destinations
      .slice(0, 50)
      .filter((d) => d && typeof d.lat === "number" && typeof d.lng === "number" && d.id)

    const results = await calculate1xNDistanceMatrix(origin, cappedDestinations)

    // Sort by fastest duration / distance
    results.sort((a, b) => a.durationMinutes - b.durationMinutes || a.distanceKm - b.distanceKm)

    return NextResponse.json({
      success: true,
      count: results.length,
      origin,
      results,
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Matrix calculation failed",
      },
      { status: 500 },
    )
  }
}
