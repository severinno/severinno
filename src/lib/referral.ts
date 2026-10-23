/**
 * referral.ts — Viral Referral & "Indique e Ganhe" Engine for Severinno
 *
 * Drives organic user acquisition and provider network expansion.
 * Tracks invitations, conversion on first completed booking, and rewards
 * both referrers with loyalty points (+50 pts) and platform perks.
 */

import { db } from "@/lib/db"
import { cacheGet, cacheSet } from "@/lib/redis"
import { awardPoints } from "@/lib/loyalty"
import logger from "@/lib/logger"
import crypto from "crypto"

const log = logger.child({ module: "referral" })

export interface ReferralLeaderboardEntry {
  rank: number
  userId: string
  name: string
  avatarUrl: string | null
  convertedCount: number
  pointsEarned: number
  badge: "Embaixador Diamante" | "Embaixador Ouro" | "Embaixador Severinno" | "Indicador Ativo"
}

export interface ReferralStats {
  code: string
  // Legacy / Unified
  inviteLink: string
  shareText: string
  whatsappShareUrl: string
  totalInvites: number
  activeFriends: number
  pointsEarned: number
  tierBonusTitle: string

  // Dual Funnel Segregated Metrics
  clientInvitesCount?: number
  providerInvitesCount?: number
  clientConversionsCount?: number
  providerConversionsCount?: number
  clientPointsEarned?: number
  providerPointsEarned?: number
  totalPointsEarned?: number

  // Segregated Links & Shares
  clientInviteLink?: string
  providerInviteLink?: string
  clientShareText?: string
  providerShareText?: string
  whatsappShareUrlClient?: string
  whatsappShareUrlProvider?: string
}

/**
 * Gets or creates a deterministic, user-friendly 8-char referral code
 */
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const existingCode = await cacheGet<string>(`referral:code:${userId}`)
  if (existingCode) return existingCode

  // Generate deterministic 9-char uppercase code: e.g. SEV + 6 hex chars (24-bit entropy = ~16.7M combinations)
  const baseHash = crypto.createHash("sha256").update(userId).digest("hex").toUpperCase()
  let code = `SEV${baseHash.slice(0, 6)}`

  // Collision guard: verify if the code already belongs to another user
  const existingOwner = await cacheGet<string>(`referral:user:${code}`)
  if (existingOwner && existingOwner !== userId) {
    // Collision occurred: take alternative slice
    code = `SEV${baseHash.slice(6, 12)}`
  }

  await cacheSet(`referral:code:${userId}`, code, 365 * 24 * 60 * 60)
  await cacheSet(`referral:user:${code}`, userId, 365 * 24 * 60 * 60)
  return code
}

/**
 * Resolves a referrer's userId by their referral code
 */
export async function getReferrerByCode(code: string): Promise<string | null> {
  if (!code) return null
  return await cacheGet<string>(`referral:user:${code.toUpperCase().trim()}`)
}

/**
 * Links a newly registered/invited user to their referrer with intent tracking (client vs provider)
 */
export async function registerReferralInvite(
  invitedUserId: string,
  referralCode: string,
  intentType: "client" | "provider" = "client",
): Promise<boolean> {
  const referrerId = await getReferrerByCode(referralCode)
  if (!referrerId || referrerId === invitedUserId) return false

  // Store user intent
  await cacheSet(`referral:type:${invitedUserId}`, intentType, 365 * 24 * 60 * 60)

  // Check if invited user is already bound to a referrer (first referral wins)
  const existingReferrer = await cacheGet<string>(`referral:invited_by:${invitedUserId}`)
  if (existingReferrer) return true

  // Anti-fraud check: users who already have completed services cannot claim a referral invite
  const existingBookingsCount = await db.booking.count({
    where: {
      clientId: invitedUserId,
      status: "COMPLETED",
    },
  })
  if (existingBookingsCount > 0) {
    log.warn(
      { invitedUserId, referralCode, existingBookingsCount },
      "referral: anti-fraud check failed: user with previous completed bookings cannot be referred",
    )
    return false
  }

  if (intentType === "provider") {
    const existingProviderBookings = await db.booking.count({
      where: {
        providerId: invitedUserId,
        status: "COMPLETED",
      },
    })
    if (existingProviderBookings > 0) {
      log.warn(
        { invitedUserId, referralCode, existingProviderBookings },
        "referral: anti-fraud check failed: provider with previous completed services cannot be referred",
      )
      return false
    }
  }

  // Store referrer for this user
  await cacheSet(`referral:invited_by:${invitedUserId}`, referrerId, 365 * 24 * 60 * 60)

  // Add to referrer's unified invite list
  const listKey = `referral:list:${referrerId}`
  const list = (await cacheGet<string[]>(listKey)) ?? []
  if (!list.includes(invitedUserId)) {
    list.push(invitedUserId)
    await cacheSet(listKey, list, 365 * 24 * 60 * 60)
  }

  // Segregated list by role/intent
  const intentListKey =
    intentType === "provider"
      ? `referral:list:providers:${referrerId}`
      : `referral:list:clients:${referrerId}`
  const intentList = (await cacheGet<string[]>(intentListKey)) ?? []
  if (!intentList.includes(invitedUserId)) {
    intentList.push(invitedUserId)
    await cacheSet(intentListKey, intentList, 365 * 24 * 60 * 60)
  }

  log.info({ referrerId, invitedUserId, referralCode, intentType }, "referral: invite registered")
  return true
}

