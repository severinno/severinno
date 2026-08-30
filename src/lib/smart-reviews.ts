/**
 * Smart Review System — enhanced reviews with tags, photos, and responses.
 *
 * Beyond the basic 1-5 stars + text, adds:
 *   - Quick tags: "pontual", "educado", "bom trabalho", etc.
 *   - Before/after photos
 *   - Provider response to reviews
 *   - "Similar reviews" recommendations
 *   - Sentiment analysis (lightweight, keyword-based)
 */
import { db } from "./db"
import { cacheGet, cacheSet } from "./redis"
import logger from "./logger"

// ── Types ─────────────────────────────────────────────────────────────────

export type ReviewTag =
  | "pontual"
  | "educado"
  | "bom_trabalho"
  | "preco_justo"
  | "recomendo"
  | "rapido"
  | "detalhista"
  | "profissional"

export const ALL_REVIEW_TAGS: { id: ReviewTag; label: string; emoji: string }[] = [
  { id: "pontual", label: "Pontual", emoji: "⏰" },
  { id: "educado", label: "Educado", emoji: "😊" },
  { id: "bom_trabalho", label: "Bom trabalho", emoji: "👍" },
  { id: "preco_justo", label: "Preço justo", emoji: "💰" },
  { id: "recomendo", label: "Recomendo", emoji: "⭐" },
  { id: "rapido", label: "Rápido", emoji: "⚡" },
  { id: "detalhista", label: "Detalhista", emoji: "🔍" },
  { id: "profissional", label: "Profissional", emoji: "💼" },
]

export type SmartReview = {
  id: string
  rating: number
  comment: string | null
  tags: ReviewTag[]
  providerResponse: string | null
  providerRespondedAt: string | null
  photos: string[]
  sentiment: "positive" | "neutral" | "negative"
  createdAt: string
}

// ── Sentiment Analysis ────────────────────────────────────────────────────

const POSITIVE_KEYWORDS = [
  "excelente", "ótimo", "ótima", "bom", "boa", "maravilhoso", "perfeito",
  "recomendo", "adorei", "amei", "sensacional", "incrível", "nota 10",
  "muito bom", "super", "melhor", "fantástico", "impecável", "show",
]

const NEGATIVE_KEYWORDS = [
  "ruim", "péssimo", "péssima", "horrível", "terrível", "não recomendo",
  "decepcionado", "decepcionada", "demorou", "atrasado", "atrasada",
  "mal feito", "porcaria", "lixo", "desonesto", "caro demais",
]

export function analyzeSentiment(text: string): "positive" | "neutral" | "negative" {
  const lower = text.toLowerCase()
  let positive = 0
  let negative = 0

  for (const kw of POSITIVE_KEYWORDS) {
    if (lower.includes(kw)) positive++
  }
  for (const kw of NEGATIVE_KEYWORDS) {
    if (lower.includes(kw)) negative++
  }

  if (positive > negative) return "positive"
  if (negative > positive) return "negative"
  return "neutral"
}

// ── Create Enhanced Review ────────────────────────────────────────────────

export async function createSmartReview(data: {
  bookingId: string
  clientId: string
  providerId: string
  rating: number
  comment?: string
  tags?: ReviewTag[]
  photos?: string[]
}): Promise<SmartReview> {
  const sentiment = data.comment ? analyzeSentiment(data.comment) : "neutral"

  const review = await db.review.create({
    data: {
      bookingId: data.bookingId,
      clientId: data.clientId,
      providerId: data.providerId,
      rating: data.rating,
      comment: data.comment ?? null,
    },
  })

  // Store enhanced data in Redis (tags, photos, sentiment)
  const enhancedKey = `review:enhanced:${review.id}`
  await cacheSet(enhancedKey, {
    tags: data.tags ?? [],
    photos: data.photos ?? [],
    sentiment,
  }, 90 * 24 * 60 * 60) // 90 days

  // Update provider stats
  await updateProviderReviewStats(data.providerId)

  return {
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    tags: data.tags ?? [],
    providerResponse: null,
    providerRespondedAt: null,
    photos: data.photos ?? [],
    sentiment,
    createdAt: review.createdAt.toISOString(),
  }
}

