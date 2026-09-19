import "server-only"
import { db as prisma } from "./db"
import { getRoute, getMultiRoute } from "./routing"
import { saveAndQueueNotification } from "./notification-queue"
import { getTimezoneFromCoords } from "@/lib/geo-timezone"

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
    // `select` explícito: um `include` aqui devolveria a linha INTEIRA do
    // prestador (cpfCnpj, e-mail, telefone, twoFactorSecret, URLs de KYC) só
    // para ler 7 campos. Ver `pii-guard` em response-pii-guard.test.ts.
    select: {
      provider: {
        select: {
          id: true,
          name: true,
          active: true,
          lat: true,
          lng: true,
          radiusKm: true,
          avgRating: true,
        },
      },
    },
  })

  if (!service?.provider.active) return null

  const provider = service.provider
  if (!provider.lat || !provider.lng || !provider.radiusKm) return null

  const route = await getRoute([provider.lat, provider.lng], [clientLat, clientLng])

  if (route.distanceKm > provider.radiusKm) return null

  return {
    providerId: provider.id,
    providerName: provider.name,
    distanceKm: route.distanceKm,
    durationMin: route.durationMin,
    rating: provider.avgRating,
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
    // Apenas o que o ranking consome. A linha inteira de User trazia cpfCnpj,
    // e-mail, telefone e credenciais de 2FA para dentro da memória do processo
    // sem nenhum uso — além do `_count`, que era carregado e nunca lido.
    select: {
      id: true,
      name: true,
      lat: true,
      lng: true,
      radiusKm: true,
      avgRating: true,
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

    candidates.push({
      providerId: p.id,
      providerName: p.name,
      distanceKm: route.distanceKm,
      durationMin: route.durationMin,
      rating: p.avgRating,
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
    // Só o nome de cada parte é usado na notificação. `include: { provider: true,
    // client: true }` carregava duas linhas completas de User (CPF, e-mail, 2FA).
    select: {
      lat: true,
      lng: true,
      scheduledAt: true,
      providerId: true,
      clientId: true,
      provider: { select: { name: true } },
      client: { select: { name: true } },
    },
  })

  if (!booking) return

  const tz = getTimezoneFromCoords(booking.lat, booking.lng)

  await saveAndQueueNotification({
    userId: booking.providerId,
    type: "BOOKING_ASSIGNED",
    title: "Novo serviço agendado",
    body: `${booking.client.name} agendou um serviço para ${new Date(booking.scheduledAt).toLocaleString("pt-BR", { timeZone: tz })}`,
  })

  await saveAndQueueNotification({
    userId: booking.clientId,
    type: "BOOKING_CONFIRMED",
    title: "Serviço confirmado",
    body: `${booking.provider.name} foi alocado para seu serviço em ${new Date(booking.scheduledAt).toLocaleString("pt-BR", { timeZone: tz })}`,
  })
}
