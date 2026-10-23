export const dynamic = "force-dynamic"

/**
 * GET /api/admin/redis-diagnostics
 *
 * Returns comprehensive Redis diagnostics for the admin dashboard:
 *   - Hit/miss ratio and counters
 *   - Cluster mode status and node list (when in cluster mode)
 *   - Slot distribution across nodes
 *   - Top sample keys per node
 *   - In-memory fallback store size
 *
 * Requires admin authentication.
 *
 * Response type: RedisDiagnosticsResponse (exported below)
 */

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { getRedisDiagnostics } from "@/lib/redis"

import { withRoute } from "@/lib/api-route"

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const GET = withRoute("api.admin.redis-diagnostics.GET", async (_request) => {
  await requireRole("ADMIN")

  const diagnostics = await getRedisDiagnostics()

  return NextResponse.json({
    ...diagnostics,
    timestamp: Date.now(),
  })
})

// ---------------------------------------------------------------------------
// Response type (exported for the client component)
// ---------------------------------------------------------------------------

export type RedisDiagnosticsResponse = Awaited<ReturnType<typeof getRedisDiagnostics>>
