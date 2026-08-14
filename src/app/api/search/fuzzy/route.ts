import { NextRequest, NextResponse } from "next/server"
import { fuzzySearchCatalog, DEFAULT_SERVICE_CATALOG } from "@/lib/fuzzy-search"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get("q") || ""

  if (!q.trim()) {
    return NextResponse.json({
      success: true,
      query: "",
      count: 0,
      results: [],
    })
  }

  const results = fuzzySearchCatalog(q, DEFAULT_SERVICE_CATALOG, 0.25)

  return NextResponse.json({
    success: true,
    query: q,
    count: results.length,
    suggestion: results[0]?.suggestedSpelling,
    results,
  })
}
