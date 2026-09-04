export const dynamic = "force-dynamic"

/**
 * POST /api/admin/global-rate-limit-status/reset
 *
 * Resets the global (middleware) rate limiter in-memory store without
 * restarting the server.
 *
 * This is useful for:
 *   - Clearing accumulated entries after a traffic spike or DDoS simulation
 *   - Resetting counters before a load test
 *   - Debugging: reset the store and verify the dashboard reflects 0 entries
 *
 * The global rate limiter is purely in-memory (no Redis backing), so this
 * reset clears ALL tracked IP+route entries immediately.  The store will
 * begin repopulating as new requests arrive through the middleware.
 *
 * Requires admin authentication.
 */

import { handleError } from "@/lib/api-server"
import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { getGlobalRateLimitDiagnostics, resetGlobalRateLimiter } from "@/lib/global-rate-limit"

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function POST() {
  try {
    await requireRole("ADMIN")

    // Snapshot before reset for the response
    const before = getGlobalRateLimitDiagnostics()

    resetGlobalRateLimiter()

    return NextResponse.json({
      success: true,
      message: "Rate limiter global resetado com sucesso.",
      before,
      timestamp: Date.now(),
    })
  } catch (e) {
    return handleError(e)
  }
}
