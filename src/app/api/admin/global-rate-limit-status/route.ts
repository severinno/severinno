/**
 * GET /api/admin/global-rate-limit-status
 *
 * Exposes the current state of the global (middleware) rate limiter for
 * debugging in the admin dashboard:
 *   - In-memory store size (number of tracked IP+route entries)
 *   - Current configuration (max requests, window, bypass IPs, whitelist)
 *   - Timestamp of the snapshot
 *
 * Unlike the geo-rate-limit-status endpoint, the global rate limiter is
 * purely in-memory (no Redis backing) — this is by design for Edge/Middleware
 * compatibility.  A large storeSize (>1000) may indicate a DDoS attempt or
 * misconfigured proxy headers.
 *
 * Requires admin authentication.
 *
 * This endpoint reads from the in-memory store only — fast and safe for
 * the admin dashboard.
 */

import { handleError } from "@/lib/api-server"
import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { getGlobalRateLimitDiagnostics } from "@/lib/global-rate-limit"

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    await requireRole("ADMIN")

    const diagnostics = getGlobalRateLimitDiagnostics()

    return NextResponse.json(diagnostics)
  } catch (e) {
    return handleError(e)
  }
}

// ---------------------------------------------------------------------------
// Response type (exported for the client component)
// ---------------------------------------------------------------------------

export type { GlobalRateLimitDiagnostics as GlobalRateLimitStatusResponse } from "@/lib/global-rate-limit"
