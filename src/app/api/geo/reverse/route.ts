export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { reverseGeocode } from "@/lib/geo"
import { cacheControlPublic } from "@/lib/api-server"
import { assertGeoRateLimit, isGeoRateLimitError } from "@/lib/geo-rate-limit"

// Public: reverse geocode lat/lng via Nominatim (OSM).
// Returns a flat object (UI: `apiGet<{ street?, district?, city?, state?, cep? }>`).
// Cached internally by reverseGeocode via withCachedGeo (Redis, 24h TTL).
export async function GET(request: Request) {
  try {
    await assertGeoRateLimit(request, "reverse")

    const { searchParams } = new URL(request.url)
    const latRaw = searchParams.get("lat")
    const lngRaw = searchParams.get("lng")
    if (
      !latRaw ||
      !lngRaw ||
      !Number.isFinite(Number(latRaw)) ||
      !Number.isFinite(Number(lngRaw))
    ) {
      return noStoreJson({ error: "Lat/lng inválidos" }, 400)
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
    // Rate limit (429) precisa preservar status + headers — o catch genérico
    // abaixo mapearia para 502.
    if (isGeoRateLimitError(e)) {
      return noStoreJson({ error: e.message }, 429, e.headers)
    }
    const msg = e instanceof Error ? e.message : "Erro ao geocodificar"
    return noStoreJson({ error: msg }, 502)
  }
}

/**
 * JSON error response that must NEVER be cached (house rule: errors carry
 * `Cache-Control: no-store`). Same contract as geo-middleware and all other
 * routes — a cached 4xx/5xx would pin a failure for the cache TTL.
 */
function noStoreJson(
  body: unknown,
  status: number,
  headers?: Record<string, string>,
): NextResponse {
  const response = NextResponse.json(body, { status, headers })
  response.headers.set("Cache-Control", "no-store")
  return response
}
