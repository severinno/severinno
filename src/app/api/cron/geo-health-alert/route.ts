import { NextResponse } from "next/server"
import { evaluateGeoHealth, type GeoHealthInput } from "@/lib/geo-health-alert"
import logger from "@/lib/logger"
import { handleError } from "@/lib/api-server"

/**
 * GET /api/cron/geo-health-alert
 *
 * Triggered by an external scheduler (cron-job.org, systemd timer, etc.)
 * at a regular interval — recommended: every 5 minutes.
 *
 * Calls the internal /api/health endpoint and evaluates geo service status
 * (Nominatim, ViaCEP, PostGIS). If any service has been degraded for more
 * than CONSECUTIVE_FAILURES_THRESHOLD consecutive checks, sends a
 * notification to the admin (Sentry + email).
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
  try {
    // ── Auth ─────────────────────────────────────────────────────────
    const auth = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET ?? ""

    if (!cronSecret) {
      logger.warn("geo-health-alert: CRON_SECRET not configured — skipping auth check")
    } else if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: "Unauthorized — provide a valid Bearer token" },
        { status: 401 },
      )
    }

    // ── Fetch health data ──────────────────────────────────────────
    const baseUrl = getBaseUrl()
    const startedAt = Date.now()

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

    // ── Evaluate and alert ─────────────────────────────────────────
    const result = await evaluateGeoHealth(checks)
    const elapsed = Date.now() - startedAt

    logger.info(
      {
        checked: result.checked,
        degraded: result.degraded,
        alertsSent: result.alertsSent,
        recoveriesSent: result.recoveriesSent,
        elapsed,
      },
      "cron geo-health-alert completed",
    )

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      elapsed,
      checks: {
        nominatim: checks.nominatim.status,
        viacep: checks.viacep.status,
        postgis: checks.postgis.status,
      },
      summary: {
        degraded: result.degraded,
        alertsSent: result.alertsSent,
        recoveriesSent: result.recoveriesSent,
      },
      services: result.services.map((s) => ({
        name: s.name,
        status: s.status,
        consecutiveFailures: s.consecutiveFailures,
        alerted: s.alerted,
        recovered: s.recovered,
      })),
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
