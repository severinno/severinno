/**
 * GeoJSON circle generator for drawing radius circles on maps.
 *
 * Uses a simple equirectangular approximation — accurate enough for radii
 * up to a few hundred km at most latitudes. The returned GeoJSON Feature
 * can be used directly with MapLibre GL, Leaflet, or any GeoJSON-compatible
 * mapping library via `source.setData()`.
 */

// ---------------------------------------------------------------------------
// GeoJSON circle generation
// ---------------------------------------------------------------------------

/**
 * Generate a GeoJSON polygon approximating a circle around a center point.
 *
 * @param lat - Center latitude in degrees
 * @param lng - Center longitude in degrees
 * @param radiusKm - Radius in kilometres
 * @param points - Number of vertices for the polygon (default 36, minimum 3)
 * @returns A GeoJSON Feature object with a Polygon geometry
 */
export function createRadiusGeoJSON(
  lat: number,
  lng: number,
  radiusKm: number,
  points = 36,
): Record<string, unknown> {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
    return {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[lng, lat]]],
      },
      properties: {},
    }
  }

  const numPoints = Math.max(3, Math.round(points))
  const coords: number[][] = []
  const kmPerDegLat = 111.32
  const latRad = (lat * Math.PI) / 180
  const kmPerDegLng = 111.32 * Math.cos(latRad)

  for (let i = 0; i <= numPoints; i++) {
    const bearing = (i * 360) / numPoints
    const bearingRad = (bearing * Math.PI) / 180
    const dLat = (radiusKm / kmPerDegLat) * Math.cos(bearingRad)
    const dLng = (radiusKm / kmPerDegLng) * Math.sin(bearingRad)
    coords.push([lng + dLng, lat + dLat])
  }

  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [coords],
    },
    properties: {},
  }
}

/**
 * Compute the haversine distance between two lat/lng points in km.
 * Used internally by tests to validate circle geometry.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371 // Earth's mean radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Estimate the average radius of a polygon's points from its center.
 * Computes haversine distance from center to each vertex and returns
 * the mean. Used by tests to validate circle geometry.
 */
export function estimatePolygonRadius(
  polygon: Record<string, unknown>,
  centerLat: number,
  centerLng: number,
): number {
  const coords = (
    polygon as {
      geometry: { coordinates: number[][][] }
    }
  ).geometry.coordinates[0]

  if (!coords || coords.length < 2) return 0

  let total = 0
  const numVerts = coords.length - 1 // exclude closing point
  for (let i = 0; i < numVerts; i++) {
    const [lng, lat] = coords[i]
    total += haversineDistance(centerLat, centerLng, lat, lng)
  }
  return total / numVerts
}

// ---------------------------------------------------------------------------
// MapLibre GL radius circle helpers
// ---------------------------------------------------------------------------

/** Layer / source ID used for the radius circle on the map. */
export const RADIUS_SOURCE_ID = "radius-circle-source"

/** Minimal Map-like interface that syncRadiusCircle / removeRadiusCircle use. */
export interface MapLike {
  getSource(id: string): Record<string, unknown> | undefined
  addSource(id: string, source: Record<string, unknown>): void
  getLayer(id: string): boolean | undefined
  addLayer(layer: Record<string, unknown>): void
  removeLayer(id: string): void
  removeSource(id: string): void
}

/**
 * Add or update a semi-transparent radius circle on a MapLibre GL map.
 *
 * If the source already exists (e.g. from a previous call at a different
 * radius), it updates the GeoJSON data in-place via `setData`. Otherwise it
 * creates the source and three layers: a semi-transparent fill, a dashed
 * outline, and white-edged dot markers around the perimeter.
 *
 * @param map     - A MapLibre GL Map instance (or a minimal mock with the
 *                  same interface).
 * @param lat     - Center latitude of the circle.
 * @param lng     - Center longitude of the circle.
 * @param radiusKm- Radius in kilometres.
 */
export function syncRadiusCircle(
  map: MapLike,
  lat: number,
  lng: number,
  radiusKm: number,
): void {
  const geojson = createRadiusGeoJSON(lat, lng, radiusKm)

  const existing = map.getSource(RADIUS_SOURCE_ID)
  if (existing) {
    // Source already exists — just update the data in-place
    ;(existing as any).setData(geojson as any)
    return
  }

  map.addSource(RADIUS_SOURCE_ID, {
    type: "geojson",
    data: geojson as any,
  })

  // Semi-transparent fill
  map.addLayer({
    id: "radius-circle-fill",
    type: "fill",
    source: RADIUS_SOURCE_ID,
    paint: {
      "fill-color": "#2563eb",
      "fill-opacity": 0.08,
    },
  })

  // Dashed outline
  map.addLayer({
    id: "radius-circle-outline",
    type: "line",
    source: RADIUS_SOURCE_ID,
    paint: {
      "line-color": "#2563eb",
      "line-opacity": 0.35,
      "line-width": 2,
      "line-dasharray": [3, 3],
    },
  })

  // Edge dots (radar feel)
  map.addLayer({
    id: "radius-circle-edge",
    type: "circle",
    source: RADIUS_SOURCE_ID,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "circle-color": "#2563eb",
      "circle-opacity": 0.5,
      "circle-radius": 3,
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff",
    },
  })
}

/**
 * Remove the radius circle layers and source from the map.
 * Safe to call even if the layers have not been added yet.
 */
export function removeRadiusCircle(map: MapLike): void {
  try {
    if (map.getLayer("radius-circle-edge")) map.removeLayer("radius-circle-edge")
    if (map.getLayer("radius-circle-outline")) map.removeLayer("radius-circle-outline")
    if (map.getLayer("radius-circle-fill")) map.removeLayer("radius-circle-fill")
    if (map.getSource(RADIUS_SOURCE_ID)) map.removeSource(RADIUS_SOURCE_ID)
  } catch {
    // ignore — idempotent cleanup
  }
}
