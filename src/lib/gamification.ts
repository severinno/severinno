/**
 * gamification.ts — Provider Pro Gamification & Tier Scoring Engine.
 *
 * Computes tiers (Bronze, Silver, Gold, Diamond), XP score, badges, and platform benefits.
 */

export type ProviderTier = "BRONZE" | "SILVER" | "GOLD" | "DIAMOND"

export type ProviderBadge = {
  id: string
  name: string
  description: string
  icon: string
  unlocked: boolean
}

export type GamificationProfile = {
  tier: ProviderTier
  tierLabel: string
  score: number // 0 to 1000
  nextTier: ProviderTier | null
  nextTierScore: number | null
  progressToNextTierPercent: number
  benefits: string[]
  badges: ProviderBadge[]
  metrics: {
    avgRating: number
    reviewCount: number
    completedBookings: number
    verifiedIdentity: boolean
  }
}

const TIER_THRESHOLDS: Record<ProviderTier, { min: number; next: ProviderTier | null; nextMin: number | null; label: string }> = {
  BRONZE: { min: 0, next: "SILVER", nextMin: 250, label: "Bronze" },
  SILVER: { min: 250, next: "GOLD", nextMin: 500, label: "Prata" },
  GOLD: { min: 500, next: "DIAMOND", nextMin: 800, label: "Ouro" },
  DIAMOND: { min: 800, next: null, nextMin: null, label: "Diamante" },
}

const TIER_BENEFITS: Record<ProviderTier, string[]> = {
  BRONZE: [
    "Acesso à vitrine de serviços",
    "Recebimento seguro via PIX com Escrow",
    "Notificações no WhatsApp",
  ],
  SILVER: [
    "Taxa de serviço reduzida em 1%",
    "Selo Prata no perfil público",
    "Destaque na busca regional",
  ],
  GOLD: [
    "Taxa de serviço reduzida em 2%",
    "Selo Ouro com destaque visual",
    "Prioridade máxima no Smart Match",
    "Suporte prioritário via WhatsApp",
  ],
  DIAMOND: [
    "Menor taxa da plataforma (redução de 3.5%)",
    "Selo Diamante de Elite",
    "Badge 'Prestador Recomendado Severinno'",
    "Acesso antecipado a novas ferramentas",
    "Gerente de conta exclusivo",
  ],
}

/**
 * Calculate provider gamification score (0 to 1000) and current tier
 */
export function calculateProviderTier(metrics: {
  avgRating: number
  reviewCount: number
  completedBookings: number
  verifiedIdentity: boolean
}): GamificationProfile {
  let score = 0

  // 1. Rating Score (up to 400 pts)
  if (metrics.reviewCount > 0) {
    const ratingRatio = Math.max(0, (metrics.avgRating - 3.0) / 2.0) // 3.0 to 5.0 scale
    score += Math.round(ratingRatio * 400)
  }

  // 2. Completed Bookings Score (up to 350 pts — 14 pts per completed booking up to 25)
  score += Math.min(350, metrics.completedBookings * 14)

  // 3. Identity Verification KYC (150 pts bonus)
  if (metrics.verifiedIdentity) {
    score += 150
  }

  // 4. Activity & Volume Bonus (up to 100 pts)
  if (metrics.reviewCount >= 10) score += 50
  if (metrics.completedBookings >= 10) score += 50

  score = Math.min(1000, Math.max(0, score))

  // Determine Tier
  let tier: ProviderTier = "BRONZE"
  if (score >= 800) tier = "DIAMOND"
  else if (score >= 500) tier = "GOLD"
  else if (score >= 250) tier = "SILVER"

  const config = TIER_THRESHOLDS[tier]

  let progressPercent = 100
  if (config.nextMin !== null) {
    const currentTierRange = config.nextMin - config.min
    const pointsInTier = score - config.min
    progressPercent = Math.min(100, Math.max(0, Math.round((pointsInTier / currentTierRange) * 100)))
  }

  // Badges Calculation
  const badges: ProviderBadge[] = [
    {
      id: "verified_pro",
      name: "Identidade Verificada",
      description: "Documentos e selfie validados pela equipe",
      icon: "ShieldCheck",
      unlocked: metrics.verifiedIdentity,
    },
    {
      id: "top_rated",
      name: "Nota Máxima",
      description: "Avaliação média igual ou superior a 4.8",
      icon: "Star",
      unlocked: metrics.avgRating >= 4.8 && metrics.reviewCount >= 3,
    },
    {
      id: "veteran",
      name: "Profissional Experiente",
      description: "Mais de 15 atendimentos concluídos com sucesso",
      icon: "Award",
      unlocked: metrics.completedBookings >= 15,
    },
    {
      id: "master",
      name: "Mestre Severinno",
      description: "Mais de 50 atendimentos realizados na plataforma",
      icon: "Crown",
      unlocked: metrics.completedBookings >= 50,
    },
  ]

  return {
    tier,
    tierLabel: config.label,
    score,
    nextTier: config.next,
    nextTierScore: config.nextMin,
    progressToNextTierPercent: progressPercent,
    benefits: TIER_BENEFITS[tier],
    badges,
    metrics,
  }
}
