import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { db } from "@/lib/db"
import { withCache, cacheInvalidate } from "@/lib/redis"
import logger from "./logger"
import { getRequestId } from "./request-context"

/**
 * Server-side helpers for API route handlers.
 * (Foundation `src/lib/api.ts` is a client-side typed fetch wrapper —
 * DO NOT import this file from client components; it touches `db`.)
 */

// ---------------------------------------------------------------------------
// Public-safe user shape — never expose passwordHash
// ---------------------------------------------------------------------------

/** Minimal user select — for public listings where only identity is needed. */
export const USER_MINIMAL_SELECT = {
  id: true,
  name: true,
  avatarUrl: true,
  role: true,
} as const

/** Public user select — for profile views (no PII like CPF/CNPJ or full address). */
export const USER_PUBLIC_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  whatsapp: true,
  phone: true,
  avatarUrl: true,
  bio: true,
  coverUrl: true,
  lat: true,
  lng: true,
  radiusKm: true,
  cep: true,
  slug: true,
  verified: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const

/** Full user select — for the user's own profile (includes all fields). */
export const USER_FULL_SELECT = {
  ...USER_PUBLIC_SELECT,
  cpfCnpj: true,
  street: true,
  number: true,
  complement: true,
  district: true,
  city: true,
  state: true,
} as const

export function publicUser<T extends { passwordHash?: string }>(user: T): Omit<T, "passwordHash"> {
  const { passwordHash: _ignored, ...rest } = user
  return rest
}

// ---------------------------------------------------------------------------
// Error helpers — throw these inside handlers; `handleError` maps them to JSON
// ---------------------------------------------------------------------------
export class HttpError extends Error {
  status: number
  /** Optional custom response headers (e.g. RateLimit headers). */
  headers?: Record<string, string>
  constructor(status: number, message: string, headers?: Record<string, string>) {
    super(message)
    this.status = status
    this.headers = headers
  }
}
export const badRequest = (msg = "Requisição inválida") => new HttpError(400, msg)
export const unauthorized = (msg = "Não autorizado") => new HttpError(401, msg)
export const forbidden = (msg = "Acesso proibido") => new HttpError(403, msg)
export const notFound = (msg = "Recurso não encontrado") => new HttpError(404, msg)
export const conflict = (msg = "Conflito de estado") => new HttpError(409, msg)

/**
 * Map any thrown error to a JSON response. Domain errors (`AuthError`,
 * `BookingError`, `PaymentError`) and `HttpError` are mapped to their
 * respective status codes and messages. Zod errors → 400 with issue details.
 */
export function handleError(e: unknown) {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message }, { status: e.status, headers: e.headers })
  }
  // Duck-type domain errors instead of instanceof: route tests mock domain modules
  // without exporting class definitions, which breaks instanceof across isolated contexts.
  const domainErr = e as { name?: string; code?: string; status?: number }
  if (
    domainErr?.name === "AuthError" ||
    domainErr?.name === "BookingError" ||
    domainErr?.name === "PaymentError"
  ) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "", code: domainErr.code },
      { status: domainErr.status ?? 500 },
    )
  }
  if (e instanceof ZodError) {
    return NextResponse.json({ error: "Dados inválidos", details: e.issues }, { status: 400 })
  }
  if (e instanceof Error) {
    if (e.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }
    if (e.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Acesso proibido" }, { status: 403 })
    }
  }
  logger.error({ err: e, requestId: getRequestId() }, "unhandled api error")
  return NextResponse.json(
    { error: "Erro interno do servidor", requestId: getRequestId() },
    { status: 500 },
  )
}

// ---------------------------------------------------------------------------
// Pagination helper — parse page/limit from URLSearchParams (1-indexed)
// ---------------------------------------------------------------------------
export function parsePagination(searchParams: URLSearchParams) {
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1)
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? "20") || 20))
  return { page, limit, skip: (page - 1) * limit, take: limit }
}

