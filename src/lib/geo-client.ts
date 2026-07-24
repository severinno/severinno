/**
 * Client-safe geo helpers.
 *
 * `src/lib/geo.ts` is server-only (imports `server-only`) because some of its
 * helpers call external services with a real User-Agent. These pure helpers
 * are safe to use in client components (cards, maps, etc).
 *
 * Pure math helpers are re-exported from geo-shared.ts to avoid duplication.
 */

export { haversineKm, formatDistance } from "./geo-shared"