/**
 * Rewards participants when an invited user completes their first paid service.
 * Supports dual conversion:
 * - If client was referred: awards +50 pts to referrer, +25 pts welcome points to client.
 * - If provider was referred (specialist provider): awards +200 pts (4x weight) to referrer, +50 pts welcome points to provider.
 * All rewards are Loyalty Points for future platform redemption (NO CASH / NÃO DINHEIRO).
 */
export async function processReferralFirstBookingConversion(
  bookingId: string,
  clientId: string,
  providerId?: string,
): Promise<{
  rewarded: boolean
  pointsAwarded: number
  referrerId?: string
  convertedRole?: "client" | "provider"
  welcomePointsAwarded?: number
  welcomeUserId?: string
}> {
  let rewarded = false
  let totalPoints = 0
  let mainReferrerId: string | undefined = undefined
  let convertedRole: "client" | "provider" | undefined = undefined
  let welcomePoints = 0
  let welcomeUserId: string | undefined = undefined

  // 1. Client Conversion Check
  const clientReferrerId = await cacheGet<string>(`referral:invited_by:${clientId}`)
  const clientConvertedKey = `referral:converted:${clientId}`
  const clientAlreadyConverted = await cacheGet<boolean>(clientConvertedKey)

  if (clientReferrerId && !clientAlreadyConverted) {
    await cacheSet(clientConvertedKey, true, 365 * 24 * 60 * 60)
    mainReferrerId = clientReferrerId
    convertedRole = "client"

    // Increment client conversion counters
    const clientCountKey = `referral:converted_clients_count:${clientReferrerId}`
    const curClientCount = (await cacheGet<number>(clientCountKey)) ?? 0
    await cacheSet(clientCountKey, curClientCount + 1, 365 * 24 * 60 * 60)

    const countKey = `referral:converted_count:${clientReferrerId}`
    const currentCount = (await cacheGet<number>(countKey)) ?? 0
    await cacheSet(countKey, currentCount + 1, 365 * 24 * 60 * 60)

    // Track in referral leaderboard list
    const lbKey = "referral:leaderboard:users"
    const lbUsers = (await cacheGet<string[]>(lbKey)) ?? []
    if (!lbUsers.includes(clientReferrerId)) {
      lbUsers.push(clientReferrerId)
      await cacheSet(lbKey, lbUsers, 365 * 24 * 60 * 60)
    }

    // Award +50 loyalty points to client's referrer
    await awardPoints(clientReferrerId, "referral")

    // Award +25 welcome points to the new client (No cash — platform loyalty points)
    await awardPoints(clientId, "referral_welcome_client")

    rewarded = true
    totalPoints += 50
    welcomePoints = 25
    welcomeUserId = clientId

    log.info(
      { referrerId: clientReferrerId, clientId, bookingId, points: 50, welcomePoints: 25 },
      "referral: client first booking conversion rewarded with loyalty points",
    )
  }

  // 2. Specialist Provider Conversion Check (Peso 4x: +200 pts)
  if (providerId) {
    const providerReferrerId = await cacheGet<string>(`referral:invited_by:${providerId}`)
    const providerConvertedKey = `referral:converted:${providerId}`
    const providerAlreadyConverted = await cacheGet<boolean>(providerConvertedKey)

    if (providerReferrerId && !providerAlreadyConverted) {
      await cacheSet(providerConvertedKey, true, 365 * 24 * 60 * 60)
      mainReferrerId = providerReferrerId
      convertedRole = "provider"

      // Increment provider conversion counters (4x weight)
      const provCountKey = `referral:converted_providers_count:${providerReferrerId}`
      const curProvCount = (await cacheGet<number>(provCountKey)) ?? 0
      await cacheSet(provCountKey, curProvCount + 1, 365 * 24 * 60 * 60)

      const countKey = `referral:converted_count:${providerReferrerId}`
      const currentCount = (await cacheGet<number>(countKey)) ?? 0
      await cacheSet(countKey, currentCount + 1, 365 * 24 * 60 * 60)

      // Track in referral leaderboard list
      const lbKey = "referral:leaderboard:users"
      const lbUsers = (await cacheGet<string[]>(lbKey)) ?? []
      if (!lbUsers.includes(providerReferrerId)) {
        lbUsers.push(providerReferrerId)
        await cacheSet(lbKey, lbUsers, 365 * 24 * 60 * 60)
      }

      // Award +200 loyalty points to provider's referrer (4x weight)
      await awardPoints(providerReferrerId, "referral_provider")

      // Award +50 welcome points to the newly active provider
      await awardPoints(providerId, "referral_welcome_provider")

      rewarded = true
      totalPoints += 200
      welcomePoints = 50
      welcomeUserId = providerId

      log.info(
        { referrerId: providerReferrerId, providerId, bookingId, points: 200, welcomePoints: 50 },
        "referral: specialist provider first service conversion rewarded with 4x loyalty points",
      )
    }
  }

  return {
    rewarded,
    pointsAwarded: totalPoints,
    referrerId: mainReferrerId,
    convertedRole,
    welcomePointsAwarded: welcomePoints,
    welcomeUserId,
  }
}

