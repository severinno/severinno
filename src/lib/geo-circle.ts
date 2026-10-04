import { haversineKm } from "./geo-shared"

/** Kilometers per degree of latitude (equirectangular approximation). */
const KM_PER_DEG_LAT = 111.32

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
  const latRad = (lat * Math.PI) / 180
  const kmPerDegLng = KM_PER_DEG_LAT * Math.cos(latRad)

  for (let i = 0; i <= numPoints; i++) {
    const bearing = (i * 360) / numPoints
    const bearingRad = (bearing * Math.PI) / 180
    const dLat = (radiusKm / KM_PER_DEG_LAT) * Math.cos(bearingRad)
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
    total += haversineKm(centerLat, centerLng, lat, lng)
  }
  return total / numVerts
}

// ---------------------------------------------------------------------------
// MapLibre GL radius circle helpers
// ---------------------------------------------------------------------------

/** Layer / source ID used for the radius circle on the map. */
export const RADIUS_SOURCE_ID = "radius-circle-source"

/** Minimal GeoJSON source interface (subset used by this module). */
export interface GeoJsonSourceLike {
  setData(data: Record<string, unknown>): void
}

/** Minimal Map-like interface that syncRadiusCircle / removeRadiusCircle use. */
export interface MapLike {
  getSource(id: string): GeoJsonSourceLike | undefined
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
export function syncRadiusCircle(map: MapLike, lat: number, lng: number, radiusKm: number): void {
  const geojson = createRadiusGeoJSON(lat, lng, radiusKm)

  const existing = map.getSource(RADIUS_SOURCE_ID)
  if (existing) {
    // Source already exists — just update the data in-place
    existing.setData(geojson)
    return
  }

  map.addSource(RADIUS_SOURCE_ID, {
    type: "geojson",
    data: geojson,
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

// ---------------------------------------------------------------------------
// GPS accuracy (uncertainty) circle
// ---------------------------------------------------------------------------

/** Layer / source ID used for the GPS accuracy circle (distinct from radius). */
export const ACCURACY_SOURCE_ID = "accuracy-circle-source"

/** Camada fill animada do efeito radar sobre o círculo de accuracy. */
export const ACCURACY_PULSE_LAYER_ID = "accuracy-circle-pulse"

/** Duração de um ciclo completo do pulso (ms). */
export const ACCURACY_PULSE_PERIOD_MS = 2400

/**
 * Add or update a dotted circle showing the GPS accuracy (uncertainty) area
 * around the marker — a visual reference for how precise the fix is.
 *
 * The circle radius is `accuracyM / 1000` km, so a ±12 m fix draws a ~12 m
 * circle. Amber tones distinguish it from the blue service-radius circle.
 * Any invalid accuracy (null/undefined/NaN/≤ 0) removes the circle instead,
 * so callers can pass the value straight from `GeolocationPosition`.
 */
export function syncAccuracyCircle(
  map: MapLike,
  lat: number,
  lng: number,
  accuracyM: number | null | undefined,
): void {
  const radiusKm = (accuracyM ?? NaN) / 1000
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
    removeAccuracyCircle(map)
    return
  }

  const geojson = createRadiusGeoJSON(lat, lng, radiusKm)

  const existing = map.getSource(ACCURACY_SOURCE_ID)
  if (existing) {
    // Source already exists — just update the data in-place
    existing.setData(geojson)
    return
  }

  map.addSource(ACCURACY_SOURCE_ID, {
    type: "geojson",
    data: geojson,
  })

  // Faint amber fill (GPS uncertainty area)
  map.addLayer({
    id: "accuracy-circle-fill",
    type: "fill",
    source: ACCURACY_SOURCE_ID,
    paint: {
      "fill-color": "#d97706",
      "fill-opacity": 0.1,
    },
  })

  // Dotted outline: short dashes + round caps render as dots at any zoom
  map.addLayer({
    id: "accuracy-circle-dots",
    type: "line",
    source: ACCURACY_SOURCE_ID,
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "#b45309",
      "line-opacity": 0.85,
      "line-width": 1.5,
      "line-dasharray": [0.1, 2],
    },
  })

  // Anel de pulso (efeito radar): fill âmbar animado por startAccuracyPulse;
  // inicia invisível para respeitar prefers-reduced-motion (estático).
  map.addLayer({
    id: ACCURACY_PULSE_LAYER_ID,
    type: "fill",
    source: ACCURACY_SOURCE_ID,
    paint: {
      "fill-color": "#f59e0b",
      "fill-opacity": 0,
    },
  })
}

/**
 * Remove the accuracy circle layers and source from the map.
 * Safe to call even if the layers have not been added yet.
 */
export function removeAccuracyCircle(map: MapLike): void {
  try {
    if (map.getLayer(ACCURACY_PULSE_LAYER_ID)) map.removeLayer(ACCURACY_PULSE_LAYER_ID)
    if (map.getLayer("accuracy-circle-dots")) map.removeLayer("accuracy-circle-dots")
    if (map.getLayer("accuracy-circle-fill")) map.removeLayer("accuracy-circle-fill")
    if (map.getSource(ACCURACY_SOURCE_ID)) map.removeSource(ACCURACY_SOURCE_ID)
  } catch {
    // ignore — idempotent cleanup
  }
}

// ---------------------------------------------------------------------------
// Efeito radar — pulso suave no círculo de incerteza do GPS
// ---------------------------------------------------------------------------

/**
 * Opacidades do pulso para uma fase do ciclo em [0, 1] (fração do período).
 *
 * Curva em sino (sen²) — o fill âmbar extra acende e apaga suavemente e o
 * fill base "respira" na mesma fase. Pura, para facilitar testes.
 */
export function accuracyPulseOpacities(phase: number): { pulse: number; fill: number } {
  const p = ((phase % 1) + 1) % 1
  const bell = Math.sin(Math.PI * p) ** 2
  return { pulse: 0.14 * bell, fill: 0.08 + 0.05 * bell }
}

/** Map subset para o pulso: precisa de setPaintProperty (MapLibre real). */
export interface PulseMapLike extends MapLike {
  setPaintProperty?(layerId: string, prop: string, value: unknown): void
}

/**
 * Inicia o pulso (efeito radar) nas camadas do círculo de accuracy.
 *
 * Loop rAF que anima `fill-opacity` das camadas pulse/base via
 * `setPaintProperty` (barato — uniforme, sem rebuild de GeoJSON). Retorna
 * função de stop que cancela o rAF e restaura as opacidades base (o círculo
 * fica estático e correto após o stop).
 *
 * No-op seguro quando o mapa não expõe `setPaintProperty` (mocks/jsdom) ou
 * não há rAF (SSR). A decisão de animar (incl. `prefers-reduced-motion`)
 * é do chamador.
 */
export function startAccuracyPulse(
  map: PulseMapLike,
  periodMs = ACCURACY_PULSE_PERIOD_MS,
): () => void {
  if (typeof map.setPaintProperty !== "function") return () => {}
  if (typeof requestAnimationFrame !== "function") return () => {}

  let raf = 0
  let stopped = false
  const t0 = performance.now()

  const tick = (now: number) => {
    if (stopped) return
    const phase = ((now - t0) % periodMs) / periodMs
    const { pulse, fill } = accuracyPulseOpacities(phase)
    try {
      map.setPaintProperty!(ACCURACY_PULSE_LAYER_ID, "fill-opacity", pulse)
      map.setPaintProperty!("accuracy-circle-fill", "fill-opacity", fill)
    } catch {
      // camadas podem ter sido removidas — segue animando (inofensivo)
    }
    raf = requestAnimationFrame(tick)
  }

  raf = requestAnimationFrame(tick)

  return () => {
    stopped = true
    cancelAnimationFrame(raf)
    try {
      map.setPaintProperty?.(ACCURACY_PULSE_LAYER_ID, "fill-opacity", 0)
      map.setPaintProperty?.("accuracy-circle-fill", "fill-opacity", 0.1)
    } catch {
      // mapa já destruído
    }
  }
}

// ---------------------------------------------------------------------------
// Interactive edge-dot dragging
// ---------------------------------------------------------------------------

/**
 * Edge-drag geometry: store a single grab handle (north-most edge) that
 * the provider can drag to visually resize the circle.
 *
 * When the north-most vertex of the polygon is stored as a separate point,
 * we can render it with a larger, interactive marker and track drag events
 * to compute the new radius in real-time.
 */

/** Layers used for the drag handle. */
export const HANDLE_SOURCE_ID = "radius-handle-source"
export const HANDLE_LAYER_ID = "radius-handle"

/**
 * (Re-)create the drag-handle source + layer from the current circle.
 * Call this whenever the circle radius changes to keep the handle in sync.
 */
export function syncRadiusHandle(map: MapLike, lat: number, lng: number, radiusKm: number): void {
  // Compute the north-most point of the circle
  const northLat = lat + radiusKm / KM_PER_DEG_LAT
  const geojson: Record<string, unknown> = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, northLat] },
        properties: {},
      },
    ],
  }

  const existing = map.getSource(HANDLE_SOURCE_ID)
  if (existing) {
    existing.setData(geojson)
    return
  }

  map.addSource(HANDLE_SOURCE_ID, {
    type: "geojson",
    data: geojson,
  })

  map.addLayer({
    id: HANDLE_LAYER_ID,
    type: "circle",
    source: HANDLE_SOURCE_ID,
    paint: {
      "circle-color": "#ffffff",
      "circle-radius": 9,
      "circle-stroke-width": 3,
      "circle-stroke-color": "#2563eb",
      "circle-opacity": 1,
    },
  })
}

