import "server-only"
import { db as prisma } from "./db"
import { haversineKm } from "./geo-server"

export function isInCoverage(
  providerLat: number,
  providerLng: number,
  radiusKm: number,
  targetLat: number,
  targetLng: number,
): boolean {
  const dist = haversineKm(providerLat, providerLng, targetLat, targetLng)
  return dist <= radiusKm
}

export async function getProvidersInCoverage(
  lat: number,
  lng: number,
): Promise<Array<{ id: string; name: string; distanceKm: number }>> {
  const providers = await prisma.user.findMany({
    where: {
      role: "PROVIDER",
      active: true,
      lat: { not: null },
      lng: { not: null },
      radiusKm: { not: null },
    },
    select: { id: true, name: true, lat: true, lng: true, radiusKm: true },
  })

  return providers
    .map((p) => ({
      id: p.id,
      name: p.name,
      distanceKm: haversineKm(p.lat!, p.lng!, lat, lng),
      radiusKm: p.radiusKm!,
    }))
    .filter((p) => p.distanceKm <= p.radiusKm)
    .map(({ id, name, distanceKm }) => ({ id, name, distanceKm: +distanceKm.toFixed(2) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
}
