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
  tierName: string
  badges: LoyaltyBadge[]
  streak: number
  totalBookings: number
  totalReviews: number
  nextTier: { name: string; pointsNeeded: number } | null
}

export interface LoyaltyRewardItem {
  id: string
  title: string
  description: string
  pointsCost: number
  category: "taxa" | "visibilidade" | "parceiro" | "cupom"
  icon: string
  badgeText?: string
  expiresInDays: number
}

export interface RedeemedPerk {
  id: string
  rewardId: string
  title: string
  code: string
  pointsCost: number
  category: "taxa" | "visibilidade" | "parceiro" | "cupom"
  redeemedAt: string
  expiresAt: string
  status: "active" | "used" | "expired"
}

export interface LoyaltyTransactionRecord {
  action: string
  label: string
  points: number
  at: number
}

export const LOYALTY_REWARDS_CATALOG: LoyaltyRewardItem[] = [
  {
    id: "taxa_50_desconto",
    title: "50% de Desconto na Taxa Severinno",
    description: "Abatimento de 50% na taxa de intermediação no seu próximo atendimento concluído.",
    pointsCost: 200,
    category: "taxa",
    icon: "Percent",
    badgeText: "Economia no Bolso",
    expiresInDays: 30,
  },
  {
    id: "vitrine_destaque_7d",
    title: "Destaque na Vitrine por 7 Dias",
    description:
      "Selo 'Especialista em Destaque' e prioridade no topo das buscas em Governador Valadares.",
    pointsCost: 300,
    category: "visibilidade",
    icon: "Sparkles",
    badgeText: "Mais Chamados",
    expiresInDays: 7,
  },
  {
    id: "voucher_parceiro_material_50",
    title: "Voucher R$ 50 em Materiais & Ferramentas",
    description:
      "Crédito para compra de materiais elétricos/hidráulicos em parceiros credenciados de GV.",
    pointsCost: 500,
    category: "parceiro",
    icon: "Wrench",
    badgeText: "Lojas Credenciadas",
    expiresInDays: 60,
  },
  {
    id: "voucher_servico_25",
    title: "Cupom R$ 25 para Próximo Serviço",
    description:
      "Voucher de R$ 25 de abatimento direto na mão de obra em qualquer serviço contratado.",
    pointsCost: 150,
    category: "cupom",
    icon: "Ticket",
    badgeText: "Desconto Direto",
    expiresInDays: 45,
  },
  {
    id: "prioridade_despacho_30d",
    title: "Prioridade na Fila de Despacho",
    description:
      "Notificação antecipada de novos chamados e orçamentos na sua rota com exclusividade de 60s.",
    pointsCost: 250,
    category: "visibilidade",
    icon: "Zap",
    badgeText: "Acesso Antecipado",
    expiresInDays: 30,
  },
]

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

export type LoyaltyAction =
  | "booking_completed"
  | "five_star_review"
  | "review_left"
  | "referral"
  | "referral_provider"
  | "referral_welcome_client"
  | "referral_welcome_provider"
  | "weekly_streak"

/**
 * Award points to a user for an action.
 */
