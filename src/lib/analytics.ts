/**
 * Conversion Analytics — track the full user funnel.
 *
 * Funnel stages:
 *   1. LANDING    — user visits the site
 *   2. SIGNUP     — user creates account
 *   3. ONBOARDING — provider completes onboarding
 *   4. SEARCH     — client searches for services
 *   5. BOOKING    — client makes a booking
 *   6. COMPLETED  — service is completed
 *   7. REVIEW     — client leaves a review
 *   8. RETENTION  — client books again within 30 days
 *
 * All events stored in Redis (TTL 90 days) for querying.
 * Dashboard endpoint: /api/admin/analytics
 */
import { cacheGet, cacheSet, getClient } from "./redis"

import logger from "./logger"

// ── Event Types ───────────────────────────────────────────────────────────

export type FunnelStage =
  "landing" | "signup" | "onboarding" | "search" | "booking" | "completed" | "review" | "retention"

export type AnalyticsEvent = {
  stage: FunnelStage
  userId?: string
  role?: "CLIENT" | "PROVIDER"
  metadata?: Record<string, unknown>
  timestamp: number
}

// ── Tracking ──────────────────────────────────────────────────────────────

/**
 * Track a funnel event.
 *
 * @example
 *   await trackEvent("signup", { userId: user.id, role: "CLIENT" })
 *   await trackEvent("booking", { userId: client.id, metadata: { bookingId, amount } })
 */
export async function trackEvent(
  stage: FunnelStage,
  data: { userId?: string; role?: "CLIENT" | "PROVIDER"; metadata?: Record<string, unknown> },
): Promise<void> {
  const event: AnalyticsEvent = {
    stage,
    userId: data.userId,
    role: data.role,
    metadata: data.metadata,
    timestamp: Date.now(),
  }

  try {
    // Store in Redis sorted set (score = timestamp)
    const client = getClient()
    if (client) {
      const key = `analytics:${stage}`
      await client.zadd(key, event.timestamp, JSON.stringify(event))
      // Expire after 90 days
      await client.expire(key, 90 * 24 * 60 * 60)
    }

    // Also store per-user funnel
    if (data.userId) {
      const userKey = `analytics:user:${data.userId}`
      const existing = (await cacheGet<AnalyticsEvent[]>(userKey)) ?? []
      existing.push(event)
      await cacheSet(userKey, existing, 90 * 24 * 60 * 60)
    }

    logger.debug({ stage, userId: data.userId }, "analytics: event tracked")
  } catch {
    // Best-effort — analytics shouldn't break the app
  }
}

// ── Queries ───────────────────────────────────────────────────────────────

/**
 * Get funnel summary for a time period.
 */
export async function getFunnelSummary(
  startMs: number,
  endMs: number,
): Promise<Record<FunnelStage, { total: number; byRole: { CLIENT: number; PROVIDER: number } }>> {
  const stages: FunnelStage[] = [
    "landing",
    "signup",
    "onboarding",
    "search",
    "booking",
    "completed",
    "review",
    "retention",
  ]
  const result: Record<
    FunnelStage,
    { total: number; byRole: { CLIENT: number; PROVIDER: number } }
  > = {} as Record<FunnelStage, { total: number; byRole: { CLIENT: number; PROVIDER: number } }>

  const cacheKey = `analytics:summary:${startMs}:${endMs}`
  try {
    const cached =
      await cacheGet<
        Record<FunnelStage, { total: number; byRole: { CLIENT: number; PROVIDER: number } }>
      >(cacheKey)
    if (cached) return cached
  } catch {
    // Cache miss
  }

  for (const stage of stages) {
    result[stage] = { total: 0, byRole: { CLIENT: 0, PROVIDER: 0 } }
  }

  try {
    const client = getClient()
    if (!client) return result

    for (const stage of stages) {
      const key = `analytics:${stage}`
      // Get events in time range using ZRANGEBYSCORE
      const events = await client.zrangebyscore(key, startMs, endMs)
      result[stage].total = events.length

      for (const raw of events) {
        try {
          const event = JSON.parse(raw) as AnalyticsEvent
          if (event.role === "CLIENT") result[stage].byRole.CLIENT++
          else if (event.role === "PROVIDER") result[stage].byRole.PROVIDER++
        } catch {
          // Skip corrupted entries
        }
      }
    }
    // Cache summary for 5 minutes
    await cacheSet(cacheKey, result, 300)
  } catch {
    // Redis unavailable
  }

  return result
}

/**
 * Get conversion rates between funnel stages.
 */
export async function getConversionRates(
  startMs: number,
  endMs: number,
): Promise<
  Array<{
    from: FunnelStage
    to: FunnelStage
    rate: number | null
    absolute: number
  }>
> {
  const funnel = await getFunnelSummary(startMs, endMs)
  const stages: FunnelStage[] = [
    "landing",
    "signup",
    "onboarding",
    "search",
    "booking",
    "completed",
    "review",
    "retention",
  ]

  const rates: Array<{
    from: FunnelStage
    to: FunnelStage
    rate: number | null
    absolute: number
  }> = []

  for (let i = 0; i < stages.length - 1; i++) {
    const from = stages[i]!
    const to = stages[i + 1]!
    const fromCount = funnel[from].total
    const toCount = funnel[to].total

    rates.push({
      from,
      to,
      rate: fromCount > 0 ? +((toCount / fromCount) * 100).toFixed(1) : null,
      absolute: toCount,
    })
  }

  return rates
}

/**
 * Get user-level funnel (did a specific user complete all stages?).
 */
export async function getUserFunnel(userId: string): Promise<AnalyticsEvent[]> {
  try {
    const events = await cacheGet<AnalyticsEvent[]>(`analytics:user:${userId}`)
    return events ?? []
  } catch {
    return []
  }
}

/**
 * Get daily event counts for a stage (for charts).
 */
export async function getDailyCounts(
  stage: FunnelStage,
  days: number = 30,
): Promise<Array<{ date: string; count: number }>> {
  const cacheKey = `analytics:daily:${stage}:${days}`
  try {
    const cached = await cacheGet<Array<{ date: string; count: number }>>(cacheKey)
    if (cached) return cached
  } catch {
    // Cache miss
  }

  const result: Array<{ date: string; count: number }> = []
  const now = Date.now()
  const msPerDay = 24 * 60 * 60 * 1000

  try {
    const client = getClient()
    if (!client) return result

    const key = `analytics:${stage}`

    for (let i = days - 1; i >= 0; i--) {
      const dayStart = now - (i + 1) * msPerDay
      const dayEnd = now - i * msPerDay
      const date = new Date(dayEnd).toISOString().split("T")[0]!

      const count = await client.zcount(key, dayStart, dayEnd)
      result.push({ date, count })
    }

    // Cache daily counts for 5 minutes
    await cacheSet(cacheKey, result, 300)
  } catch {
    // Redis unavailable
  }

  return result
}
