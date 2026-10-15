export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { withRoute } from "@/lib/api-route"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { getPartnerStoresForCategory, GV_PARTNER_STORES } from "@/lib/materials-breakdown"

/**
 * GET /api/stores/materials?category=HIDRAULICA
 * Returns verified partner hardware and construction material stores in Governador Valadares.
 */
export const GET = withRoute("api.stores.materials.GET", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.general)

  const url = new URL(request.url)
  const category = url.searchParams.get("category")

  const stores = category ? getPartnerStoresForCategory(category) : GV_PARTNER_STORES

  return NextResponse.json({
    ok: true,
    city: "Governador Valadares",
    count: stores.length,
    stores,
  })
})
