import { NextRequest, NextResponse } from "next/server"
import { getVectorTileData } from "@/lib/vector-tiles"

interface RouteParams {
  params: Promise<{
    z: string
    x: string
    y: string
  }>
}

export async function GET(req: NextRequest, { params }: RouteParams) {
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

    // Return with aggressive browser and CDN caching
    return NextResponse.json(tileData, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
        "X-Tile-Z": String(z),
        "X-Tile-X": String(x),
        "X-Tile-Y": String(y),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate vector tile" },
      { status: 500 },
    )
  }
}