export async function awardPoints(
  userId: string,
  action: LoyaltyAction,
): Promise<{ points: number; total: number; newBadges: string[] }> {
  const POINT_VALUES: Record<LoyaltyAction, number> = {
    booking_completed: 10,
    five_star_review: 20,
    review_left: 10,
    referral: 50,
    referral_provider: 200,
    referral_welcome_client: 25,
    referral_welcome_provider: 50,
    weekly_streak: 5,
  }

  const points = POINT_VALUES[action] ?? 0
  if (points === 0) return { points: 0, total: 0, newBadges: [] }

  // Get current points
  const current = (await cacheGet<number>(`loyalty:points:${userId}`)) ?? 0
  const newTotal = current + points

  // Store new points
  await cacheSet(`loyalty:points:${userId}`, newTotal, 365 * 24 * 60 * 60) // 1 year

  // Store transaction log
  const txKey = `loyalty:tx:${userId}`
  const txs = (await cacheGet<Array<{ action: string; points: number; at: number }>>(txKey)) ?? []
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
  const points = (await cacheGet<number>(`loyalty:points:${userId}`)) ?? 0
  const tier = getTier(points)
  const badges = await getUserBadges(userId)
  const streak = await getStreak(userId)

  // Get booking/review counts
  const [totalBookings, totalReviews] = await Promise.all([
    db.booking.count({
      where: { OR: [{ clientId: userId }, { providerId: userId }], status: "COMPLETED" },
    }),
    db.review.count({ where: { OR: [{ clientId: userId }, { providerId: userId }] } }),
  ])

  // Next tier
  const tiers: LoyaltyTier[] = ["bronze", "prata", "ouro", "diamante"]
  const currentIdx = tiers.indexOf(tier)
  const nextTier =
    currentIdx < tiers.length - 1
      ? {
          name: TIER_NAMES[tiers[currentIdx + 1]!],
          pointsNeeded: TIER_THRESHOLDS[tiers[currentIdx + 1]!] - points,
        }
      : null

  return {
    points,
    tier,
    tierName: TIER_NAMES[tier],
    badges,
    streak,
    totalBookings,
    totalReviews,
    nextTier,
  }
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
      await cacheSet(
        `loyalty:streak:${userId}`,
        {
          count: streakData.count + 1,
          lastWeek: currentWeek,
        },
        365 * 24 * 60 * 60,
      )

      // Award streak bonus at 4+ weeks
      if (streakData.count >= 3) {
        await awardPoints(userId, "weekly_streak")
      }
      return
    }
  }

  // Streak broken or first week
  await cacheSet(
    `loyalty:streak:${userId}`,
    {
      count: 1,
      lastWeek: currentWeek,
    },
    365 * 24 * 60 * 60,
  )
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
  {
    id: "diamante",
    name: "Diamante",
    emoji: "💎",
    description: "5000 pontos",
    check: (p) => p >= 5000,
  },
  {
    id: "pro",
    name: "Pro",
    emoji: "⭐",
    description: "10+ bookings completos",
    check: (_p, s) => s.bookings >= 10,
  },
  {
    id: "streak",
    name: "Streak",
    emoji: "🔥",
    description: "4+ semanas consecutivas",
    check: () => false,
  }, // checked separately
]

