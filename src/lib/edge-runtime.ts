/**
 * Edge Runtime helpers for public read-only endpoints
 *
 * Endpoints that can run on Edge Runtime:
 * - GET /api/providers (read-only, no DB writes)
 * - GET /api/search (read-only)
 * - GET /api/geo/* (geocoding, reverse geocoding)
 * - GET /api/health
 *
 * Benefits:
 * - ~20ms latency vs ~200ms on Node.js
 * - Global CDN deployment
 * - No cold start penalty
 *
 * Usage in route.ts:
 *   export const runtime = "edge"
 *   import { edgeResponse, edgeError } from "@/lib/edge-runtime"
 */

import { NextResponse } from "next/server"

/** Allowed origins for CORS (configurable via env) */
const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL,
  "http://localhost:3000",
  "http://localhost:3001",
].filter(Boolean) as string[]

/** Resolve the CORS origin for a given request origin */
function resolveCorsOrigin(requestOrigin: string | null): string {
  if (!requestOrigin) return ALLOWED_ORIGINS[0] || ""
  if (ALLOWED_ORIGINS.includes(requestOrigin)) return requestOrigin
  // Allow any *.vercel.app in dev/staging
  if (requestOrigin.endsWith(".vercel.app") && process.env.NODE_ENV !== "production") {
    return requestOrigin
  }
  return ""
}

/** Standard success response with CORS for edge runtime */
export function edgeResponse<T>(data: T, status = 200, requestOrigin?: string | null): NextResponse {
  const origin = resolveCorsOrigin(requestOrigin ?? null)
  return NextResponse.json(data, {
    status,
    headers: {
      ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      "Vary": "Accept-Encoding, Origin",
    },
  })
}

/** Standard error response for edge runtime */
export function edgeError(message: string, status = 500): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

/** CORS preflight handler */
export function edgeCors(requestOrigin?: string | null): NextResponse {
  const origin = resolveCorsOrigin(requestOrigin ?? null)
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    },
  })
}

/**
 * Extract client IP from edge request headers.
 * Works on Cloudflare Workers, Vercel Edge, Deno Deploy.
 */
export function getClientIp(request: Request): string | null {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null
  )
}

/**
 * Extract geolocation from edge request (Cloudflare).
 */
export function getEdgeGeo(request: Request): {
  latitude?: number
  longitude?: number
  country?: string
  city?: string
} {
  const country = request.headers.get("cf-ipcountry") || undefined
  // Cloudflare Workers have request.cf for geo data
  const cf = (request as Request & { cf?: Record<string, unknown> }).cf
  return {
    latitude: cf?.latitude as number | undefined,
    longitude: cf?.longitude as number | undefined,
    country,
    city: cf?.city as string | undefined,
  }
}
