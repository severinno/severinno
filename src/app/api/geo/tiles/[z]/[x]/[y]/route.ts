import { NextRequest, NextResponse } from "next/server"
import { getVectorTileData } from "@/lib/vector-tiles"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

interface RouteParams {
  params: Promise<{
    z: string
    x: string
    y: string
  }>
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  await assertRateLimit(req, RATE_LIMITS.general)
  try {
    const { z: zStr, x: xStr, y: yStr } = await params
    const z = parseInt(zStr, 10)
    const x = parseInt(xStr, 10)
    const y = parseInt(yStr, 10)

    if (isNaN(z) || isNaN(x) || isNaN(y)) {
      return NextResponse.json({ error: "Invalid tile coordinates (z, x, y)" }, { status: 400 })
    }

    // Limit zoom levels (e.g. 0 to 18)
    if (z < 0 || z > 18) {
      return NextResponse.json({ error: "Zoom level out of range (0-18)" }, { status: 400 })
    }

    const tileData = await getVectorTileData(z, x, y)

    // Cache strategy based on zoom level:
    //   z < 8:  city/region level — tiles rarely change (immutable for 1h)
    //   z 8-14: neighborhood level — moderate change (10min SWR)
    //   z > 14: street level — frequent updates (5min SWR)
    const isStatic = z < 8
    const isNeighborhood = z >= 8 && z <= 14
    const cacheControl = isStatic
      ? "public, max-age=3600, s-maxage=7200, stale-while-revalidate=86400, immutable"
      : isNeighborhood
        ? "public, max-age=300, s-maxage=600, stale-while-revalidate=1800"
        : "public, max-age=120, s-maxage=300, stale-while-revalidate=600"

    return NextResponse.json(tileData, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": cacheControl,
        "X-Tile-Z": String(z),
        "X-Tile-X": String(x),
        "X-Tile-Y": String(y),
        "Vary": "Accept-Encoding",
      },
    })
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to generate vector tile" },
      { status: 500 },
    )
  }
}