/** Minimal event object shape used by drag handlers. */
export interface DragEventLike {
  point: { x: number; y: number }
  preventDefault?: () => void
}

/**
 * Map subset required for interactive edge dragging: full MapLibre Map
 * instance (needs on/off/unproject/getCanvas) plus the MapLike source API.
 */
export interface EdgeDragMap extends MapLike {
  getCanvas(): HTMLCanvasElement
  unproject(point: { x: number; y: number }): { lat: number; lng: number }
  on(event: string, handler: (e: DragEventLike) => void): void
  on(event: string, layerId: string, handler: (e: DragEventLike) => void): void
  off(event: string, handler: (e: DragEventLike) => void): void
  off(event: string, layerId: string, handler: (e: DragEventLike) => void): void
}

/** Remove the drag handle layer + source. */
export function removeRadiusHandle(map: MapLike): void {
  try {
    if (map.getLayer(HANDLE_LAYER_ID)) map.removeLayer(HANDLE_LAYER_ID)
    if (map.getSource(HANDLE_SOURCE_ID)) map.removeSource(HANDLE_SOURCE_ID)
  } catch {
    // ignore
  }
}

/**
 * Enable interactive edge dragging on the radius circle.
 *
 * Renders a larger grab handle (north-most point) that the user can
 * click & drag to resize the circle in real-time. On drag end,
 * calls `onDragEnd(newRadiusKm)` so the host component can save.
 *
 * Event flow:
 *   mousedown on handle → isDragging = true, cursor = grabbing
 *   mousemove → compute haversine distance from center, update circle + handle via setData
 *   mouseup / mouseleave → isDragging = false, cursor = normal, onDragEnd(finalRadius)
 *
 * @param map       - Full MapLibre Map instance (needs on/off/unproject/getCanvas).
 * @param centerLat - Center latitude of the circle.
 * @param centerLng - Center longitude of the circle.
 * @param onDragEnd - Called with the final (rounded, clamped) radius in km.
 * @returns         A cleanup function that removes all event handlers.
 */
