/**
 * Typed fetch wrapper for the Severinno Marketplace SPA.
 *
 * All requests use RELATIVE paths (e.g. "/api/providers") so the same code
 * works under the Caddy gateway, in dev, and in production. The session is
 * sent automatically via `credentials: "include"` (cookie `severinno_session`).
 *
 * Helper functions throw on !ok and return the parsed JSON body.
 */

import { getCsrfTokenFromCookie, CSRF_HEADER } from "@/lib/csrf"

// ---------------------------------------------------------------------------
// Shared API types — mirrored from the API contract in worklog.md
// ---------------------------------------------------------------------------

export type ServiceUnit = "UNIDADE" | "METRO_LINEAR" | "METRO_QUADRADO" | "METRO_CUBICO"

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
  radiusKm?: number | null
  lat?: number | null
  lng?: number | null
  services: ProviderService[]
  completedBookings?: number
  memberSince?: string
  matchScore?: number | null
  matchReasons?: string[] | null
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
  /** Precisão da última fix do GPS do prestador (± m) — círculo de incerteza. */
  gpsAccuracyM?: number | null
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
// Core fetch wrapper with timeout + retry
// ---------------------------------------------------------------------------

/** Default request timeout (15 seconds). */
const DEFAULT_TIMEOUT_MS = 15_000

/** Maximum retry attempts for network errors (status 0). */
const MAX_RETRIES = 2

/**
 * Calculate jittered backoff delay.
 * Returns a random value between base and base*1.5 to avoid thundering herd.
 */
function backoffDelay(attempt: number): number {
  const base = Math.min(500 * Math.pow(2, attempt - 1), 4000)
  return base + Math.random() * base * 0.5
}

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
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const url = method === "GET" ? buildUrl(path, params) : path
  const init: RequestInit = {
    method,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      // CSRF: attach token from cookie for mutations (POST/PUT/PATCH/DELETE)
      ...(method !== "GET" ? { [CSRF_HEADER]: getCsrfTokenFromCookie() ?? "" } : {}),
      ...extraHeaders,
    },
    cache: "no-store", // dynamic data; public endpoints use per-route caching via apiGet calls
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }

  let lastError: ApiError | null = null

  for (let attempt = 1; attempt <= 1 + MAX_RETRIES; attempt++) {
    // Create an abort signal with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
    init.signal = controller.signal

    let res: Response
    try {
      res = await fetch(url, init)
    } catch (e) {
      clearTimeout(timeoutId)

      // Network errors (status 0) are retryable
      if (attempt <= MAX_RETRIES) {
        const delay = backoffDelay(attempt)
        await new Promise((resolve) => setTimeout(resolve, delay))
        lastError = {
          status: 0,
          message:
            e instanceof DOMException && e.name === "AbortError"
              ? "A requisição excedeu o tempo limite. Verifique sua conexão."
              : "Erro de rede. Verifique sua conexão e tente novamente.",
          data: e,
        }
        continue
      }

      throw (
        lastError ?? {
          status: 0,
          message: "Erro de rede. Verifique sua conexão e tente novamente.",
          data: e,
        }
      )
    }
    clearTimeout(timeoutId)

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

  // Should never reach here — either return or throw inside the loop
  throw lastError ?? { status: 0, message: "Falha inesperada na requisição." }
}

export function apiGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  return request<T>("GET", path, params)
}

/** Opções extras mutáveis: headers adicionais (ex. Idempotency-Key). */
export type ApiPostOptions = {
  headers?: Record<string, string>
}

export function apiPost<T>(path: string, body?: unknown, options?: ApiPostOptions): Promise<T> {
  return request<T>("POST", path, undefined, body, options?.headers)
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>("PATCH", path, undefined, body)
}

// ---------------------------------------------------------------------------
// Payment — contrato do POST /api/bookings/[id]/pay
// ---------------------------------------------------------------------------

/**
 * Gera uma chave de idempotência no formato aceito pelo servidor
 * (`^[A-Za-z0-9_-]{8,128}$`). Use UMA chave por INTENÇÃO de pagamento: guarde
 * o valor (ref/state) e reenvie-o nos retries da mesma tentativa — o servidor
 * responde replay/409 em vez de criar uma segunda cobrança no Lytex.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `pay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Resposta do POST /api/bookings/[id]/pay (PIX e/ou cartão). */
export type PayResponse = {
  paymentMethod: string
  status: string
  lytexStatus?: string
  // PIX
  qrCode?: string
  qrCodeImage?: string | null
  lytexId?: string
  expiresAt?: string
  // Cartão
  cardLastDigits?: string
  cardBrand?: string
  installments?: number
  transactionId?: string
  message?: string
}

export type PayBookingOptions = {
  /**
   * Chave de idempotência da tentativa. Obrigatória na prática: sem ela o
   * helper gera uma NOVA a cada chamada — o que mata a proteção em retries.
   * Gere uma vez com newIdempotencyKey() e reenvie a mesma nos retries.
   */
  idempotencyKey?: string
}

/**
 * POST /api/bookings/[id]/pay — SEMPRE envia `Idempotency-Key`, para PIX e
 * cartão. Ponto único do contrato de idempotência de pagamento: novos
 * chamadores (ex. um futuro card-checkout) não conseguem esquecer o header.
 */
export function payBooking<T = PayResponse>(
  bookingId: string,
  body?: unknown,
  options?: PayBookingOptions,
): Promise<T> {
  return request<T>("POST", `/api/bookings/${bookingId}/pay`, undefined, body, {
    "Idempotency-Key": options?.idempotencyKey ?? newIdempotencyKey(),
  })
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
  page?: number
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
    page: query.page,
    verified: query.verified,
    minRating: query.minRating,
  })
}

export function fetchProviderDetail(id: string, opts?: { lat?: number; lng?: number }) {
  return apiGet<ProviderDetail>(`/api/providers/${id}`, {
    ...(opts?.lat !== undefined ? { lat: opts.lat } : {}),
    ...(opts?.lng !== undefined ? { lng: opts.lng } : {}),
  })
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
 * Structured search via Nominatim — use when you have separate address fields.
 *
 * Parâmetros (todos opcionais, mas ao menos um deve ser informado):
 * @param street  - Logradouro, ex.: "Av. Paulista, 1000"
 * @param city    - Cidade, ex.: "São Paulo"
 * @param state   - Estado (sigla ou nome), ex.: "SP"
 * @param country - País (default "Brazil")
 * @param postcode- CEP, ex.: "01310100"
 * @param limit   - Máx. resultados (default 5, max 10)
 */
export function fetchGeoSearchStructured(opts: {
  street?: string
  city?: string
  state?: string
  country?: string
  postcode?: string
  limit?: number
}) {
  return apiGet<GeoSearchResult[]>("/api/geo/search", opts)
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

export type RegionDemandResponse = {
  total: number
  bookings: number
  quotes: number
  providerLat: number | null
  providerLng: number | null
  radiusKm: number | null
  regionConfigured: boolean
}

export function fetchRegionDemand() {
  return apiGet<RegionDemandResponse>("/api/provider/region-demand")
}
