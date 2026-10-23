export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { calculateSmartQuoteEstimation } from "@/lib/quote-estimation-assistant"
import { findBestProviders } from "@/lib/smart-match"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { z } from "zod"

import { withRoute } from "@/lib/api-route"

const aiEstimateSchema = z.object({
  description: z.string().min(5, "Descreva o serviço com pelo menos 5 caracteres"),
  categoryId: z.string().optional(),
  city: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
})

/**
 * POST /api/quotes/ai-estimate
 * AI estimate endpoint: categorizes request, checks historical database pricing,
 * provides material scope checklist, and returns matched providers.
 */
export const POST = withRoute("api.quotes.ai-estimate.POST", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.quotes)
  const body = await request.json().catch(() => ({}))
  const { description, categoryId, city, lat, lng } = aiEstimateSchema.parse(body)

  // 1. Calculate smart data-backed estimation
  const estimation = await calculateSmartQuoteEstimation({
    description,
    categoryId,
    city,
  })

  // 2. If coordinates provided, find smart matched providers
  let matchedProviders: unknown[] = []
  if (lat && lng) {
    matchedProviders = await findBestProviders({
      categoryId: estimation.categoryId,
      lat,
      lng,
      limit: 3,
    })
  }

  // Compatible shape with existing AiEstimationResponse
  const legacyCompatibleEstimation = {
    ...estimation,
    estimatedPriceRange: {
      min: estimation.priceRange.min,
      max: estimation.priceRange.max,
    },
    suggestedDescription: description,
  }

  return NextResponse.json({
    ok: true,
    estimation: legacyCompatibleEstimation,
    recommendedProviders: matchedProviders,
  })
})
