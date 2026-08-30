import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { optimizeDailyRoute2Opt, RouteStop } from "@/lib/tsp-route-optimizer"

export async function POST(req: NextRequest) {
  await requireRole("PROVIDER")
  await assertRateLimit(req, RATE_LIMITS.general)
  try {
    const body = await req.json()
    const { baseLocation, stops } = body

    if (
      !baseLocation ||
      typeof baseLocation.lat !== "number" ||
      typeof baseLocation.lng !== "number"
    ) {
      return NextResponse.json(
        { success: false, error: "baseLocation (lat, lng) is required" },
        { status: 400 },
      )
    }

    if (!Array.isArray(stops) || stops.length === 0) {
      return NextResponse.json(
        { success: false, error: "stops array is required" },
        { status: 400 },
      )
    }

    const validStops: RouteStop[] = stops.filter(
      (s) => s && typeof s.lat === "number" && typeof s.lng === "number" && s.id,
    )

    const plan = optimizeDailyRoute2Opt(baseLocation, validStops)

    return NextResponse.json({
      success: true,
      data: plan,
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Route optimization failed",
      },
      { status: 500 },
    )
  }
}
