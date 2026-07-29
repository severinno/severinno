import { NextResponse } from "next/server"
import { reverseGeocode } from "@/lib/geo"
import { cacheControlPublic, handleError } from "@/lib/api-server"

// Public: reverse geocode lat/lng via Nominatim (OSM).
// Returns a flat object (UI: `apiGet<{ street?, district?, city?, state?, cep? }>`).
// Cached internally by reverseGeocode via withCachedGeo (Redis, 24h TTL).
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const latRaw = searchParams.get("lat")
    const lngRaw = searchParams.get("lng")
    if (
      !latRaw ||
      !lngRaw ||
      !Number.isFinite(Number(latRaw)) ||
      !Number.isFinite(Number(lngRaw))
    ) {
      return NextResponse.json({ error: "Lat/lng inválidos" }, { status: 400 })
    }

    // Cache é gerenciado internamente por reverseGeocode (via withCachedGeo, 24h TTL)
    const address = await reverseGeocode(Number(latRaw), Number(lngRaw))

    // Flatten the address — UI expects street/district/city/state/cep at the
    // top level (not nested under an `address` key).
    return cacheControlPublic(
      NextResponse.json({
        street: address.road ?? null,
        district: address.neighbourhood ?? null,
        city: address.city ?? null,
        state: address.state ?? null,
        cep: address.postcode ?? null,
        displayName: address.displayName,
      }),
      60,
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao geocodificar"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
