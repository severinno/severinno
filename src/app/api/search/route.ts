export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { fullTextSearch } from "@/lib/search"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { cacheControlPublic } from "@/lib/api-server"
import { withRoute } from "@/lib/api-route"

export const GET = withRoute("api.search.GET", async (request: Request) => {
  await assertRateLimit(request, RATE_LIMITS.general)

  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q")?.trim() ?? ""

  if (!q || q.length < 2) {
    return NextResponse.json({ items: [], q })
  }

  const items = await fullTextSearch(q)
  return cacheControlPublic(NextResponse.json({ items, q }), 30)
})