async function checkBadges(userId: string, points: number): Promise<string[]> {
  const newBadges: string[] = []
  const existingBadges = (await cacheGet<string[]>(`loyalty:badges:${userId}`)) ?? []

  const stats = {
    bookings: await db.booking.count({
      where: { OR: [{ clientId: userId }, { providerId: userId }], status: "COMPLETED" },
    }),
    reviews: await db.review.count({
      where: { OR: [{ clientId: userId }, { providerId: userId }] },
    }),
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
  const badgeIds = (await cacheGet<string[]>(`loyalty:badges:${userId}`)) ?? []

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

// ── Transaction Labels ────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  booking_completed: "Serviço concluído (+10 pts)",
  five_star_review: "Avaliação 5 estrelas (+20 pts)",
  review_left: "Avaliação registrada (+10 pts)",
  referral: "Indicação de cliente (+50 pts)",
  referral_provider: "Indicação de especialista parceiro (+200 pts)",
  referral_welcome_client: "Boas-vindas ao Clube (+25 pts)",
  referral_welcome_provider: "Credenciamento de parceiro (+50 pts)",
  weekly_streak: "Sequência semanal ativa (+5 pts)",
}

// ── Redemption Engine (Anti-Cash: 100% Pontos e Vantagens) ───────────────

/**
 * Redeem loyalty points for a catalog benefit.
 * Anti-cash mandate: strictly platform advantages, zero direct cash withdrawals.
 */
export async function redeemReward(
  userId: string,
  rewardId: string,
): Promise<{
  success: boolean
  error?: string
  perk?: RedeemedPerk
  remainingPoints?: number
}> {
  const item = LOYALTY_REWARDS_CATALOG.find((r) => r.id === rewardId)
  if (!item) {
    return { success: false, error: "Recompensa não encontrada no catálogo do Clube." }
  }

  const current = (await cacheGet<number>(`loyalty:points:${userId}`)) ?? 0
  if (current < item.pointsCost) {
    return {
      success: false,
      error: `Saldo insuficiente. Você possui ${current} pontos, mas este benefício requer ${item.pointsCost} pontos.`,
    }
  }

  const remainingPoints = current - item.pointsCost
  await cacheSet(`loyalty:points:${userId}`, remainingPoints, 365 * 24 * 60 * 60)

  // Append transaction log with negative points
  const txKey = `loyalty:tx:${userId}`
  const txs = (await cacheGet<Array<{ action: string; points: number; at: number }>>(txKey)) ?? []
  txs.push({ action: `redeem_${item.id}`, points: -item.pointsCost, at: Date.now() })
  if (txs.length > 100) txs.splice(0, txs.length - 100)
  await cacheSet(txKey, txs, 365 * 24 * 60 * 60)

  // Generate unique voucher code
  const codeSuffix = Math.random().toString(36).substring(2, 6).toUpperCase()
  const code = `SEV-${item.id.slice(0, 4).toUpperCase()}-${codeSuffix}`
  const now = new Date()
  const expiresAt = new Date(now.getTime() + item.expiresInDays * 24 * 60 * 60 * 1000).toISOString()

  const perk: RedeemedPerk = {
    id: `perk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    rewardId: item.id,
    title: item.title,
    code,
    pointsCost: item.pointsCost,
    category: item.category,
    redeemedAt: now.toISOString(),
    expiresAt,
    status: "active",
  }

  const perksKey = `loyalty:rewards:${userId}`
  const perks = (await cacheGet<RedeemedPerk[]>(perksKey)) ?? []
  perks.unshift(perk)
  if (perks.length > 50) perks.splice(50)
  await cacheSet(perksKey, perks, 365 * 24 * 60 * 60)

  logger.info({ userId, rewardId, code, remainingPoints }, "loyalty: reward redeemed successfully")

  return { success: true, perk, remainingPoints }
}

/**
 * Returns user's points transaction statement.
 */
export async function getLoyaltyTransactions(userId: string): Promise<LoyaltyTransactionRecord[]> {
  const txKey = `loyalty:tx:${userId}`
  const raw = (await cacheGet<Array<{ action: string; points: number; at: number }>>(txKey)) ?? []
  return raw
    .slice(-30)
    .reverse()
    .map((t) => {
      let label = ACTION_LABELS[t.action]
      if (!label && t.action.startsWith("redeem_")) {
        const rewardId = t.action.replace("redeem_", "")
        const cat = LOYALTY_REWARDS_CATALOG.find((c) => c.id === rewardId)
        label = cat ? `Resgate: ${cat.title}` : `Resgate de benefício (${t.points} pts)`
      }
      return {
        action: t.action,
        label: label ?? `Movimentação de pontos (${t.points > 0 ? "+" : ""}${t.points} pts)`,
        points: t.points,
        at: t.at,
      }
    })
}

/**
 * Returns active and past redeemed perks for a user.
 */
export async function getUserPerks(userId: string): Promise<RedeemedPerk[]> {
  const perksKey = `loyalty:rewards:${userId}`
  const raw = (await cacheGet<RedeemedPerk[]>(perksKey)) ?? []
  const now = Date.now()

  return raw.map((p) => {
    if (p.status === "active" && new Date(p.expiresAt).getTime() < now) {
      return { ...p, status: "expired" as const }
    }
    return p
  })
}
