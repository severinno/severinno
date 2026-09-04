export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { categorizeServiceRequest } from "@/lib/ai-categorizer"
import { findBestProviders } from "@/lib/smart-match"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { z } from "zod"

const aiEstimateSchema = z.object({
  description: z.string().min(5, "Descreva o serviço com pelo menos 5 caracteres"),
  lat: z.number().optional(),
  lng: z.number().optional(),
})

/**
 * POST /api/quotes/ai-estimate
 * AI estimate endpoint: categorizes the request and returns estimated prices + matched providers.
 */
export async function POST(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.quotes)
    const body = await request.json().catch(() => ({}))
    const { description, lat, lng } = aiEstimateSchema.parse(body)

    // 1. Categorize using 100% open source LocalAI / Llama
    const estimation = await categorizeServiceRequest(description)

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

    return NextResponse.json({
      ok: true,
      estimation,
      recommendedProviders: matchedProviders,
    })
  } catch (e) {
    return handleError(e)
  }
}
