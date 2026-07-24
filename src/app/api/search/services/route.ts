import { NextResponse } from "next/server"
import { searchServices } from "@/lib/search"
import { handleError } from "@/lib/api-server"

/**
 * OpenSearch-powered service search.
 *
 * Query params:
 *   q     — Full-text query (fuzzy, synonym-aware)
 *   page  — Page number (default: 1)
 *   limit — Results per page (default: 20, max: 50)
 *
 * Usage:
 *   GET /api/search/services?q=instalação+elétrica
 *
 * Falls back to empty results if OpenSearch is unavailable.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q")?.trim()
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1)
    const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? "20") || 20))

    if (!q) {
      return NextResponse.json(
        { error: "Parâmetro 'q' é obrigatório" },
        { status: 400 },
      )
    }

    const result = await searchServices(q, page, limit)

    return NextResponse.json({
      items: result.items,
      total: result.total,
      page: result.page,
      limit: result.limit,
      took: result.took,
      engine: "opensearch",
    })
  } catch (e) {
    return handleError(e)
  }
}
