import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"

import {
  getQueryLogDiagnostics,
  getTopSearches,
  getTopCEPs,
  getTopReverses,
} from "@/lib/geo-query-log"

import { withRoute } from "@/lib/api-route"

/**
 * GET /api/admin/geo-query-log
 *
 * Returns the geo query frequency log for the admin dashboard.
 * Shows which geo queries (search, CEP, reverse) are most frequently
 * made by users, enabling the admin to:
 *   - Verify which queries are being cached most often
 *   - Identify candidates for the cache-warming list
 *   - Monitor query volume and distribution
 *
 * Authentication: Requires ADMIN role.
 *
 * Response:
 *   diagnostics — Summary stats (total counts per category)
 *   topSearches  — Top 20 free-form search queries by frequency
 *   topCEPs      — Top 20 CEP lookups by frequency
 *   topReverses  — Top 10 reverse geocode requests by frequency
 *
 * @example
 *   GET /api/admin/geo-query-log
 *   → 200 { diagnostics, topSearches, topCEPs, topReverses }
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = withRoute("api.admin.geo-query-log.GET", async (_request) => {
  await requireRole("ADMIN")

  const diagnostics = getQueryLogDiagnostics()
  const topSearches = getTopSearches(20)
  const topCEPs = getTopCEPs(20)
  const topReverses = getTopReverses(10)

  return NextResponse.json({
    diagnostics,
    topSearches,
    topCEPs,
    topReverses,
  })
})
