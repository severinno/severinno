/**
 * Loyalty System — points, badges, streaks, rewards.
 *
 * Providers earn points for:
 *   - Completing bookings (+10 pts)
 *   - Getting 5-star reviews (+20 pts)
 *   - Maintaining 4.8+ rating (+5 pts/week)
 *   - Referring other providers (+50 pts)
 *
 * Clients earn points for:
 *   - Making bookings (+5 pts)
 *   - Leaving reviews (+10 pts)
 *   - Referring friends (+25 pts)
 *
 * Badges:
 *   - 🥉 Bronze: 100 pts
 *   - 🥈 Prata: 500 pts
 *   - 🥇 Ouro: 1000 pts
 *   - 💎 Diamante: 5000 pts
 *   - ⭐ Pro: 10+ bookings completed
 *   - 🔥 Streak: 4+ consecutive weeks with bookings
 */
import { db } from "./db"
import { cacheGet, cacheSet } from "./redis"
import logger from "./logger"

// ── Types ─────────────────────────────────────────────────────────────────

export type LoyaltyTier = "bronze" | "prata" | "ouro" | "diamante"

export type LoyaltyBadge = {
  id: string
  name: string
  emoji: string
  description: string
  earnedAt: string
}

export type LoyaltyStats = {
  points: number
  tier: LoyaltyTier
  badges: LoyaltyBadge[]
  streak: number
  totalBookings: number
  totalReviews: number
  nextTier: { name: string; pointsNeeded: number } | null
}

const TIER_THRESHOLDS: Record<LoyaltyTier, number> = {
  bronze: 0,
  prata: 100,
  ouro: 500,
  diamante: 1000,
}

const TIER_NAMES: Record<LoyaltyTier, string> = {
  bronze: "🥉 Bronze",
  prata: "🥈 Prata",
  ouro: "🥇 Ouro",
  diamante: "💎 Diamante",
}

// ── Points Engine ─────────────────────────────────────────────────────────

/**
 * Award points to a user for an action.
 */
export async function awardPoints(
  userId: string,
  action: "booking_completed" | "five_star_review" | "review_left" | "referral" | "weekly_streak",
): Promise<{ points: number; total: number; newBadges: string[] }> {
  const POINT_VALUES: Record<string, number> = {
    booking_completed: 10,
    five_star_review: 20,
    review_left: 10,
    referral: 50,
    weekly_streak: 5,
  }

  const points = POINT_VALUES[action] ?? 0
  if (points === 0) return { points: 0, total: 0, newBadges: [] }

  // Get current points
  const current = await cacheGet<number>(`loyalty:points:${userId}`) ?? 0
  const newTotal = current + points

  // Store new points
  await cacheSet(`loyalty:points:${userId}`, newTotal, 365 * 24 * 60 * 60) // 1 year

  // Store transaction log
  const txKey = `loyalty:tx:${userId}`
  const txs = await cacheGet<Array<{ action: string; points: number; at: number }>>(txKey) ?? []
  txs.push({ action, points, at: Date.now() })
  if (txs.length > 100) txs.splice(0, txs.length - 100) // keep last 100
  await cacheSet(txKey, txs, 365 * 24 * 60 * 60)

  // Check for new badges
  const newBadges = await checkBadges(userId, newTotal)

  logger.info({ userId, action, points, total: newTotal }, "loyalty: points awarded")

  return { points, total: newTotal, newBadges }
}

/**
 * Get loyalty stats for a user.
 */
export async function getLoyaltyStats(userId: string): Promise<LoyaltyStats> {
  const points = await cacheGet<number>(`loyalty:points:${userId}`) ?? 0
  const tier = getTier(points)
  const badges = await getUserBadges(userId)
  const streak = await getStreak(userId)

  // Get booking/review counts
  const [totalBookings, totalReviews] = await Promise.all([
    db.booking.count({ where: { OR: [{ clientId: userId }, { providerId: userId }], status: "COMPLETED" } }),
    db.review.count({ where: { OR: [{ clientId: userId }, { providerId: userId }] } }),
  ])

  // Next tier
  const tiers: LoyaltyTier[] = ["bronze", "prata", "ouro", "diamante"]
  const currentIdx = tiers.indexOf(tier)
  const nextTier = currentIdx < tiers.length - 1
    ? { name: TIER_NAMES[tiers[currentIdx + 1]!], pointsNeeded: TIER_THRESHOLDS[tiers[currentIdx + 1]!] - points }
    : null

  return { points, tier, badges, streak, totalBookings, totalReviews, nextTier }
}

