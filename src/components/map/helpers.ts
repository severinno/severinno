import type { Map as MapLibreMap } from "maplibre-gl"
import { haversineKm } from "@/lib/geo-server"
import type { ProviderCard } from "@/lib/api"

type MarkerInstance = InstanceType<(typeof import("maplibre-gl"))["Marker"]>

/**
 * Build a minimal GeoJSON FeatureCollection for MapLibre clustering.
 * Only includes `id` in properties — rendering uses runtime data lookup.
 */
export function buildClusterGeoJSON(providers: ProviderCard[]) {
  const features = providers.flatMap((p) => {
    if (typeof p.lat !== "number" || typeof p.lng !== "number") return []
    return [
      {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        properties: { id: p.id },
      },
    ]
  })
  return { type: "FeatureCollection" as const, features }
}

/**
 * Compute bounding box from provider coordinates + optional user location.
 * Fits the map to those bounds with consistent padding and zoom limits.
 */
export function fitProvidersBounds(
  map: MapLibreMap,
  providers: ProviderCard[],
  userLat?: number | null,
  userLng?: number | null,
) {
  const points: [number, number][] = []
  for (const p of providers) {
    if (typeof p.lat === "number" && typeof p.lng === "number") {
      points.push([p.lng, p.lat])
    }
  }
  if (typeof userLat === "number" && typeof userLng === "number") {
    points.push([userLng, userLat])
  }
  if (points.length === 0) return
  if (points.length === 1) {
    map.setCenter(points[0])
    map.setZoom(14)
    return
  }
  let west = points[0][0]
  let south = points[0][1]
  let east = points[0][0]
  let north = points[0][1]
  for (const [lng, lat] of points) {
    if (lng < west) west = lng
    if (lat < south) south = lat
    if (lng > east) east = lng
    if (lat > north) north = lat
  }
  const pad = 0.005
  try {
    map.fitBounds(
      [
        [west - pad, south - pad],
        [east + pad, north + pad],
      ],
      { padding: 60, maxZoom: 15, duration: 600 },
    )
  } catch {
    /* ignore */
  }
}

/**
 * Sync or remove a pulsing user marker on the map.
 * Returns the created marker (or null if removed).
 */
export function syncUserLocationMarker(opts: {
  map: MapLibreMap
  maplibregl: typeof import("maplibre-gl")
  lat?: number | null
  lng?: number | null
  userMarkerRef: React.MutableRefObject<MarkerInstance | null>
}) {
  const { map, maplibregl, lat, lng, userMarkerRef } = opts
  if (userMarkerRef.current) {
    userMarkerRef.current.remove()
    userMarkerRef.current = null
  }
  if (typeof lat !== "number" || typeof lng !== "number") return

  const el = document.createElement("div")
  el.setAttribute("aria-label", "Sua localização")
  el.style.cssText = `
    width: 18px; height: 18px;
    border-radius: 9999px;
    background: #2563eb;
    border: 3px solid white;
    box-shadow: 0 0 0 4px rgba(37,99,235,0.25), 0 2px 8px rgba(0,0,0,0.25);
    position: relative;
  `
  const pulse = document.createElement("span")
  pulse.style.cssText = `
    position: absolute; inset: -6px;
    border-radius: 9999px;
    border: 2px solid rgba(37,99,235,0.55);
    animation: vitrine-map-pulse 1.6s ease-out infinite;
  `
  el.appendChild(pulse)

  const marker = new maplibregl.Marker({ element: el, anchor: "center" })
    .setLngLat([lng, lat])
    .addTo(map)
  userMarkerRef.current = marker
}

/**
 * Escape HTML special characters to prevent injection in popups.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Sort providers by distance from a center point (nearest first).
 */
export function sortByDistance(
  providers: ProviderCard[],
  centerLat: number,
  centerLng: number,
): ProviderCard[] {
  return providers
    .filter((p) => typeof p.lat === "number" && typeof p.lng === "number")
    .map((p) => ({
      ...p,
      _dist: haversineKm(centerLat, centerLng, p.lat!, p.lng!),
    }))
    .sort((a, b) => a._dist - b._dist)
}

/**
 * Point-in-polygon test using ray casting.
 */
export function pointInPolygon(lngLat: [number, number], polygon: [number, number][][]): boolean {
  const [lng, lat] = lngLat
  let inside = false
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0]
      const yi = ring[i][1]
      const xj = ring[j][0]
      const yj = ring[j][1]
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside
      }
    }
  }
  return inside
}
