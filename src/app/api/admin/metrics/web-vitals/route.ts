export const dynamic = "force-dynamic"

/**
 * GET /api/admin/metrics/web-vitals
 * DELETE /api/admin/metrics/web-vitals
 *
 * Real-time Core Web Vitals telemetry dashboard endpoint:
 * - Aggregates LCP, INP, CLS, FCP, and TTFB samples
 * - Computes p50, p75, p90, and p95 distributions
 * - Evaluates compliance against Google Core Web Vitals thresholds
 * - Allows administrative reset
 */

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { withRoute } from "@/lib/api-route"
import { webVitalsRegistry } from "@/lib/web-vitals-registry"

export const GET = withRoute("api.admin.metrics.web-vitals.GET", async () => {
  await requireRole("ADMIN")
  const summary = webVitalsRegistry.getSummary()
  return NextResponse.json(summary)
})

export const DELETE = withRoute("api.admin.metrics.web-vitals.DELETE", async () => {
  await requireRole("ADMIN")
  webVitalsRegistry.reset()
  return NextResponse.json({
    success: true,
    message: "Web vitals telemetry buffer reset successfully",
  })
})
