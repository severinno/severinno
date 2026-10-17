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
  inviteLink: string
  shareText: string
  whatsappShareUrl: string
  totalInvites: number
  activeFriends: number
  pointsEarned: number
  tierBonusTitle: string
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
 * Links a newly registered/invited user to their referrer
 */
export async function registerReferralInvite(
  invitedUserId: string,
  referralCode: string,
): Promise<boolean> {
  const referrerId = await getReferrerByCode(referralCode)
  if (!referrerId || referrerId === invitedUserId) return false

  // Check if invited user is already bound to a referrer (first referral wins)
  const existingReferrer = await cacheGet<string>(`referral:invited_by:${invitedUserId}`)
  if (existingReferrer) return true

  // Anti-fraud check: users who already have completed services cannot claim a referral invite
  const existingBookingsCount = await db.booking.count({
    where: { clientId: invitedUserId, status: "COMPLETED" },
  })
  if (existingBookingsCount > 0) {
    log.warn(
      { invitedUserId, referralCode, existingBookingsCount },
      "referral: anti-fraud check failed: user with previous completed bookings cannot be referred",
    )
    return false
  }

  // Store referrer for this user
  await cacheSet(`referral:invited_by:${invitedUserId}`, referrerId, 365 * 24 * 60 * 60)

  // Add to referrer's invite list
  const listKey = `referral:list:${referrerId}`
  const list = (await cacheGet<string[]>(listKey)) ?? []
  if (!list.includes(invitedUserId)) {
    list.push(invitedUserId)
    await cacheSet(listKey, list, 365 * 24 * 60 * 60)
  }

  log.info({ referrerId, invitedUserId, referralCode }, "referral: invite registered")
  return true
}

/**
 * Rewards the referrer when an invited user completes their first paid service
 */
export async function processReferralFirstBookingConversion(
  bookingId: string,
  clientId: string,
): Promise<{ rewarded: boolean; pointsAwarded: number; referrerId?: string }> {
  const referrerId = await cacheGet<string>(`referral:invited_by:${clientId}`)
  if (!referrerId) return { rewarded: false, pointsAwarded: 0 }

  const convertedKey = `referral:converted:${clientId}`
  const alreadyConverted = await cacheGet<boolean>(convertedKey)
  if (alreadyConverted) return { rewarded: false, pointsAwarded: 0 }

  // Mark converted
  await cacheSet(convertedKey, true, 365 * 24 * 60 * 60)

  // Increment referrer converted count
  const countKey = `referral:converted_count:${referrerId}`
  const currentCount = (await cacheGet<number>(countKey)) ?? 0
  await cacheSet(countKey, currentCount + 1, 365 * 24 * 60 * 60)

  // Track in referral leaderboard list
  const lbKey = "referral:leaderboard:users"
  const lbUsers = (await cacheGet<string[]>(lbKey)) ?? []
  if (!lbUsers.includes(referrerId)) {
    lbUsers.push(referrerId)
    await cacheSet(lbKey, lbUsers, 365 * 24 * 60 * 60)
  }

  // Award +50 loyalty points to referrer
  await awardPoints(referrerId, "referral")

  log.info(
    { referrerId, clientId, bookingId, points: 50 },
    "referral: conversion rewarded with loyalty points",
  )

  return { rewarded: true, pointsAwarded: 50, referrerId }
}

/**
 * Returns comprehensive referral metrics for the current user
 */
export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const code = await getOrCreateReferralCode(userId)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://severinno.com.br"
  const inviteLink = `${appUrl}/convite/${code}`

  const listKey = `referral:list:${userId}`
  const invitesList = (await cacheGet<string[]>(listKey)) ?? []
  const countKey = `referral:converted_count:${userId}`
  const activeFriends = (await cacheGet<number>(countKey)) ?? 0
  const pointsEarned = activeFriends * 50

  const shareText = `Olá! Conheça o Severinno, a plataforma mais segura do Brasil para contratar serviços com pagamento em custódia (Escrow) e profissionais verificados. Acesse pelo meu convite: ${inviteLink}`

  const whatsappShareUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`

  return {
    code,
    inviteLink,
    shareText,
    whatsappShareUrl,
    totalInvites: invitesList.length,
    activeFriends,
    pointsEarned,
    tierBonusTitle: activeFriends >= 5 ? "Top Embaixador Severinno" : "Indicador Ativo",
  }
}

/**
 * Returns the top community referrers for the leaderboard
 */
export async function getReferralLeaderboard(limit = 10): Promise<ReferralLeaderboardEntry[]> {
  const lbKey = "referral:leaderboard:users"
  const lbUsers = (await cacheGet<string[]>(lbKey)) ?? []

  if (lbUsers.length === 0) return []

  const entries: Array<{ userId: string; count: number }> = []
  for (const uid of lbUsers) {
    const count = (await cacheGet<number>(`referral:converted_count:${uid}`)) ?? 0
    if (count > 0) {
      entries.push({ userId: uid, count })
    }
  }

  entries.sort((a, b) => b.count - a.count)
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
    if (entry.count >= 10) badge = "Embaixador Diamante"
    else if (entry.count >= 5) badge = "Embaixador Ouro"
    else if (entry.count >= 3) badge = "Embaixador Severinno"

    // LGPD PII Guard: Anonymize raw database userId for public consumption
    const anonymizedUserId = `ref_${crypto.createHash("sha256").update(entry.userId).digest("hex").slice(0, 10)}`

    return {
      rank: index + 1,
      userId: anonymizedUserId,
      name: safeName,
      avatarUrl: user?.avatarUrl || null,
      convertedCount: entry.count,
      pointsEarned: entry.count * 50,
      badge,
    }
  })
}

/**
 * Checks if a user holds the "Embaixador Severinno" tier badge
 */
export async function isAmbassador(userId: string): Promise<boolean> {
  const countKey = `referral:converted_count:${userId}`
  const activeFriends = (await cacheGet<number>(countKey)) ?? 0
  return activeFriends >= 3
}
