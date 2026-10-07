export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { isEnabled, setFlag, clearFlag, getAllFlags, type FeatureFlag } from "@/lib/feature-flags"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { withRoute } from "@/lib/api-route"

const VALID_FLAGS: FeatureFlag[] = [
  "circuit-breaker-evolution",
  "circuit-breaker-push",
  "circuit-breaker-email",
  "circuit-breaker-lytex",
  "circuit-breaker-nominatim",
  "circuit-breaker-viacep",
  "circuit-breaker-osrm",
  "h3-clustering",
  "postgis-spatial-query",
  "redis-geo-index-seed",
  "wallet-serializable-tx",
  "geo-cache-local",
  "geo-metrics-async-persist",
  "geo-alert-redis-debounce",
  "dynamic-h3-resolution",
  "geocode-search-layered",
  "reverse-geocode-cache",
]

export const GET = withRoute("api.admin.feature-flags.GET", async (_request) => {
  await requireRole("ADMIN")
  const flags = getAllFlags()
  return NextResponse.json({ flags })
})

export const PATCH = withRoute("api.admin.feature-flags.PATCH", async (request) => {
  await requireRole("ADMIN")
  await assertRateLimit(request, RATE_LIMITS.admin)
  const body = await request.json()
  const { flag, enabled } = body as { flag?: string; enabled?: boolean }
  if (!flag || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "flag and enabled required" }, { status: 400 })
  }
  if (!VALID_FLAGS.includes(flag as FeatureFlag)) {
    return NextResponse.json({ error: `Invalid flag: ${flag}` }, { status: 400 })
  }
  setFlag(flag as FeatureFlag, enabled)
  return NextResponse.json({ flag, enabled, source: "runtime" })
})

export const DELETE = withRoute("api.admin.feature-flags.DELETE", async (request) => {
  await requireRole("ADMIN")
  const { searchParams } = new URL(request.url)
  const flag = searchParams.get("flag")
  if (!flag) {
    return NextResponse.json({ error: "flag query param required" }, { status: 400 })
  }
  clearFlag(flag as FeatureFlag)
  return NextResponse.json({ flag, enabled: isEnabled(flag as FeatureFlag), source: "default" })
})
