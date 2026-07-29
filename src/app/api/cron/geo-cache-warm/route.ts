import { NextResponse } from "next/server"
import { warmGeoCache, getWarmConfig } from "@/lib/geo-cache-warm"
import logger from "@/lib/logger"
import { handleError } from "@/lib/api-server"

/**
 * GET /api/cron/geo-cache-warm
 *
 * Warms the Redis cache with the most frequent geo queries — top Brazilian
 * cities, common CEPs, and major city coordinates — so the first users
 * after a server restart get cached responses instead of the 5s Nominatim
 * / ViaCEP latency.
 *
 * **When to call:**
 *   - After every deployment / server restart
 *   - Ideally via a post-deploy hook (e.g., after `docker compose up`)
 *   - Also runnable on a daily schedule during low traffic (3 AM)
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
 *   200: Warm completed with summary
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
    const cronSecret = process.env.CRON_SECRET ?? ""

    if (!cronSecret) {
      logger.warn("geo-cache-warm: CRON_SECRET not configured — skipping auth")
    } else if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: "Unauthorized — provide a valid Bearer token" },
        { status: 401 },
      )
    }

    const config = getWarmConfig()
    logger.info({ totalQueries: config.totalQueries }, "geo-cache-warm: starting")

    const result = await warmGeoCache()

    const response = {
      ok: true,
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
