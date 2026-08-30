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

/** Standard success response with CORS for edge runtime */
export function edgeResponse<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
    },
  })
}

/** Standard error response for edge runtime */
export function edgeError(message: string, status = 500): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

/** CORS preflight handler */
export function edgeCors(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Max-Age": "86400",
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
