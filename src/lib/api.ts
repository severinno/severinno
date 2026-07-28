/**
 * Typed fetch wrapper for the Severinno Marketplace SPA.
 *
 * All requests use RELATIVE paths (e.g. "/api/providers") so the same code
 * works under the Caddy gateway, in dev, and in production. The session is
 * sent automatically via `credentials: "include"` (cookie `severinno_session`).
 *
 * Helper functions throw on !ok and return the parsed JSON body.
 */

// ---------------------------------------------------------------------------
// Shared API types — mirrored from the API contract in worklog.md
// ---------------------------------------------------------------------------

export type ServiceUnit =
  | "UNIDADE"
  | "METRO_LINEAR"
  | "METRO_QUADRADO"
  | "METRO_CUBICO"

export type ProviderService = {
  id: string
  title: string
  description?: string | null
  basePrice: number
  unit: ServiceUnit
  photos?: string[]
  category?: { id: string; name: string } | null
}

export type ProviderCard = {
  id: string
  name: string
  avatarUrl?: string | null
  coverUrl?: string | null
  bio?: string | null
  rating: number
  reviewCount: number
  verified: boolean
  city?: string | null
  distanceKm?: number | null
  lat?: number | null
  lng?: number | null
  services: ProviderService[]
  completedBookings?: number
  memberSince?: string
}

export type ProviderAvailability = {
  id: string
  dayOfWeek: number
  startTime: string
  endTime: string
}

export type ProviderReview = {
  id: string
  rating: number
  comment?: string | null
  createdAt: string
  author?: { id: string; name: string; avatarUrl?: string | null } | null
}

export type ProviderDetail = ProviderCard & {
  whatsapp?: string | null
  address?: string | null
  district?: string | null
  state?: string | null
  cep?: string | null
  radiusKm?: number | null
  availability?: ProviderAvailability[]
  reviews?: ProviderReview[]
}

export type Category = {
  id: string
  name: string
  slug: string
  icon?: string | null
  level: number
  parentId?: string | null
  children?: Category[]
}

export type PagedResult<T> = {
  items: T[]
  total: number
  limit: number
  nextCursor: string | null
  hasMore: boolean
  /** Raio efetivamente usado na busca (PostGIS). null = sem expansão; -1 = além de 100km (sem filtro de raio). */
  expandedRadius?: number | null
}

export type FavoriteResponse = { favorited: boolean }

export type CepResult = {
  cep: string
  street?: string
  district?: string
  city?: string
  state?: string
}

export type GeoSearchResult = {
  lat: number
  lng: number
  displayName: string
  street?: string | null
  district?: string | null
  city?: string | null
  state?: string | null
  cep?: string | null
  category?: string
  type?: string
  importance: number
}

export type ApiError = {
  status: number
  message: string
  data?: unknown
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

function buildUrl(path: string, params?: Record<string, unknown>): string {
  if (!params) return path
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue
    if (Array.isArray(value)) {
      for (const v of value) {
        if (v !== undefined && v !== null && v !== "") {
          sp.append(key, String(v))
        }
      }
    } else {
      sp.append(key, String(value))
    }
  }
  const qs = sp.toString()
  return qs ? `${path}?${qs}` : path
}

async function request<T>(
  method: string,
  path: string,
  params?: Record<string, unknown>,
  body?: unknown,
): Promise<T> {
  const url = method === "GET" ? buildUrl(path, params) : path
  const init: RequestInit = {
    method,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store", // dynamic data; public endpoints use per-route caching via apiGet calls
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }

  let res: Response
  try {
    res = await fetch(url, init)
  } catch (e) {
    const err: ApiError = {
      status: 0,
      message: "Erro de rede. Verifique sua conexão e tente novamente.",
      data: e,
    }
    throw err
  }

  const contentType = res.headers.get("content-type") ?? ""
  let parsed: unknown = null
  if (contentType.includes("application/json")) {
    parsed = await res.json().catch(() => null)
  }

  if (!res.ok) {
    const message =
      (parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error?: unknown }).error)
        : undefined) ??
      (typeof parsed === "string" && parsed ? parsed : undefined) ??
      `Erro ${res.status} ao processar a requisição.`
    const err: ApiError = { status: res.status, message, data: parsed }
    throw err
  }

  return parsed as T
}

export function apiGet<T>(
  path: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return request<T>("GET", path, params)
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("POST", path, undefined, body)
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("PATCH", path, undefined, body)
}

export function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("DELETE", path, undefined, body)
}

// ---------------------------------------------------------------------------
// Convenience endpoints
// ---------------------------------------------------------------------------

export type ProvidersQuery = {
  lat?: number | null
  lng?: number | null
  q?: string
  categoryId?: string
  radius?: number
  sort?: "rating" | "distance"
  cursor?: string | null
  limit?: number
  verified?: boolean
  minRating?: number
}

export function fetchProviders(query: ProvidersQuery) {
  return apiGet<PagedResult<ProviderCard>>("/api/providers", {
    lat: query.lat,
    lng: query.lng,
    q: query.q,
    categoryId: query.categoryId,
    radius: query.radius,
    sort: query.sort,
    cursor: query.cursor,
    limit: query.limit,
    verified: query.verified,
    minRating: query.minRating,
  })
}

export function fetchProviderDetail(id: string) {
  return apiGet<ProviderDetail>(`/api/providers/${id}`)
}

export function fetchCategories(opts?: { level?: number; parentId?: string }) {
  return apiGet<Category[]>("/api/categories", {
    level: opts?.level,
    parentId: opts?.parentId,
  })
}

export function toggleFavorite(providerId: string) {
  return apiPost<FavoriteResponse>(`/api/providers/${providerId}/favorite`)
}

export function fetchFavorites() {
  return apiGet<ProviderCard[]>("/api/favorites")
}

export function fetchCep(cep: string) {
  return apiGet<CepResult>("/api/geo/cep", { cep })
}

/**
 * Forward-geocode a text address via Nominatim Search.
 *
 * @param q - Endereço textual ("Rua Augusta, São Paulo - SP")
 * @param limit - Máx. resultados (default 5, max 10)
 */
export function fetchGeoSearch(q: string, limit?: number) {
  return apiGet<GeoSearchResult[]>("/api/geo/search", { q, limit })
}

/**
 * Reverse geocoding result from `/api/geo/reverse`.
 */
export type ReverseGeoResult = {
  street?: string | null
  district?: string | null
  city?: string | null
  state?: string | null
  cep?: string | null
  displayName?: string | null
}

/**
 * Reverse-geocode lat/lng to an address via Nominatim Reverse.
 *
 * @param lat - Latitude
 * @param lng - Longitude
 */
export function fetchReverseGeo(lat: number, lng: number) {
  return apiGet<ReverseGeoResult>("/api/geo/reverse", { lat, lng })
}
