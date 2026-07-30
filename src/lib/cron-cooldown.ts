/**
 * cron-cooldown.ts
 *
 * Redis-backed cooldown tracker for server-side cron jobs.
 *
 * Prevents a cron job from re-executing within a configurable cooldown
 * window (default 23 hours). Mirrors the pattern from client-geo-cache-warm.ts
 * but uses Redis (with in-memory fallback) instead of localStorage.
 *
 * How it works:
 *   1. A Redis key `cron:cooldown:{name}` stores the Unix timestamp of the
 *      last successful run.
 *   2. `isCooldownElapsed(name)` checks if enough time has passed since
 *      that timestamp.
 *   3. `markCompleted(name)` records the current timestamp in Redis.
 *   4. When Redis is unavailable, cooldown is skipped (execution allowed)
 *      to avoid blocking critical maintenance tasks.
 *
 * Usage:
 *   import { isCooldownElapsed, markCompleted } from "@/lib/cron-cooldown"
 *
 *   async function handler() {
 *     if (!(await isCooldownElapsed("geo-cache-warm"))) {
 *       return NextResponse.json({ status: "skipped", reason: "cooldown" })
 *     }
 *
 *     await doWork()
 *     await markCompleted("geo-cache-warm")
 *   }
 */

import { cacheGet, cacheSet } from "./redis"
import logger from "./logger"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 23 hours in milliseconds (default cooldown). */
export const DEFAULT_COOLDOWN_MS = 23 * 60 * 60 * 1000

/** Redis key prefix for cooldown entries. */
const KEY_PREFIX = "cron:cooldown:"

// ---------------------------------------------------------------------------
// Cooldown operations
// ---------------------------------------------------------------------------

/**
 * Build the Redis key for a given cron job name.
 */
function makeKey(name: string): string {
  return `${KEY_PREFIX}${name}`
}

/**
 * Check if the cooldown has elapsed for a given cron job.
 *
 * Returns `true` if:
 *   - No previous run is recorded (first ever execution)
 *   - The cooldown period has passed since the last recorded run
 *   - Redis/cache is unavailable (fail-open: allow execution)
 *
 * Returns `false` if:
 *   - The last run was within the cooldown window
 *
 * @param name       - Unique cron job identifier (e.g. "geo-cache-warm")
 * @param cooldownMs - Cooldown duration in ms (default 23 hours)
 */
export async function isCooldownElapsed(
  name: string,
  cooldownMs: number = DEFAULT_COOLDOWN_MS,
): Promise<boolean> {
  try {
    const raw = await cacheGet<number>(makeKey(name))

    // No previous run recorded → cooldown is elapsed
    if (raw == null) return true

    const lastRun = Number(raw)
    if (!Number.isFinite(lastRun)) {
      // Corrupted entry → treat as elapsed
      logger.warn({ name }, "cron-cooldown: corrupted entry, treating as elapsed")
      return true
    }

    const elapsed = Date.now() - lastRun
    const ready = elapsed >= cooldownMs

    if (!ready) {
      const remainingHrs = Math.round((cooldownMs - elapsed) / 1000 / 60 / 60)
      logger.info(
        { name, lastRun: new Date(lastRun).toISOString(), remainingHrs },
        "cron-cooldown: cooldown active, skipping execution",
      )
    }

    return ready
  } catch {
    // Cache unavailable → fail-open (allow execution)
    logger.warn({ name }, "cron-cooldown: cache unavailable, allowing execution")
    return true
  }
}

/**
 * Mark a cron job as completed, recording the current timestamp.
 *
 * Stores the timestamp in Redis (with in-memory fallback) with a TTL
 * equal to the cooldown period + 1 hour, so the key auto-clears.
 *
 * @param name       - Unique cron job identifier
 * @param cooldownMs - Cooldown duration in ms (used for TTL)
 */
export async function markCompleted(
  name: string,
  cooldownMs: number = DEFAULT_COOLDOWN_MS,
): Promise<void> {
  try {
    // TTL = cooldown + 1h buffer (so the key survives slightly beyond
    // the cooldown window in case of delayed re-check)
    const ttlSeconds = Math.ceil((cooldownMs + 60 * 60 * 1000) / 1000)
    await cacheSet(makeKey(name), Date.now(), ttlSeconds)
    logger.info({ name }, "cron-cooldown: completed, cooldown started")
  } catch {
    // Best-effort — if cache is unavailable, just log
    logger.warn({ name }, "cron-cooldown: failed to persist completion")
  }
}

/**
 * Clear the cooldown state for a given cron job.
 * Useful for testing or manual override.
 */
export async function clearCooldown(name: string): Promise<void> {
  try {
    // Store a very old timestamp to force cooldown expiration
    await cacheSet(makeKey(name), 0, 1)
    logger.info({ name }, "cron-cooldown: cleared")
  } catch {
    // Best-effort
  }
}

/**
 * Get the cooldown diagnostics for a given cron job.
 */
export async function getCooldownDiagnostics(
  name: string,
  cooldownMs: number = DEFAULT_COOLDOWN_MS,
): Promise<{
  elapsed: boolean
  lastRunTimestamp: number | null
  lastRunIso: string | null
  remainingMs: number | null
  cooldownMs: number
}> {
  try {
    const raw = await cacheGet<number>(makeKey(name))
    const lastRun = raw != null && Number.isFinite(raw) ? Number(raw) : null
    const now = Date.now()
    const remainingMs = lastRun != null ? Math.max(0, cooldownMs - (now - lastRun)) : null

    return {
      elapsed: lastRun == null || now - lastRun >= cooldownMs,
      lastRunTimestamp: lastRun,
      lastRunIso: lastRun != null ? new Date(lastRun).toISOString() : null,
      remainingMs,
      cooldownMs,
    }
  } catch {
    return {
      elapsed: true,
      lastRunTimestamp: null,
      lastRunIso: null,
      remainingMs: null,
      cooldownMs,
    }
  }
}
