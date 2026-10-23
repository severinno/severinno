export const dynamic = "force-dynamic"

/**
 * POST /api/admin/geo-rate-limit-status/reset
 *
 * Resets the geo rate limiter counters and in-memory tracking state
 * without restarting the server.
 *
 * This is useful for:
 *   - Clearing diagnostic data after debugging
 *   - Resetting counters before a load test
 *   - Daily cleanup without redeploy
 *
 * Redis-backed entries are NOT cleared (they expire naturally via TTL).
 * Only the in-memory counters and tracking Map are reset.
 *
 * Requires admin authentication.
 */

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { resetRateLimiter, getRateLimitCounters } from "@/lib/geo-rate-limit"

import { withRoute } from "@/lib/api-route"

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const POST = withRoute("api.admin.geo-rate-limit-status.reset.POST", async (_request) => {
  await requireRole("ADMIN")

  // Snapshot counters before reset for the response
  const before = getRateLimitCounters()

  resetRateLimiter()

  return NextResponse.json({
    success: true,
    message: "Rate limiter resetado com sucesso.",
    before,
    timestamp: Date.now(),
  })
})
