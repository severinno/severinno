export const dynamic = "force-dynamic"

/**
 * GET /api/search/semantic
 *
 * Endpoint de Busca Semântica em Linguagem Natural sobre o Catálogo de Serviços.
 * Permite consultas livres (ex: "minha torneira tá pingando sem parar", "curto circuito no quarto").
 */

import { NextResponse } from "next/server"
import { withRoute } from "@/lib/api-route"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { searchSemanticCatalog } from "@/lib/ai-semantic-search"
import { z } from "zod"

const semanticSearchQuerySchema = z.object({
  q: z.string().min(2, "A consulta deve ter pelo menos 2 caracteres").max(200),
  limit: z.coerce.number().min(1).max(30).default(10),
  minScore: z.coerce.number().min(0).max(1).default(0.25),
  categoryId: z.string().optional(),
  city: z.string().optional(),
})

export const GET = withRoute("api.search.semantic.GET", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.general)

  const url = new URL(request.url)
  const queryParams = Object.fromEntries(url.searchParams.entries())

  const parsed = semanticSearchQuerySchema.safeParse(queryParams)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Parâmetros de busca inválidos", details: parsed.error.format() },
      { status: 400 },
    )
  }

  const { q, limit, minScore, categoryId, city } = parsed.data

  const results = await searchSemanticCatalog(q, {
    limit,
    minScore,
    categoryId,
    city,
  })

  return NextResponse.json({
    query: q,
    count: results.length,
    results,
  })
})