/**
 * Returns comprehensive referral metrics for the current user across both funnels
 */
export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const code = await getOrCreateReferralCode(userId)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://severinno.com.br"
  const inviteLink = `${appUrl}/convite/${code}`
  const clientInviteLink = `${appUrl}/convite/${code}?tipo=cliente`
  const providerInviteLink = `${appUrl}/convite/${code}?tipo=prestador`

  const listKey = `referral:list:${userId}`
  const totalInvitesList = (await cacheGet<string[]>(listKey)) ?? []

  const clientInvites = (await cacheGet<string[]>(`referral:list:clients:${userId}`)) ?? []
  const providerInvites = (await cacheGet<string[]>(`referral:list:providers:${userId}`)) ?? []

  const clientInvitesCount =
    clientInvites.length > 0
      ? clientInvites.length
      : Math.max(0, totalInvitesList.length - providerInvites.length)
  const providerInvitesCount = providerInvites.length

  const totalConverted = (await cacheGet<number>(`referral:converted_count:${userId}`)) ?? 0
  const provConverted =
    (await cacheGet<number>(`referral:converted_providers_count:${userId}`)) ?? 0
  const cliConverted =
    (await cacheGet<number>(`referral:converted_clients_count:${userId}`)) ??
    Math.max(0, totalConverted - provConverted)

  const clientPointsEarned = cliConverted * 50
  const providerPointsEarned = provConverted * 200
  const totalPointsEarned = clientPointsEarned + providerPointsEarned

  // High-converting copy emphasizing POINTS for future platform conversion (NÃO DINHEIRO)
  const clientShareText = `Olá! Conheça o Severinno em Governador Valadares. Plataforma 100% segura com garantia CDC, pagamento protegido em custódia (Escrow) e profissionais verificados. Acesse pelo meu convite para ganhar pontos de boas-vindas no Clube de Benefícios para trocar por descontos futuros: ${clientInviteLink}`

  const providerShareText = `Olá amigo profissional! Venha ser um Prestador Parceiro Severinno em Governador Valadares. Zero mensalidade, pagamento garantido via custódia e demanda de clientes em GV. Cadastre-se pelo meu convite oficial de prestador e acumule pontos no Clube de Benefícios para trocar por visibilidade radar VIP e vantagens operacionais: ${providerInviteLink}`

  const shareText = clientShareText

  const whatsappShareUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`
  const whatsappShareUrlClient = `https://api.whatsapp.com/send?text=${encodeURIComponent(clientShareText)}`
  const whatsappShareUrlProvider = `https://api.whatsapp.com/send?text=${encodeURIComponent(providerShareText)}`

  let tierBonusTitle = "Indicador Ativo"
  if (provConverted >= 3 || totalPointsEarned >= 1000) {
    tierBonusTitle = "Top Embaixador Diamante GV"
  } else if (provConverted >= 1 || totalPointsEarned >= 500) {
    tierBonusTitle = "Embaixador Ouro Severinno"
  } else if (totalConverted >= 3 || totalPointsEarned >= 150) {
    tierBonusTitle = "Embaixador Severinno"
  }

  return {
    code,
    inviteLink,
    shareText,
    whatsappShareUrl,
    totalInvites: totalInvitesList.length,
    activeFriends: totalConverted,
    pointsEarned: totalPointsEarned,
    tierBonusTitle,

    // Dual funnel metrics
    clientInvitesCount,
    providerInvitesCount,
    clientConversionsCount: cliConverted,
    providerConversionsCount: provConverted,
    clientPointsEarned,
    providerPointsEarned,
    totalPointsEarned,

    // Dual funnel links and texts
    clientInviteLink,
    providerInviteLink,
    clientShareText,
    providerShareText,
    whatsappShareUrlClient,
    whatsappShareUrlProvider,
  }
}

