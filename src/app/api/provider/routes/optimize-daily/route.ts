import { NextRequest, NextResponse } from "next/server"
import { optimizeDailyRoute2Opt, RouteStop } from "@/lib/tsp-route-optimizer"

export async function POST(req: NextRequest) {
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
        error: error instanceof Error ? error.message : "Route optimization failed",
      },
      { status: 500 },
    )
  }
}
