export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import type { GeoHealthInput } from "@/lib/geo-health-alert"
import logger from "@/lib/logger"

/**
 * GET /api/cron/geo-health-alert
 *
 * Triggered by an external scheduler (cron-job.org, systemd timer, etc.)
 * at a regular interval — recommended: every 5 minutes.
 *
 * Two layers of monitoring:
 *
 * 1. AVAILABILITY — Calls the internal /api/health endpoint and evaluates
 *    geo service status (Nominatim, ViaCEP, PostGIS). If any service has
 *    been degraded for more than CONSECUTIVE_FAILURES_THRESHOLD consecutive
 *    checks, sends a notification (Sentry + email).
 *
 * 2. PERFORMANCE — Compares the current PostGIS P95 (from the in-memory
 *    sliding window) against 2× the benchmark baseline. If exceeded,
 *    sends a structured Sentry alert indicating possible regression.
 *
 * Authentication:
 *   Requires the `CRON_SECRET` environment variable. The caller must pass
 *   it as a Bearer token in the Authorization header.
 *
 * Environment variables:
 *   CRON_SECRET   — Shared secret for cron authentication
 *   ADMIN_EMAIL   — Email address to send degradation alerts to
 *
 * Example cron-job.org configuration:
 *   URL:     https://severinno.com.br/api/cron/geo-health-alert
 *   Method:  GET
 *   Header:  Authorization: Bearer <CRON_SECRET>
 *   Period:  Every 5 minutes
 *
 * Response:
 *   200: Check completed
 *   401: Missing or invalid Authorization header
 */

export const runtime = "nodejs"

export async function GET(request: Request) {
  // Lazy imports to avoid triggering side effects during next build
  const { evaluateGeoHealth } = await import("@/lib/geo-health-alert")
  const { checkGeoPerformance } = await import("@/lib/geo-performance-alert")
  const { handleError } = await import("@/lib/api-server")

  try {
    // ── Auth ─────────────────────────────────────────────────────────
    const auth = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: "Unauthorized — provide a valid Bearer token" },
        { status: 401 },
      )
    }

    const startedAt = Date.now()

    // ═════════════════════════════════════════════════════════════════
    // LAYER 1: Availability Check
    // ═════════════════════════════════════════════════════════════════

    const baseUrl = getBaseUrl()

    const response = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(30_000),
      headers: { Accept: "application/json" },
    })

    if (!response.ok && response.status !== 503) {
      // 503 is expected when services are degraded — parse the body anyway
      return NextResponse.json(
        { error: `Health endpoint returned HTTP ${response.status}` },
        { status: 502 },
      )
    }

    type HealthResponse = {
      checks: Record<string, "ok" | "error">
      geo: Record<string, string>
    }

    const health: HealthResponse = await response.json()

    // ── Extract geo service status ─────────────────────────────────
    const checks: GeoHealthInput = {
      nominatim: {
        status: health.checks?.nominatim ?? "error",
        detail: health.geo?.nominatim ?? "unreachable",
      },
      viacep: {
        status: health.checks?.viacep ?? "error",
        detail: health.geo?.viacep ?? "unreachable",
      },
      postgis: {
        status: health.checks?.postgis ?? "error",
        detail: health.geo?.postgis ?? "unreachable",
      },
    }

    // ── Evaluate availability and alert ────────────────────────────
    const availabilityResult = await evaluateGeoHealth(checks)

    // ═════════════════════════════════════════════════════════════════
    // LAYER 2: Performance Check (PostGIS P95 vs benchmark baseline)
    // ═════════════════════════════════════════════════════════════════

    const perfResults = await checkGeoPerformance()

    const perfDegraded = perfResults.filter((r) => r.degraded && r.alerted)
    const perfRecovered = perfResults.filter((r) => r.recovered)

    if (perfDegraded.length > 0) {
      logger.warn(
        {
          perfDegraded: perfDegraded.map((r) => ({
            service: "postgis",
            p95: Math.round(r.p95),
            threshold: Math.round(r.threshold),
          })),
        },
        "geo-health-alert: performance regression detected",
      )
    }

    if (perfRecovered.length > 0) {
      logger.info(
        {
          perfRecovered: perfRecovered.map((r) => ({
            service: "postgis",
            p95: Math.round(r.p95),
            threshold: Math.round(r.threshold),
          })),
        },
        "geo-health-alert: performance recovered",
      )
    }

    // ═════════════════════════════════════════════════════════════════
    // Response
    // ═════════════════════════════════════════════════════════════════

    const elapsed = Date.now() - startedAt

    logger.info(
      {
        checked: availabilityResult.checked,
        degraded: availabilityResult.degraded,
        alertsSent: availabilityResult.alertsSent,
        recoveriesSent: availabilityResult.recoveriesSent,
        perfDegradedCount: perfDegraded.length,
        perfRecoveredCount: perfRecovered.length,
        elapsed,
      },
      "cron geo-health-alert completed",
    )

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      elapsed,
      availability: {
        nominatim: checks.nominatim.status,
        viacep: checks.viacep.status,
        postgis: checks.postgis.status,
        degraded: availabilityResult.degraded,
        alertsSent: availabilityResult.alertsSent,
        recoveriesSent: availabilityResult.recoveriesSent,
        services: availabilityResult.services.map((s) => ({
          name: s.name,
          status: s.status,
          consecutiveFailures: s.consecutiveFailures,
          alerted: s.alerted,
          recovered: s.recovered,
        })),
      },
      performance: {
        postgis: {
          p95: Math.round(perfResults[0]?.p95 ?? 0),
          threshold: Math.round(perfResults[0]?.threshold ?? 0),
          baselineMean: Math.round(perfResults[0]?.baselineMean ?? 0),
          baselineSource: perfResults[0]?.baselineSource ?? null,
          degraded: perfResults[0]?.degraded ?? false,
          alerted: perfResults[0]?.alerted ?? false,
          recovered: perfResults[0]?.recovered ?? false,
          consecutiveViolations: perfResults[0]?.consecutiveViolations ?? 0,
        },
      },
    })
  } catch (e) {
    return handleError(e)
  }
}

/**
 * Resolve the internal base URL for self-referencing fetch calls.
 * In Docker, use APP_INTERNAL_URL. In dev, fall back to localhost.
 */
function getBaseUrl(): string {
  const port = process.env.PORT ?? "3000"
  return process.env.APP_INTERNAL_URL ?? `http://127.0.0.1:${port}`
}
