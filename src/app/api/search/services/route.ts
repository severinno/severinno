export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { searchServices } from "@/lib/search"
import { searchServicesDatabase } from "@/lib/search-database-fallback"
import { cacheControlPublic, handleError, noStoreJson } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { cacheGet, cacheSet } from "@/lib/redis"

/**
 * OpenSearch-powered service search with intelligent Database Fallback.
 *
 * Query params:
 *   q     — Full-text query (fuzzy, synonym-aware)
 *   page  — Page number (default: 1)
 *   limit — Results per page (default: 20, max: 50)
 *
 * Usage:
 *   GET /api/search/services?q=instalação+elétrica
 *
 * Falls back to PostgreSQL Full-Text Search with synonyms if OpenSearch is unavailable.
 */
export async function GET(request: Request) {
  await assertRateLimit(request, RATE_LIMITS.general)
  try {
    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q")?.trim()
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1)
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? "20") || 20))

    if (!q) {
      return noStoreJson({ error: "Parâmetro 'q' é obrigatório" }, { status: 400 })
    }

    const cacheKey = `search:services:${q.toLowerCase()}:${page}:${limit}`
    const cached = await cacheGet<{
      items: unknown[]
      total: number
      page: number
      limit: number
      took: number
      engine: string
    }>(cacheKey).catch(() => null)

    if (cached) {
      return cacheControlPublic(
        NextResponse.json({
          ...cached,
          engine: `${cached.engine}-cached`,
        }),
        30,
      )
    }

    let result = await searchServices(q, page, limit)
    let engine = "opensearch"

    if (!result.items || result.items.length === 0) {
      result = await searchServicesDatabase(q, page, limit)
      engine = "database-fallback"
    }

    const responsePayload = {
      items: result.items,
      total: result.total,
      page: result.page,
      limit: result.limit,
      took: result.took,
      engine,
    }

    // Grava no Redis em background por 5 minutos (300 segundos)
    cacheSet(cacheKey, responsePayload, 300).catch(() => {})

    return cacheControlPublic(NextResponse.json(responsePayload), 30)
  } catch (e) {
    return handleError(e)
  }
}
