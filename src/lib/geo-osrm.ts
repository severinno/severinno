/**
 * geo-osrm.ts — Motor Soberano de Roteamento Viário (OSRM Backend)
 *
 * Fornece cálculo de rotas viárias, distâncias reais e tempos estimados de chegada (ETA)
 * em malha viária local via OSRM (Open Source Routing Machine).
 *
 * Características:
 * - Consulta primária: container OSRM local (docker-compose.geo.yml: http://127.0.0.1:5000)
 * - Tempo de resposta sub-milissegundo (< 2ms) em rede local
 * - Resolução de geometria vetorial (GeoJSON / polyline)
 * - Fallback inteligente: cálculo geodésico Haversine com estimativa de tráfego urbano
 *   caso o container OSRM ainda não tenha sido iniciado no ambiente.
 */

import { haversineKm } from "./geo-shared"
import logger from "./logger"

const log = logger.child({ module: "geo-osrm" })

export interface OsrmRouteResult {
  distanceMeters: number
  durationSeconds: number
  polyline: [number, number][] // [lat, lng] array
  geometry?: {
    type: "LineString"
    coordinates: [number, number][] // [lng, lat] GeoJSON standard
  }
  source: "osrm-local" | "osrm-fallback-geodesic"
}

export interface OsrmRouteOptions {
  profile?: "driving" | "bike" | "foot"
  timeoutMs?: number
  osrmUrl?: string
}

/**
 * Calcula rota viária entre dois pontos geográficos [lat, lng].
 */
export async function calculateRoute(
  origin: [number, number], // [lat, lng]
  destination: [number, number], // [lat, lng]
  options: OsrmRouteOptions = {},
): Promise<OsrmRouteResult> {
  const profile = options.profile ?? "driving"
  const timeoutMs = options.timeoutMs ?? 1500
  const baseUrl =
    options.osrmUrl ?? process.env.OSRM_URL ?? process.env.OSRM_BASE_URL ?? "http://127.0.0.1:5000"

  const [originLat, originLng] = origin
  const [destLat, destLng] = destination

  // Formato OSRM: /route/v1/{profile}/{lng1},{lat1};{lng2},{lat2}
  const endpoint = `${baseUrl}/route/v1/${profile}/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson`

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const res = await fetch(endpoint, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })

    clearTimeout(timer)

    if (res.ok) {
      const data = await res.json()
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0]
        const coords: [number, number][] = route.geometry.coordinates.map(
          ([lng, lat]: [number, number]) => [lat, lng],
        )

        return {
          distanceMeters: Math.round(route.distance),
          durationSeconds: Math.round(route.duration),
          polyline: coords,
          geometry: route.geometry,
          source: "osrm-local",
        }
      }
    }
  } catch {
    // Local OSRM instance unavailable or timed out — degrade gracefully to geodesic calculation
    log.debug(
      { origin, destination },
      "OSRM local indisponível no momento — utilizando estimativa geodésica de rota",
    )
  }

  // ── Fallback Geodésico Inteligente ──────────────────────────────────────────
  // Distância Haversine * 1.32 (fator de curvatura e sinuosidade de malha viária urbana)
  const straightDistKm = haversineKm(originLat, originLng, destLat, destLng)
  const urbanDistMeters = Math.round(straightDistKm * 1.32 * 1000)

  // Velocidades médias urbanas:
  // - Carro / Moto: ~30 km/h (8.33 m/s)
  // - Bicicleta: ~14 km/h (3.88 m/s)
  // - A pé: ~4.5 km/h (1.25 m/s)
  const speedMps = profile === "bike" ? 3.88 : profile === "foot" ? 1.25 : 8.33
  const durationSeconds = Math.max(30, Math.round(urbanDistMeters / speedMps))

  // Interpolação de 5 pontos intermediários para gerar uma polilinha fluida
  const steps = 5
  const polyline: [number, number][] = []
  const geojsonCoords: [number, number][] = []

  for (let i = 0; i <= steps; i++) {
    const factor = i / steps
    const lat = originLat + factor * (destLat - originLat)
    const lng = originLng + factor * (destLng - originLng)
    polyline.push([Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6])
    geojsonCoords.push([Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6])
  }

  return {
    distanceMeters: urbanDistMeters,
    durationSeconds,
    polyline,
    geometry: {
      type: "LineString",
      coordinates: geojsonCoords,
    },
    source: "osrm-fallback-geodesic",
  }
}
