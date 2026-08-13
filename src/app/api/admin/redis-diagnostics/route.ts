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
import { requireUser } from "@/lib/auth"
import { getRedisDiagnostics } from "@/lib/redis"

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const session = await requireUser()
    if (session.role !== "ADMIN") {
      return NextResponse.json({ error: "Não autorizado" }, { status: 403 })
    }

    const diagnostics = await getRedisDiagnostics()

    return NextResponse.json({
      ...diagnostics,
      timestamp: Date.now(),
    })
  } catch {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }
}

// ---------------------------------------------------------------------------
// Response type (exported for the client component)
// ---------------------------------------------------------------------------

export type RedisDiagnosticsResponse = Awaited<ReturnType<typeof getRedisDiagnostics>>