// ── Provider Response ─────────────────────────────────────────────────────

export async function respondToReview(
  reviewId: string,
  providerId: string,
  response: string,
): Promise<{ success: boolean; error?: string }> {
  // Verify ownership
  const review = await db.review.findUnique({
    where: { id: reviewId },
    select: { providerId: true },
  })

  if (!review || review.providerId !== providerId) {
    return { success: false, error: "Avaliação não encontrada ou não pertence a este prestador" }
  }

  // Store response in Redis
  const responseKey = `review:response:${reviewId}`
  await cacheSet(responseKey, {
    response,
    respondedAt: new Date().toISOString(),
  }, 90 * 24 * 60 * 60)

  logger.info({ reviewId, providerId }, "smart-review: provider responded")
  return { success: true }
}

// ── Get Enhanced Reviews ──────────────────────────────────────────────────

export async function getSmartReviews(
  providerId: string,
  limit: number = 10,
): Promise<SmartReview[]> {
  const reviews = await db.review.findMany({
    where: { providerId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      rating: true,
      comment: true,
      createdAt: true,
    },
  })

  const smartReviews: SmartReview[] = []

  for (const review of reviews) {
    const enhanced = await cacheGet<{
      tags: ReviewTag[]
      photos: string[]
      sentiment: "positive" | "neutral" | "negative"
    }>(`review:enhanced:${review.id}`)

    const response = await cacheGet<{
      response: string
      respondedAt: string
    }>(`review:response:${review.id}`)

    smartReviews.push({
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      tags: enhanced?.tags ?? [],
      providerResponse: response?.response ?? null,
      providerRespondedAt: response?.respondedAt ?? null,
      photos: enhanced?.photos ?? [],
      sentiment: enhanced?.sentiment ?? (review.comment ? analyzeSentiment(review.comment) : "neutral"),
      createdAt: review.createdAt.toISOString(),
    })
  }

  return smartReviews
}

// ── Similar Reviews ───────────────────────────────────────────────────────

export async function getSimilarReviews(
  reviewId: string,
  limit: number = 3,
): Promise<SmartReview[]> {
  const review = await db.review.findUnique({
    where: { id: reviewId },
    select: { providerId: true, rating: true },
  })
  if (!review) return []

  // Find reviews with similar rating for the same provider
  const similar = await db.review.findMany({
    where: {
      providerId: review.providerId,
      id: { not: reviewId },
      rating: { gte: Math.max(1, review.rating - 1), lte: Math.min(5, review.rating + 1) },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      rating: true,
      comment: true,
      createdAt: true,
    },
  })

  const result: SmartReview[] = []
  for (const r of similar) {
    const enhanced = await cacheGet<{
      tags: ReviewTag[]
      photos: string[]
      sentiment: "positive" | "neutral" | "negative"
    }>(`review:enhanced:${r.id}`)

    result.push({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      tags: enhanced?.tags ?? [],
      providerResponse: null,
      providerRespondedAt: null,
      photos: enhanced?.photos ?? [],
      sentiment: enhanced?.sentiment ?? "neutral",
      createdAt: r.createdAt.toISOString(),
    })
  }

  return result
}

// ── Provider Stats Update ─────────────────────────────────────────────────

async function updateProviderReviewStats(providerId: string): Promise<void> {
  try {
    const stats = await db.review.aggregate({
      where: { providerId },
      _avg: { rating: true },
      _count: { rating: true },
    })

    await db.user.update({
      where: { id: providerId },
      data: {
        avgRating: stats._avg.rating ?? 0,
        favoriteCount: stats._count.rating,
      },
    })
  } catch {
    // Best-effort
  }
}
