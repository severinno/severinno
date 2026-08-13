/**
 * fetch-providers-data.ts
 *
 * Phase 2 of the providers search pipeline — fetches full provider data
 * (services, completed bookings, profile records) for a resolved set of
 * provider IDs, then computes distances via the PostGIS → Haversine → null
 * fallback chain.
 *
 * Dependency injection pattern (same as distance-fallback.ts and
 * radius-expansion.ts): the Prisma model methods are injected so the
 * function is testable without a real database connection.
 *
 * NOTE: The injected function types use `unknown` for input args to avoid
 * tight coupling to Prisma's generated types. The return types are explicit
 * so that the mapper logic downstream is type-safe.
 */

import { computeDistanceMap } from "@/lib/geo-server"

// ---------------------------------------------------------------------------
// Internal row types (derived from what the mapper actually consumes)
// ---------------------------------------------------------------------------

/** Shape of each service row after serviceFindMany. */
interface ServiceRow {
  id: string
  providerId: string
  title: string
  description: string | null
  basePrice: number
  unit: string
  photos: unknown
  category: { id: string; name: string }
}

/** Shape of each provider row after userFindMany. */
interface ProviderRow {
  id: string
  name: string
  avatarUrl: string | null
  coverUrl: string | null
  bio: string | null
  lat: number | null
  lng: number | null
  city: string | null
  state: string | null
  verified: boolean
  avgRating: number | null
  reviewCount: number
  favoriteCount: number
  createdAt: Date
  radiusKm: number | null
  slug: string | null
}

/** Shape of each completed-booking group-by row. */
interface BookingGroupRow {
  providerId: string
  _count: { id: number }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Geo context needed for distance computation. */
export interface FetchProvidersDataGeo {
  hasGeo: boolean
  latNum: number | null
  lngNum: number | null
  centerGeo?: { lat: number; lng: number; radiusKm: number } | null
}

/**
 * Injected Prisma dependencies.
 *
 * Input args are typed as `unknown` to avoid Prisma-type drift. The return
 * types are explicit so the mapper logic inside fetchProvidersData is fully
 * type-checked.
 */
export interface FetchProvidersDataDeps {
  serviceFindMany: (args: unknown) => Promise<ServiceRow[]>
  bookingGroupBy: (args: unknown) => Promise<BookingGroupRow[]>
  userFindMany: (args: unknown) => Promise<ProviderRow[]>
  queryRawUnsafe: <T>(sql: string, ...params: unknown[]) => Promise<T>
}

/** A single provider item as returned by fetchProvidersData. */
export interface ProviderDataItem {
  id: string
  name: string
  avatarUrl: string | null
  coverUrl: string | null
  bio: string | null
  lat: number | null
  lng: number | null
  city: string | null
  state: string | null
  verified: boolean
  rating: number | null
  reviewCount: number
  favoriteCount: number
  radiusKm: number | null
  completedBookings: number
  memberSince: string
  distanceKm: number | null
  services: Array<{
    id: string
    title: string
    description: string | null
    basePrice: number
    unit: string
    photos: string[]
    category: { id: string; name: string }
  }>
}

// ---------------------------------------------------------------------------
// Phase 2 — fetch full provider data for a set of IDs
// ---------------------------------------------------------------------------

/**
 * Fetch full provider data for a resolved set of provider IDs.
 *
 * Runs three queries in parallel (services, completed bookings, provider
 * profiles), then computes distances via `computeDistanceMap`.
 *
 * @param providerIds - Provider IDs to fetch (pre-resolved by Phase 1).
 * @param geo         - Geo context for distance computation.
 * @param deps        - Injected Prisma methods (for testability).
 * @returns An array of provider data items sorted to match `providerIds`.
 *
 * @example
 * ```ts
 * const items = await fetchProvidersData(
 *   ["p1", "p2"],
 *   { hasGeo: true, latNum: -23.55, lngNum: -46.63, centerGeo },
 *   {
 *     serviceFindMany: db.service.findMany.bind(db),
 *     bookingGroupBy: db.booking.groupBy.bind(db),
 *     userFindMany: db.user.findMany.bind(db),
 *     queryRawUnsafe: db.$queryRawUnsafe.bind(db),
 *   },
 * )
 * ```
 */
export async function fetchProvidersData(
  providerIds: string[],
  geo: FetchProvidersDataGeo,
  deps: FetchProvidersDataDeps,
): Promise<ProviderDataItem[]> {
  const { hasGeo, latNum, lngNum, centerGeo } = geo
  const { serviceFindMany, bookingGroupBy, userFindMany, queryRawUnsafe } = deps

  const [services, completedBookingsData] = await Promise.all([
    // Services for these providers (flat, no cartesian join)
    serviceFindMany({
      where: { providerId: { in: providerIds }, active: true },
      include: { category: { select: { id: true, name: true } } },
      orderBy: { basePrice: "asc" },
    }),
    // Completed bookings count per provider
    bookingGroupBy({
      by: ["providerId"],
      where: { providerId: { in: providerIds }, status: "COMPLETED" },
      _count: { id: true },
    }),
  ])

  // Group services by providerId
  const servicesByProvider = new Map<string, typeof services>()
  for (const svc of services) {
    const arr = servicesByProvider.get(svc.providerId) ?? []
    arr.push(svc)
    servicesByProvider.set(svc.providerId, arr)
  }

  // Map completed bookings count
  const completedMap = new Map<string, number>()
  for (const row of completedBookingsData) {
    completedMap.set(row.providerId, row._count.id)
  }

  // Fetch provider records (lightweight select)
  const providers = await userFindMany({
    where: { id: { in: providerIds } },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      coverUrl: true,
      bio: true,
      lat: true,
      lng: true,
      city: true,
      state: true,
      verified: true,
      avgRating: true,
      reviewCount: true,
      favoriteCount: true,
      createdAt: true,
      radiusKm: true,
      slug: true,
    },
  })

  // Sort providers to match the original ID order
  const idOrder = new Map(providerIds.map((id, idx) => [id, idx]))
  providers.sort(
    (a: ProviderRow, b: ProviderRow) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0),
  )

  // Compute distance via PostGIS → Haversine → null fallback chain
  const distanceMap = await computeDistanceMap({
    providerIds,
    providers,
    centerGeo,
    hasGeo,
    userLat: latNum!,
    userLng: lngNum!,
    queryRawUnsafe,
  })

  return providers.map((p: ProviderRow) => {
    const distanceKm = distanceMap.get(p.id) ?? null

    return {
      id: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl,
      coverUrl: p.coverUrl,
      bio: p.bio,
      lat: p.lat,
      lng: p.lng,
      city: p.city,
      state: p.state,
      verified: p.verified,
      rating: p.avgRating,
      reviewCount: p.reviewCount,
      favoriteCount: p.favoriteCount,
      radiusKm: p.radiusKm,
      completedBookings: completedMap.get(p.id) ?? 0,
      memberSince: p.createdAt.toISOString(),
      distanceKm,
      services: (servicesByProvider.get(p.id) ?? []).map((s: ServiceRow) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        basePrice: s.basePrice,
        unit: s.unit,
        photos: s.photos as string[],
        category: s.category,
      })),
    }
  })
}