export function makeRadiusEdgeDraggable(
  map: EdgeDragMap,
  centerLat: number,
  centerLng: number,
  onDragEnd: (newRadiusKm: number) => void,
): () => void {
  let isDragging = false
  let finalRadius = 0

  const onMouseDown = (e: DragEventLike) => {
    e.preventDefault?.()
    isDragging = true
    if (map.getCanvas) map.getCanvas().style.cursor = "grabbing"
    // Compute initial radius so onMouseUp has a value even without mouse move
    const coords = map.unproject(e.point)
    finalRadius = Math.round(
      Math.max(1, Math.min(100, haversineKm(centerLat, centerLng, coords.lat, coords.lng))),
    )
  }

  const onMouseMove = (e: DragEventLike) => {
    if (!isDragging) return
    const coords = map.unproject(e.point)
    const newRadius = Math.round(
      Math.max(1, Math.min(100, haversineKm(centerLat, centerLng, coords.lat, coords.lng))),
    )
    finalRadius = newRadius

    // Update circle + handle in real-time via setData
    const src = map.getSource(RADIUS_SOURCE_ID)
    if (src) src.setData(createRadiusGeoJSON(centerLat, centerLng, newRadius))
    const hSrc = map.getSource(HANDLE_SOURCE_ID)
    if (hSrc) {
      hSrc.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [centerLng, centerLat + newRadius / KM_PER_DEG_LAT],
            },
            properties: {},
          },
        ],
      })
    }
  }

  const onMouseUp = () => {
    if (!isDragging) return
    isDragging = false
    if (map.getCanvas) map.getCanvas().style.cursor = ""
    onDragEnd(finalRadius)
  }

  const onMouseEnterH = () => {
    if (map.getCanvas && !isDragging) map.getCanvas().style.cursor = "grab"
  }

  const onMouseLeaveH = () => {
    if (!isDragging && map.getCanvas) map.getCanvas().style.cursor = ""
  }

  // (mouseleave on global map is handled by onMouseUp, so onMouseLeaveG is unused)

  // Attach event handlers
  map.on("mousedown", HANDLE_LAYER_ID, onMouseDown)
  map.on("mousemove", onMouseMove)
  map.on("mouseup", onMouseUp)
  map.on("mouseleave", onMouseUp)
  map.on("mouseenter", HANDLE_LAYER_ID, onMouseEnterH)
  map.on("mouseleave", HANDLE_LAYER_ID, onMouseLeaveH)

  return () => {
    try {
      map.off("mousedown", HANDLE_LAYER_ID, onMouseDown)
      map.off("mousemove", onMouseMove)
      map.off("mouseup", onMouseUp)
      map.off("mouseleave", onMouseUp)
      map.off("mouseenter", HANDLE_LAYER_ID, onMouseEnterH)
      map.off("mouseleave", HANDLE_LAYER_ID, onMouseLeaveH)
      if (map.getCanvas) map.getCanvas().style.cursor = ""
    } catch {
      // map may be destroyed
    }
  }
}