// ---------------------------------------------------------------------------
// Category tree — return all descendant ids (including the given one).
// Used by provider/service filters that need to match the whole sub-tree.
// Cached in Redis (10min TTL) since the category tree rarely changes.
// ---------------------------------------------------------------------------
export async function getCategoryDescendants(categoryId: string): Promise<string[]> {
  return withCache(
    `cat:desc:${categoryId}`,
    async () => {
      // Recursive CTE — single query instead of loading all categories into memory
      const rows = await db.$queryRawUnsafe<{ id: string }[]>(
        `WITH RECURSIVE tree AS (
           SELECT id FROM "Category" WHERE id = $1
           UNION ALL
           SELECT c.id FROM "Category" c JOIN tree t ON c."parentId" = t.id
         ) SELECT id FROM tree`,
        categoryId,
      )
      return rows.map((r) => r.id)
    },
    600, // 10 min
  )
}

/**
 * Invalidate category descendant cache (call after category CRUD).
 */
export async function invalidateCategoryCache(): Promise<void> {
  await cacheInvalidate("cat:desc:*")
}

// ---------------------------------------------------------------------------
// Cache-Control helpers � set public Cache-Control headers on responses
// ---------------------------------------------------------------------------

/**
 * Apply public Cache-Control + Vary headers to a NextResponse.
 *
 * Sets:
 *   Cache-Control: public, max-age={maxAge}, s-maxage={swr}
 *   Vary: Accept-Encoding, Accept
 *
 * The Vary header tells CDNs/proxies to cache separate copies based on:
 *   Accept-Encoding — compressed (gzip) vs uncompressed responses
 *   Accept          — JSON vs potential future content-type variants
 *
 * Without Vary, a CDN may serve a gzip-compressed response to a client
 * that doesn't support it, or serve a JSON response to a client expecting
 * HTML (shouldn't happen for this API, but is a safety net).
 *
 * @param response  The response to modify.
 * @param maxAge    Max age in seconds (e.g. 30, 60, 120).
 * @param staleWhileRevalidate  Stale-while-revalidate in seconds (defaults to maxAge).
 */
export function cacheControlPublic(
  response: NextResponse,
  maxAge: number,
  staleWhileRevalidate?: number,
): NextResponse {
  const swr = staleWhileRevalidate ?? maxAge
  response.headers.set("Cache-Control", `public, max-age=${maxAge}, s-maxage=${swr}`)
  // Set Vary to prevent CDN cache collisions for encoding, format, and origin variants
  response.headers.set("Vary", "Accept-Encoding, Accept, Origin")
  return response
}

/**
 * Apply private Cache-Control + Vary headers to a NextResponse.
 *
 * Use for routes that contain user-personalized data (e.g. `favorited`
 * flags, user-specific recommendations). Private cache ensures the
 * response is stored in the browser only, never in shared CDN caches.
 *
 * Sets:
 *   Cache-Control: private, max-age={maxAge}
 *   Vary: Cookie, Accept-Encoding, Accept
 *
 * The `Vary: Cookie` header ensures that different users (with different
 * session cookies) get their own cached copy in the browser.
 *
 * NOTE: With `private` cache, `s-maxage` is intentionally omitted because
 * shared/proxy caches (CDNs) must NOT store private responses.
 *
 * @param response  The response to modify.
 * @param maxAge    Max age in seconds (e.g. 30, 60, 120).
 */
export function cacheControlPrivate(response: NextResponse, maxAge: number): NextResponse {
  response.headers.set("Cache-Control", `private, max-age=${maxAge}`)
  // Vary on Cookie separates cache per user session. Accept-Encoding and
  // Accept are inherited from the public variant for encoding/format safety.
  response.headers.set("Vary", "Cookie, Accept-Encoding, Accept")
  return response
}

// ---------------------------------------------------------------------------
// Search reindex helpers � queue entities for the search-index consumer
// ---------------------------------------------------------------------------

/**
 * Queue an entity for search reindexing.
 */
export async function syncEntitySearch(
  entityType: "category" | "service" | "provider",
  entity: { id: string },
): Promise<void> {
  await db.$queryRawUnsafe(
    `INSERT INTO "search_reindex_queue" ("entityType", "entityId", action, "createdAt")
     VALUES ($1, $2, $3, NOW())`,
    entityType,
    entity.id,
    "upsert",
  )
}
