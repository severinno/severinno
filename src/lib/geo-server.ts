/**
 * geo-server.ts
 *
 * Barrel for server-side geospatial utilities.
 *
 * Re-exports the most commonly used geo functions and types on the
 * server side:
 *
 *   Functions:
 *     computeDistanceMap   — PostGIS → Haversine → null distance chain
 *     haversineKm          — pure Haversine distance calculation
 *     formatDistance       — format km/m in pt-BR locale
 *
 *   Types:
 *     ProviderGeo                   — provider shape for distance fallback
 *     CenterGeo                     — center-point coordinates
 *     ComputeDistanceMapOptions     — full options interface
 *
 * Server-side modules should import from this barrel instead of reaching
 * into the implementation modules directly, keeping the public API surface
 * explicit and making future refactoring easier.
 *
 * @example
 * ```ts
 * import {
 *   computeDistanceMap,
 *   haversineKm,
 *   type ProviderGeo,
 *   type CenterGeo,
 * } from "@/lib/geo-server"
 * ```
 */

export { computeDistanceMap } from "./distance-fallback"
export type { ProviderGeo, CenterGeo, ComputeDistanceMapOptions } from "./distance-fallback"
export { haversineKm, formatDistance } from "./geo-shared"
