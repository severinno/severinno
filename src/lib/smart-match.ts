import { db } from "@/lib/db"
import { findProvidersWithinRadius, type ProximityResult } from "@/lib/postgis"
import { haversineKm } from "@/lib/geo"

export type SmartMatchCandidate = {
  providerId: string
  name: string
  avatarUrl?: string | null
  verified: boolean
  avgRating: number
  reviewCount: number
  distanceKm: number
  basePrice: number
  serviceTitle: string
  serviceId: string
  matchScore: number
  matchReasons: string[]
  isAvailable: boolean
}

export type SmartMatchParams = {
  categoryId?: string
  lat: number
  lng: number
  scheduledAt?: Date
  limit?: number
}

/**
 * Smart matching algorithm: finds and ranks the top available providers
 * based on spatial proximity, rating, verification, and schedule.
 */
export async function findBestProviders({
  categoryId,
  lat,
  lng,
  scheduledAt,
  limit = 5,
}: SmartMatchParams): Promise<SmartMatchCandidate[]> {
  // 1. PostGIS spatial search for active providers within 30km
  const geoResults: ProximityResult[] = await findProvidersWithinRadius(lat, lng, 30)
  if (geoResults.length === 0) return []

  const providerIds = geoResults.map((r: ProximityResult) => r.id)

  // 2. Fetch provider services in the category and availability
  const providers = await db.user.findMany({
    where: {
      id: { in: providerIds },
      role: "PROVIDER",
      active: true,
    },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      verified: true,
      avgRating: true,
      reviewCount: true,
      lat: true,
      lng: true,
      services: {
        where: {
          active: true,
          ...(categoryId ? { categoryId } : {}),
        },
        select: {
          id: true,
          title: true,
          basePrice: true,
        },
        take: 1,
      },
      availability: scheduledAt
        ? {
            where: {
              dayOfWeek: scheduledAt.getDay(),
              active: true,
            },
          }
        : undefined,
      dateBlocks: scheduledAt
        ? {
            where: {
              date: scheduledAt,
            },
          }
        : undefined,
    },
  })

  const candidates: SmartMatchCandidate[] = []

  for (const p of providers) {
    if (p.services.length === 0) continue

    const svc = p.services[0]
    const distanceKm =
      p.lat && p.lng ? Math.round(haversineKm(lat, lng, p.lat, p.lng) * 10) / 10 : 10

    // Schedule availability check
    let isAvailable = true
    if (scheduledAt) {
      const hasWeeklySlot = (p.availability?.length ?? 0) > 0
      const isBlocked = (p.dateBlocks?.length ?? 0) > 0
      isAvailable = hasWeeklySlot && !isBlocked
    }

    // Matching score formula (0 - 100):
    // - Distance weight (35%): closer gets up to 35 pts (decay over 30km)
    const distanceScore = Math.max(0, 35 * (1 - distanceKm / 30))

    // - Rating & review volume weight (30%):
    const ratingBase = ((p.avgRating || 4.0) / 5.0) * 25
    const reviewBonus = Math.min(5, (p.reviewCount || 0) * 0.5)
    const ratingScore = ratingBase + reviewBonus

    // - Verified KYC bonus (20%):
    const verifiedScore = p.verified ? 20 : 0

    // - Availability bonus (15%):
    const availabilityScore = isAvailable ? 15 : 0

    const matchScore = Math.min(
      100,
      Math.round((distanceScore + ratingScore + verifiedScore + availabilityScore) * 10) / 10,
    )

    const matchReasons: string[] = []
    if (distanceKm <= 5) matchReasons.push("Muito próximo (< 5 km)")
    else if (distanceKm <= 12) matchReasons.push("Raio de atendimento ideal")

    if (p.verified) matchReasons.push("Identidade Verificada (KYC)")
    if ((p.avgRating || 0) >= 4.8)
      matchReasons.push(`Avaliação Excelente (⭐ ${(p.avgRating || 0).toFixed(1)})`)
    if (isAvailable) matchReasons.push("Disponível para agendamento rápido")

    candidates.push({
      providerId: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl,
      verified: p.verified,
      avgRating: p.avgRating,
      reviewCount: p.reviewCount,
      distanceKm,
      basePrice: svc.basePrice,
      serviceTitle: svc.title,
      serviceId: svc.id,
      matchScore,
      matchReasons,
      isAvailable,
    })
  }

  // Sort descending by match score
  candidates.sort((a, b) => b.matchScore - a.matchScore)

  return candidates.slice(0, limit)
}
