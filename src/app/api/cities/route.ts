export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"

import { withRoute } from "@/lib/api-route"

// =============================================================================
// GET /api/cities — List active cities with provider counts
// =============================================================================
export const GET = withRoute("api.cities.GET", async (_request) => {
  const cities = await db.city.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      slug: true,
      state: true,
      lat: true,
      lng: true,
      _count: {
        select: { providers: { where: { active: true, role: "PROVIDER" } } },
      },
    },
    orderBy: { name: "asc" },
  })

  return NextResponse.json({
    cities: cities.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      state: c.state,
      lat: c.lat,
      lng: c.lng,
      providerCount: c._count.providers,
    })),
  })
})