// ── Tier Calculation ──────────────────────────────────────────────────────

function getTier(points: number): LoyaltyTier {
  if (points >= 1000) return "diamante"
  if (points >= 500) return "ouro"
  if (points >= 100) return "prata"
  return "bronze"
}

// ── Streak Tracking ───────────────────────────────────────────────────────

async function getStreak(userId: string): Promise<number> {
  const streakData = await cacheGet<{ count: number; lastWeek: number }>(`loyalty:streak:${userId}`)
  return streakData?.count ?? 0
}

export async function updateStreak(userId: string): Promise<void> {
  const now = Date.now()
  const weekMs = 7 * 24 * 60 * 60 * 1000
  const currentWeek = Math.floor(now / weekMs)

  const streakData = await cacheGet<{ count: number; lastWeek: number }>(`loyalty:streak:${userId}`)

  if (streakData) {
    if (streakData.lastWeek === currentWeek) {
      // Same week — no change
      return
    }
    if (streakData.lastWeek === currentWeek - 1) {
      // Consecutive week — increment streak
      await cacheSet(`loyalty:streak:${userId}`, {
        count: streakData.count + 1,
        lastWeek: currentWeek,
      }, 365 * 24 * 60 * 60)

      // Award streak bonus at 4+ weeks
      if (streakData.count >= 3) {
        await awardPoints(userId, "weekly_streak")
      }
      return
    }
  }

  // Streak broken or first week
  await cacheSet(`loyalty:streak:${userId}`, {
    count: 1,
    lastWeek: currentWeek,
  }, 365 * 24 * 60 * 60)
}

// ── Badges ────────────────────────────────────────────────────────────────

const BADGE_DEFINITIONS: Array<{
  id: string
  name: string
  emoji: string
  description: string
  check: (points: number, stats: { bookings: number; reviews: number }) => boolean
}> = [
  { id: "bronze", name: "Bronze", emoji: "🥉", description: "100 pontos", check: (p) => p >= 100 },
  { id: "prata", name: "Prata", emoji: "🥈", description: "500 pontos", check: (p) => p >= 500 },
  { id: "ouro", name: "Ouro", emoji: "🥇", description: "1000 pontos", check: (p) => p >= 1000 },
  { id: "diamante", name: "Diamante", emoji: "💎", description: "5000 pontos", check: (p) => p >= 5000 },
  { id: "pro", name: "Pro", emoji: "⭐", description: "10+ bookings completos", check: (_p, s) => s.bookings >= 10 },
  { id: "streak", name: "Streak", emoji: "🔥", description: "4+ semanas consecutivas", check: () => false }, // checked separately
]

async function checkBadges(userId: string, points: number): Promise<string[]> {
  const newBadges: string[] = []
  const existingBadges = await cacheGet<string[]>(`loyalty:badges:${userId}`) ?? []

  const stats = {
    bookings: await db.booking.count({ where: { OR: [{ clientId: userId }, { providerId: userId }], status: "COMPLETED" } }),
    reviews: await db.review.count({ where: { OR: [{ clientId: userId }, { providerId: userId }] } }),
  }

  for (const badge of BADGE_DEFINITIONS) {
    if (existingBadges.includes(badge.id)) continue
    if (badge.check(points, stats)) {
      newBadges.push(badge.id)
    }
  }

  if (newBadges.length > 0) {
    const allBadges = [...existingBadges, ...newBadges]
    await cacheSet(`loyalty:badges:${userId}`, allBadges, 365 * 24 * 60 * 60)
  }

  return newBadges
}

async function getUserBadges(userId: string): Promise<LoyaltyBadge[]> {
  const badgeIds = await cacheGet<string[]>(`loyalty:badges:${userId}`) ?? []

  return badgeIds.map((id) => {
    const def = BADGE_DEFINITIONS.find((b) => b.id === id)
    return {
      id,
      name: def?.name ?? id,
      emoji: def?.emoji ?? "🏅",
      description: def?.description ?? "",
      earnedAt: new Date().toISOString(), // Approximate
    }
  })
}
