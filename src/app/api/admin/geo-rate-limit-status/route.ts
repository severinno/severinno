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
import { requireUser } from "@/lib/auth"
import { getRateLimitDiagnostics } from "@/lib/geo-rate-limit"

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const session = await requireUser()
    if (session.role !== "ADMIN") {
      return NextResponse.json({ error: "Não autorizado" }, { status: 403 })
    }

    const diagnostics = getRateLimitDiagnostics()

    return NextResponse.json(diagnostics)
  } catch {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }
}

// ---------------------------------------------------------------------------
// Response type (exported for the client component)
// ---------------------------------------------------------------------------

export type { RateLimitDiagnostics as RateLimitStatusResponse } from "@/lib/geo-rate-limit"
