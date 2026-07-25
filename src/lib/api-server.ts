import { NextResponse } from "next/server"
import { ZodError } from "zod"
import { db } from "@/lib/db"
import { withCache, cacheInvalidate } from "@/lib/redis"
import logger from "./logger"

/**
 * Server-side helpers for API route handlers.
 * (Foundation `src/lib/api.ts` is a client-side typed fetch wrapper —
 * DO NOT import this file from client components; it touches `db`.)
 */

// ---------------------------------------------------------------------------
// Public-safe user shape — never expose passwordHash
// ---------------------------------------------------------------------------
export const USER_PUBLIC_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  cpfCnpj: true,
  whatsapp: true,
  phone: true,
  avatarUrl: true,
  bio: true,
  coverUrl: true,
  lat: true,
  lng: true,
  radiusKm: true,
  cep: true,
  street: true,
  number: true,
  complement: true,
  district: true,
  city: true,
  state: true,
  slug: true,
  verified: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const

export function publicUser<T extends { passwordHash?: string }>(
  user: T,
): Omit<T, "passwordHash"> {
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
export const notFound = (msg = "Recurso não encontrado") =>
  new HttpError(404, msg)
export const conflict = (msg = "Conflito de estado") => new HttpError(409, msg)

/**
 * Map any thrown error to a JSON response. Auth errors thrown by
 * `requireUser`/`requireRole` (`UNAUTHORIZED` / `FORBIDDEN` strings) are
 * mapped to 401/403. Zod errors → 400 with issue details.
 */
export function handleError(e: unknown) {
  if (e instanceof HttpError) {
    return NextResponse.json(
      { error: e.message },
      { status: e.status, headers: e.headers },
    )
  }
  if (e instanceof ZodError) {
    return NextResponse.json(
      { error: "Dados inválidos", details: e.issues },
      { status: 400 },
    )
  }
  if (e instanceof Error) {
    if (e.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }
    if (e.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Acesso proibido" }, { status: 403 })
    }
  }
  logger.error({ err: e }, "unhandled api error")
  return NextResponse.json(
    { error: "Erro interno do servidor" },
    { status: 500 },
  )
}

// ---------------------------------------------------------------------------
// Pagination helper — parse page/limit from URLSearchParams (1-indexed)
// ---------------------------------------------------------------------------
export function parsePagination(searchParams: URLSearchParams) {
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1)
  const limit = Math.min(
    50,
    Math.max(1, Number(searchParams.get("limit") ?? "20") || 20),
  )
  return { page, limit, skip: (page - 1) * limit, take: limit }
}

// ---------------------------------------------------------------------------
// Category tree — return all descendant ids (including the given one).
// Used by provider/service filters that need to match the whole sub-tree.
// Cached in Redis (10min TTL) since the category tree rarely changes.
// ---------------------------------------------------------------------------
export async function getCategoryDescendants(
  categoryId: string,
): Promise<string[]> {
  return withCache(
    `cat:desc:${categoryId}`,
    async () => {
      const all = await db.category.findMany({
        select: { id: true, parentId: true },
      })
      const childrenOf = new Map<string, string[]>()
      for (const c of all) {
        if (c.parentId) {
          const arr = childrenOf.get(c.parentId) ?? []
          arr.push(c.id)
          childrenOf.set(c.parentId, arr)
        }
      }
      const result: string[] = [categoryId]
      const queue = [categoryId]
      while (queue.length) {
        const current = queue.shift()!
        const children = childrenOf.get(current) ?? []
        for (const child of children) {
          result.push(child)
          queue.push(child)
        }
      }
      return result
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
// Cache-Control helpers — set public Cache-Control headers on responses
// ---------------------------------------------------------------------------

/**
 * Apply public Cache-Control headers to a NextResponse.
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
  response.headers.set(
    "Cache-Control",
    `public, max-age=${maxAge}, s-maxage=${swr}`,
  )
  return response
}

// ---------------------------------------------------------------------------
// Search reindex helpers — queue entities for the search-index consumer
// ---------------------------------------------------------------------------

/**
 * Queue a category for search reindexing.
 */
export async function syncCategorySearch(category: {
  id: string
}): Promise<void> {
  await db.$queryRawUnsafe(
    `INSERT INTO "search_reindex_queue" ("entityType", "entityId", action, "createdAt")
     VALUES ($1, $2, $3, NOW())`,
    "category",
    category.id,
    "upsert",
  )
}

/**
 * Queue a service for search reindexing.
 */
export async function syncServiceSearch(service: {
  id: string
}): Promise<void> {
  await db.$queryRawUnsafe(
    `INSERT INTO "search_reindex_queue" ("entityType", "entityId", action, "createdAt")
     VALUES ($1, $2, $3, NOW())`,
    "service",
    service.id,
    "upsert",
  )
}

/**
 * Queue a provider for search reindexing.
 */
export async function syncProviderSearch(provider: {
  id: string
  name: string | null
  bio: string | null
  city: string | null
  lat: number | null
  lng: number | null
}): Promise<void> {
  await db.$queryRawUnsafe(
    `INSERT INTO "search_reindex_queue" ("entityType", "entityId", action, "createdAt")
     VALUES ($1, $2, $3, NOW())`,
    "provider",
    provider.id,
    "upsert",
  )
}
