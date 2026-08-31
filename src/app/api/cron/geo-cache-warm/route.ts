import { NextResponse } from "next/server"
import { warmGeoCache, getWarmConfig } from "@/lib/geo-cache-warm"
import { isCooldownElapsed, markCompleted } from "@/lib/cron-cooldown"
import logger from "@/lib/logger"
import { handleError } from "@/lib/api-server"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cooldown name for this cron job. */
const CRON_NAME = "geo-cache-warm"

/** 23 hours — prevents re-execution within the same day. */
const COOLDOWN_MS = 23 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * GET /api/cron/geo-cache-warm
 *
 * Warms the Redis cache with the most frequent geo queries — top Brazilian
 * cities, common CEPs, and major city coordinates — so the first users
 * after a server restart get cached responses instead of the 5s Nominatim
 * / ViaCEP latency.
 *
 * **Cooldown:** Prevents re-execution within 23 hours of the last successful
 *   run. The cooldown state is stored in Redis (with in-memory fallback) and
 *   survives server restarts. This means frequent invocations (e.g., every
 *   5 min by a cron orchestrator) are safe — only the first call in each
 *   23-hour window actually executes the warming.
 * *   **When to call:**
 *   - After every deployment / server restart (cooldown is fresh, so it runs)
 *   - On a daily schedule during low traffic (3 AM)
 *   - The cooldown prevents duplicate runs if both hooks fire
 *
 * **Duration:** ~30 seconds for the full list of ~48 queries (respects the
 *   1 req/s Nominatim rate limit via rateLimitedNominatim).
 *
 * **Idempotent:** queries already in Redis are skipped (cache hit = no API
 *   call). Safe to call multiple times — subsequent runs are near-instant
 *   since most entries will already be cached.
 *
 * **Authentication:**
 *   Requires CRON_SECRET as Bearer token. Same pattern as
 *   GET /api/cron/geo-health-alert.
 *
 * Environment:
 *   CRON_SECRET   — Shared secret for cron authentication
 *
 * Response:
 *   200: Warm completed (or skipped due to cooldown)
 *   401: Missing or invalid Authorization header
 *
 * @example
 *   curl -H "Authorization: Bearer <CRON_SECRET>" \\
 *        https://severinno.com.br/api/cron/geo-cache-warm
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
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

    // ── Cooldown check ───────────────────────────────────────────────
    const cooldownElapsed = await isCooldownElapsed(CRON_NAME, COOLDOWN_MS)

    if (!cooldownElapsed) {
      const skipResponse = {
        ok: true,
        status: "skipped",
        reason: "cooldown",
        cooldownMs: COOLDOWN_MS,
        timestamp: new Date().toISOString(),
        message:
          "Skipped — last successful run was less than 23 hours ago. " +
          "Use POST /api/cron/geo-cache-warm/clear-cooldown to force a re-run.",
      }
      logger.info(skipResponse, "geo-cache-warm: skipped (cooldown)")
      return NextResponse.json(skipResponse)
    }

    // ── Execute warming ──────────────────────────────────────────────
    const config = getWarmConfig()
    logger.info({ totalQueries: config.totalQueries }, "geo-cache-warm: starting")

    const result = await warmGeoCache()

    // ── Mark cooldown ─────────────────────────────────────────────────
    await markCompleted(CRON_NAME, COOLDOWN_MS)

    const response = {
      ok: true,
      status: "completed",
      timestamp: new Date().toISOString(),
      config,
      result,
      message:
        result.total > 0
          ? `Cache warmed: ${result.total} query(ies) fetched (${result.errors} error(s)). ${result.skipped} already cached.`
          : result.skipped > 0
            ? "All queries already cached — no warming needed."
            : "No queries were warmed.",
    }

    logger.info(response, "geo-cache-warm: done")

    return NextResponse.json(response)
  } catch (e) {
    return handleError(e)
  }
}
