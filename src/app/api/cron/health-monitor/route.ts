import { NextResponse } from "next/server"
import { runHealthMonitor } from "@/lib/health-monitor"
import logger from "@/lib/logger"
import { handleError } from "@/lib/api-server"

/**
 * GET /api/cron/health-monitor
 *
 * Triggered by an external scheduler (cron-job.org, systemd timer, etc.)
 * at a regular interval (recommended: every 5 minutes).
 *
 * Runs the full health monitor check and sends structured Sentry/GlitchTip
 * events for any unhealthy or degraded services. This enables GlitchTip
 * alert rules to fire on real system failures.
 *
 * Authentication:
 *   Requires the `CRON_SECRET` environment variable. The caller must pass
 *   it as a Bearer token in the Authorization header.
 *
 * Example cron-job.org configuration:
 *   URL:     https://severinno.com.br/api/cron/health-monitor
 *   Method:  GET
 *   Header:  Authorization: Bearer <CRON_SECRET>
 *   Period:  Every 5 minutes
 *
 * Response:
 *   200: Monitor check completed (health may be healthy, degraded, or unhealthy)
 *   401: Missing or invalid Authorization header
 */

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    // ── Auth ─────────────────────────────────────────────────────────
    const auth = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET ?? ""

    if (!cronSecret) {
      logger.warn("health-monitor: CRON_SECRET not configured — skipping auth check")
    } else if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: "Unauthorized — provide a valid Bearer token" },
        { status: 401 },
      )
    }

    // ── Run monitor ──────────────────────────────────────────────────
    const startedAt = Date.now()
    const result = await runHealthMonitor()
    const elapsed = Date.now() - startedAt

    logger.info(
      {
        overallStatus: result.overallStatus,
        alertsSent: result.alertsSent,
        healthy: result.healthyCount,
        degraded: result.degradedCount,
        unhealthy: result.unhealthyCount,
        elapsed,
      },
      "cron health-monitor completed",
    )

    // ── Response ──────────────────────────────────────────────────────
    return NextResponse.json({
      ok: true,
      healthy: result.healthy,
      status: result.overallStatus,
      summary: {
        healthy: result.healthyCount,
        degraded: result.degradedCount,
        unhealthy: result.unhealthyCount,
        total: result.totalServices,
      },
      alertsSent: result.alertsSent,
      services: result.services.map((s) => ({
        name: s.name,
        status: s.status,
        alerted: s.alerted,
      })),
      elapsed,
      timestamp: result.timestamp,
      // GlitchTip alert configuration guide (compact, for reference)
      glitchtipAlerts: {
        docs: "Configure alerts in GlitchTip UI → Alerts → New Alert Rule",
        filterBy: {
          level: { error: "Unhealthy services", warning: "Degraded services" },
          tags: "service:<name>",
          title: '[HealthMonitor]',
        },
        actions: ["Send email", "Send Telegram", "Send Discord", "Send Webhook"],
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
