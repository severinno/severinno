import "server-only"
import { db as prisma } from "./db"
import { getRoute, getMultiRoute } from "./routing"
import { saveAndQueueNotification } from "./notification-queue"

export type DispatchResult = {
  providerId: string
  providerName: string
  distanceKm: number
  durationMin: number
  rating: number
}

export async function findBestProvider(
  serviceId: string,
  clientLat: number,
  clientLng: number,
): Promise<DispatchResult | null> {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    include: {
      provider: {
        include: {
          availability: { where: { active: true } },
          reviewsReceived: { select: { rating: true } },
          _count: { select: { bookingsAsProvider: { where: { status: "IN_PROGRESS" } } } },
        },
      },
    },
  })

  if (!service?.provider.active) return null

  const provider = service.provider
  if (!provider.lat || !provider.lng || !provider.radiusKm) return null

  const route = await getRoute([provider.lat, provider.lng], [clientLat, clientLng])

  if (route.distanceKm > provider.radiusKm) return null

  const rating =
    provider.reviewsReceived.length > 0
      ? +(
          provider.reviewsReceived.reduce((a: number, r: { rating: number }) => a + r.rating, 0) /
          provider.reviewsReceived.length
        ).toFixed(1)
      : 0

  return {
    providerId: provider.id,
    providerName: provider.name,
    distanceKm: route.distanceKm,
    durationMin: route.durationMin,
    rating,
  }
}

export async function findBestProviders(
  serviceId: string,
  clientLat: number,
  clientLng: number,
  limit = 3,
): Promise<DispatchResult[]> {
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { categoryId: true },
  })

  if (!service) return []

  // Get nearby providers using PostGIS spatial query
  const nearbyProviders = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT u.id
    FROM "User" u
    WHERE u.role = 'PROVIDER'
      AND u.active = true
      AND u.lat IS NOT NULL
      AND u.lng IS NOT NULL
      AND u.location IS NOT NULL
      AND u."radiusKm" IS NOT NULL
      AND ST_DWithin(
        u.location,
        ST_SetSRID(ST_MakePoint(${clientLng}, ${clientLat}), 4326)::geography,
        u."radiusKm" * 1000
      )
      AND EXISTS (
        SELECT 1 FROM "Service" s
        WHERE s."providerId" = u.id AND s."categoryId" = ${service.categoryId}
      )
    LIMIT 20
  `

  if (nearbyProviders.length === 0) return []

  const providerIds = nearbyProviders.map((p: { id: string }) => p.id)

  const providers = await prisma.user.findMany({
    where: {
      id: { in: providerIds },
    },
    include: {
      reviewsReceived: { select: { rating: true } },
      _count: { select: { bookingsAsProvider: { where: { status: "IN_PROGRESS" } } } },
    },
  })

  const validProviders = providers.filter(
    (p: {
      lat: number | null
      lng: number | null
      radiusKm: number | null
    }): p is typeof p & { lat: number; lng: number; radiusKm: number } =>
      p.lat !== null && p.lng !== null && p.radiusKm !== null,
  )

  if (validProviders.length === 0) return []

  // Single batch call — coordinates use [lat, lng] order (routing.ts toLatLng)
  const clientCoords: [number, number] = [clientLat, clientLng]
  const providerCoords = validProviders.map((p) => [p.lat!, p.lng!] as [number, number])
  const routes = await getMultiRoute(clientCoords, providerCoords)

  const candidates: DispatchResult[] = []

  for (let i = 0; i < validProviders.length; i++) {
    const p = validProviders[i]
    const route = routes[i]
    if (p.radiusKm === null || route.distanceKm > p.radiusKm) continue

    const rating =
      p.reviewsReceived.length > 0
        ? +(
            p.reviewsReceived.reduce((a: number, r: { rating: number }) => a + r.rating, 0) /
            p.reviewsReceived.length
          ).toFixed(1)
        : 0

    candidates.push({
      providerId: p.id,
      providerName: p.name,
      distanceKm: route.distanceKm,
      durationMin: route.durationMin,
      rating,
    })
  }

  return candidates
    .sort((a, b) => {
      const scoreA = a.rating * 10 - a.distanceKm
      const scoreB = b.rating * 10 - b.distanceKm
      return scoreB - scoreA
    })
    .slice(0, limit)
}

export async function dispatchBooking(bookingId: string): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { provider: true, client: true },
  })

  if (!booking) return

  await saveAndQueueNotification({
    userId: booking.providerId,
    type: "BOOKING_ASSIGNED",
    title: "Novo serviço agendado",
    body: `${booking.client.name} agendou um serviço para ${new Date(booking.scheduledAt).toLocaleString("pt-BR")}`,
  })

  await saveAndQueueNotification({
    userId: booking.clientId,
    type: "BOOKING_CONFIRMED",
    title: "Serviço confirmado",
    body: `${booking.provider.name} foi alocado para seu serviço em ${new Date(booking.scheduledAt).toLocaleString("pt-BR")}`,
  })
}
