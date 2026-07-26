import { NextResponse } from "next/server"
import { reverseGeocode } from "@/lib/geo"
import { cacheControlPublic, handleError } from "@/lib/api-server"
import { withCache } from "@/lib/redis"

// Simple in-memory rate limiter for Nominatim (1 req/s per OSM policy).
// Resets every second — tracks the last request timestamp.
let lastNominatimRequest = 0

async function rateLimitedReverseGeocode(lat: number, lng: number) {
  const now = Date.now()
  const elapsed = now - lastNominatimRequest
  if (elapsed < 1000) {
    // Wait just enough to respect the 1 req/s limit
    await new Promise((r) => setTimeout(r, 1000 - elapsed))
  }
  lastNominatimRequest = Date.now()
  return reverseGeocode(lat, lng)
}

// Public: reverse geocode lat/lng via Nominatim (OSM).
// Returns a flat object (UI: `apiGet<{ street?, district?, city?, state?, cep? }>`).
// Cached in Redis for 1h with rate limiting to respect OSM policy (1 req/s).
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const latRaw = searchParams.get("lat")
    const lngRaw = searchParams.get("lng")
    if (!latRaw || !lngRaw || !Number.isFinite(Number(latRaw)) || !Number.isFinite(Number(lngRaw))) {
      return NextResponse.json(
        { error: "Lat/lng inválidos" },
        { status: 400 },
      )
    }

    // Round coords to 4 decimals (~11m precision) for cache key
    const key = `geo:reverse:${Number(latRaw).toFixed(4)},${Number(lngRaw).toFixed(4)}`
    const address = await withCache(
      key,
      () => rateLimitedReverseGeocode(Number(latRaw), Number(lngRaw)),
      3600, // 1h
    )

    // Flatten the address — UI expects street/district/city/state/cep at the
    // top level (not nested under an `address` key).
    return cacheControlPublic(NextResponse.json({
      street: address.road ?? null,
      district: address.neighbourhood ?? null,
      city: address.city ?? null,
      state: address.state ?? null,
      cep: address.postcode ?? null,
      displayName: address.displayName,
    }), 60)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao geocodificar"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
