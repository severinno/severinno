export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"

import { haversineKm } from "@/lib/geo-server"
import { isPostGISAvailable } from "@/lib/postgis"
import { subDays } from "date-fns"

import { withRoute } from "@/lib/api-route"

/**
 * GET /api/provider/region-demand
 *
 * Returns the count of active service requests (non-CANCELLED bookings +
 * PENDING quotes) within the provider's service radius.
 *
 * This gives the provider a sense of "demanda ativa na sua região"
 * motivation to stay active.
 *
 * Uses PostGIS ST_DWithin when available, falls back to Haversine JS.
 *
 * Response:
 *   { total, bookings, quotes, providerLat, providerLng, radiusKm, regionConfigured }
 *
 * When the provider hasn't configured their location/radius:
 *   { total: 0, bookings: 0, quotes: 0, regionConfigured: false }
 */

export const GET = withRoute("api.provider.region-demand.GET", async (_request) => {
  const session = await requireUser()
  if (session.role !== "PROVIDER") {
    return NextResponse.json(
      { error: "Apenas prestadores podem acessar esta rota" },
      { status: 403 },
    )
  }

  const provider = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      lat: true,
      lng: true,
      radiusKm: true,
      active: true,
    },
  })

  if (!provider || !provider.lat || !provider.lng || !provider.radiusKm) {
    return NextResponse.json({
      total: 0,
      bookings: 0,
      quotes: 0,
      regionConfigured: false,
      providerLat: null,
      providerLng: null,
      radiusKm: null,
    })
  }

  const { lat, lng, radiusKm } = provider
  const radiusMeters = radiusKm * 1000
  const thirtyDaysAgo = subDays(new Date(), 30)

  // ------------------------------------------------------------------
  // PostGIS path — index-assisted spatial filter
  // ------------------------------------------------------------------
  const pgAvailable = await isPostGISAvailable()

  if (pgAvailable) {
    const [bookingResult, quoteResult] = await Promise.all([
      db.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count FROM "Booking"
          WHERE status != 'CANCELLED'
            AND "scheduledAt" >= ${thirtyDaysAgo}
            AND location IS NOT NULL
            AND ST_DWithin(
              location,
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
              ${radiusMeters}
            )
        `,
      db.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count FROM "QuoteRequest"
          WHERE status = 'PENDING'
            AND "createdAt" >= ${thirtyDaysAgo}
            AND location IS NOT NULL
            AND ST_DWithin(
              location,
              ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
              ${radiusMeters}
            )
        `,
    ])

    const bookings = Number(bookingResult[0]?.count ?? 0)
    const quotes = Number(quoteResult[0]?.count ?? 0)

    return NextResponse.json({
      total: bookings + quotes,
      bookings,
      quotes,
      providerLat: lat,
      providerLng: lng,
      radiusKm,
      regionConfigured: true,
    })
  }

  // ------------------------------------------------------------------
  // Haversine JS fallback — fetch all + filter in-memory
  // ------------------------------------------------------------------
  const [allBookings, allQuotes] = await Promise.all([
    db.booking.findMany({
      where: {
        status: { not: "CANCELLED" },
        scheduledAt: { gte: thirtyDaysAgo },
      },
      select: { lat: true, lng: true },
    }),
    db.quoteRequest.findMany({
      where: {
        status: "PENDING",
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { lat: true, lng: true },
    }),
  ])

  const bookings = allBookings.filter(
    (b) => b.lat !== null && b.lng !== null && haversineKm(lat, lng, b.lat, b.lng) <= radiusKm,
  ).length

  const quotes = allQuotes.filter(
    (q) => q.lat !== null && q.lng !== null && haversineKm(lat, lng, q.lat, q.lng) <= radiusKm,
  ).length

  return NextResponse.json({
    total: bookings + quotes,
    bookings,
    quotes,
    providerLat: lat,
    providerLng: lng,
    radiusKm,
    regionConfigured: true,
  })
})
