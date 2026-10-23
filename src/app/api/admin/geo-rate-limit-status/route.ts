export const dynamic = "force-dynamic"

/**
 * GET /api/admin/geo-rate-limit-status
 *
 * Exposes the current state of the geo rate limiter for debugging in the admin
 * dashboard:
 *   - Per-endpoint configuration (max requests, window)
 *   - Number of unique IPs tracked per endpoint
 *   - Top IPs by request count (up to 5 per endpoint) with remaining capacity
 *   - Redis vs in-memory ratio
 *   - Memory store size
 *
 * Requires admin authentication.
 *
 * This endpoint reads from the in-memory store only (no Redis queries) —
 * fast and safe for the admin dashboard.
 */

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { getRateLimitDiagnostics } from "@/lib/geo-rate-limit"

import { withRoute } from "@/lib/api-route"

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const GET = withRoute("api.admin.geo-rate-limit-status.GET", async (_request) => {
  await requireRole("ADMIN")

  const diagnostics = getRateLimitDiagnostics()

  return NextResponse.json(diagnostics)
})

// ---------------------------------------------------------------------------
// Response type (exported for the client component)
// ---------------------------------------------------------------------------

export type { RateLimitDiagnostics as RateLimitStatusResponse } from "@/lib/geo-rate-limit"