/**
 * Returns the top community referrers for the leaderboard, weighted by total points earned
 */
export async function getReferralLeaderboard(limit = 10): Promise<ReferralLeaderboardEntry[]> {
  const lbKey = "referral:leaderboard:users"
  const lbUsers = (await cacheGet<string[]>(lbKey)) ?? []

  if (lbUsers.length === 0) return []

  const entries: Array<{
    userId: string
    count: number
    points: number
  }> = []

  for (const uid of lbUsers) {
    const totalCount = (await cacheGet<number>(`referral:converted_count:${uid}`)) ?? 0
    if (totalCount > 0) {
      const provCount = (await cacheGet<number>(`referral:converted_providers_count:${uid}`)) ?? 0
      const cliCount =
        (await cacheGet<number>(`referral:converted_clients_count:${uid}`)) ??
        Math.max(0, totalCount - provCount)
      const points = provCount * 200 + cliCount * 50

      entries.push({ userId: uid, count: totalCount, points })
    }
  }

  entries.sort((a, b) => b.points - a.points || b.count - a.count)
  const topSlice = entries.slice(0, limit)

  if (topSlice.length === 0) return []

  const users = await db.user.findMany({
    where: { id: { in: topSlice.map((e) => e.userId) } },
    select: { id: true, name: true, avatarUrl: true },
  })
  const userMap = new Map(users.map((u) => [u.id, u]))

  return topSlice.map((entry, index) => {
    const user = userMap.get(entry.userId)
    const rawName = user?.name || "Usuário"
    // PII Guard safe masking: "Carlos Silva" -> "Carlos S."
    const parts = rawName.trim().split(/\s+/)
    const safeName = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0]

    let badge: ReferralLeaderboardEntry["badge"] = "Indicador Ativo"
    if (entry.points >= 1000) badge = "Embaixador Diamante"
    else if (entry.points >= 500) badge = "Embaixador Ouro"
    else if (entry.points >= 150 || entry.count >= 3) badge = "Embaixador Severinno"

    // LGPD PII Guard: Anonymize raw database userId for public consumption
    const anonymizedUserId = `ref_${crypto.createHash("sha256").update(entry.userId).digest("hex").slice(0, 10)}`

    return {
      rank: index + 1,
      userId: anonymizedUserId,
      name: safeName,
      avatarUrl: user?.avatarUrl || null,
      convertedCount: entry.count,
      pointsEarned: entry.points,
      badge,
    }
  })
}

/**
 * Checks if a user holds the "Embaixador Severinno" tier badge
 */
export async function isAmbassador(userId: string): Promise<boolean> {
  const provCount = (await cacheGet<number>(`referral:converted_providers_count:${userId}`)) ?? 0
  const countKey = `referral:converted_count:${userId}`
  const activeFriends = (await cacheGet<number>(countKey)) ?? 0
  return activeFriends >= 3 || provCount >= 1
}
