import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
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
  email: true,
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
  // Precisão da última fix do GPS (± m) — público: desenha o círculo de
  // incerteza no mapa do prestador (não é dado pessoal sensível).
  gpsAccuracyM: true,
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

// ---------------------------------------------------------------------------
// Credential/PII contract — allowlists for cross-user & anonymous responses
// ---------------------------------------------------------------------------

/**
 * Columns that must NEVER leave the server in a response body aimed at
 * another user (or at anonymous visitors).
 *
 * ⚠️ `passwordHash` is not the only credential: `twoFactorSecret` +
 * `twoFactorBackupCodes` allow account takeover, `identityDocUrl` /
 * `identitySelfieUrl` are KYC documents and `cpfCnpj`/`email`/full address are
 * personal data under the LGPD.
 *
 * Declared as DATA (not prose) so guard tests assert against the same list the
 * routes are built from — see `src/app/api/__tests__/response-pii-guard.test.ts`.
 * Spread-based "strip only passwordHash" serialization is the anti-pattern this
 * list exists to catch: it silently forwards every column the model gains later.
 */
export const SENSITIVE_USER_FIELDS = [
  "passwordHash",
  "twoFactorSecret",
  "twoFactorBackupCodes",
  "cpfCnpj",
  "email",
  "identityDocUrl",
  "identitySelfieUrl",
  "lytexRecipientId",
  "sessionVersion",
  "servicePolygon",
  "travelFeePolicy",
  "deletedAt",
] as const

/**
 * Public provider projection — the ONLY user shape allowed to describe a
 * provider to anonymous visitors or to another user.
 *
 * Consumers: `GET /api/providers/[id]` (public) and `GET /api/favorites`
 * (any CLIENT describing third parties).
 *
 * Deliberately present (needed by the UI): contact/service-area fields
 * (`whatsapp`, `cep`, `district`, `state`, `city`, `lat`/`lng`, `radiusKm`)
 * and the denormalized counters (`avgRating`, `reviewCount`, `favoriteCount`).
 * Deliberately absent: everything in `SENSITIVE_USER_FIELDS`.
 */
export const PUBLIC_PROVIDER_SELECT = {
  id: true,
  name: true,
  slug: true,
  role: true,
  avatarUrl: true,
  coverUrl: true,
  bio: true,
  verified: true,
  active: true,
  city: true,
  district: true,
  state: true,
  cep: true,
  whatsapp: true,
  lat: true,
  lng: true,
  radiusKm: true,
  gpsAccuracyM: true,
  avgRating: true,
  reviewCount: true,
  favoriteCount: true,
  createdAt: true,
  updatedAt: true,
} as const

export type PublicProviderField = keyof typeof PUBLIC_PROVIDER_SELECT

/**
 * Shape exato do payload público — derivado do PRÓPRIO select, então não pode
 * divergir dele. Substitui o antigo `Record<string, unknown>`, que apagava toda
 * a informação de tipo do corpo da resposta (e com ela a chance de o compilador
 * perceber um campo indevido).
 */
export type PublicProviderPayload = Prisma.UserGetPayload<{
  select: typeof PUBLIC_PROVIDER_SELECT
}>

/** Chaves permitidas no payload público — derivadas do select (fonte única). */
export const PUBLIC_PROVIDER_FIELDS = Object.keys(PUBLIC_PROVIDER_SELECT) as PublicProviderField[]

/**
 * Projeta QUALQUER linha com shape de User no payload público de provider.
 *
 * Duas barreiras com a MESMA allowlist, por motivos diferentes:
 *   1. `PUBLIC_PROVIDER_SELECT` na query — não busca colunas sensíveis (LGPD,
 *      performance, e o segredo do 2FA nunca chega perto do processo de resposta).
 *   2. `toPublicProvider()` na resposta — garante que a serialização não vaze
 *      coluna nenhuma, MESMO se alguém trocar `select` por `include` no futuro
 *      (o bug de 09/2026 foi exatamente esse: a segunda barreira não existia).
 */
export function toPublicProvider<T extends Record<string, unknown>>(row: T): PublicProviderPayload {
  const out: Record<string, unknown> = {}
  for (const field of PUBLIC_PROVIDER_FIELDS) {
    if (field in row) out[field] = row[field]
  }
  // Só chaves da allowlist entram no objeto — a projeção é exata por construção.
  return out as PublicProviderPayload
}

// ---------------------------------------------------------------------------
// Travas de compilação da allowlist pública
// ---------------------------------------------------------------------------

type SensitiveProviderKey = Extract<PublicProviderField, (typeof SENSITIVE_USER_FIELDS)[number]>

/**
 * 🔒 Trava de compilação: se alguém adicionar à allowlist pública uma chave
 * listada em SENSITIVE_USER_FIELDS (ex.: `email: true`), este tipo vira `never`
 * e o `true` não é atribuível — o `bun run typecheck` falha apontando aqui.
 *
 * É a garantia que um teste não dá: o teste roda, isto impede o merge.
 */
export const PUBLIC_PROVIDER_ALLOWLIST_HAS_NO_SENSITIVE_FIELD: [SensitiveProviderKey] extends [
  never,
]
  ? true
  : never = true

/**
 * Trava de FORMA EXATA para corpos de resposta.
 *
 * ⚠️ O TypeScript NÃO aplica excess property check em propriedades vindas de
 * spread: `const x: Narrow = { ...linhaInteira }` compila (verificado). Como a
 * serialização é sempre um objeto literal com spread, só restringir o tipo de
 * destino não protegia nada.
 *
 * Este helper transforma "chave extra" em erro de compilação inferindo `U` do
 * argumento e exigindo `never` para toda chave de `U` fora de `T`:
 *
 * ```ts
 * const body = exactShape<ProviderDetailBody>()({ ...toPublicProvider(row), rating })
 * //                                                      ✅
 * const body = exactShape<ProviderDetailBody>()({ ...row, rating })
 * //                                                      ❌ TS2345: cpfCnpj: string
 * //                                                          não é atribuível a never
 * ```
 *
 * Ou seja: reverter `select` para `include` e espalhar a linha larga deixa de
 * ser um bug silencioso e passa a não compilar.
 */
export function exactShape<T>() {
  return <U extends T>(value: U & Record<Exclude<keyof U, keyof T>, never>): U => value
}

/**
 * Own-session projection — the identity the client store expects
 * (`AuthUser` in `src/store/auth.ts`) after login/register/me. Never a
 * credential: no `passwordHash`, no `twoFactorSecret`, no `sessionVersion`.
 */
export const SESSION_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  active: true,
  avatarUrl: true,
  verified: true,
  twoFactorEnabled: true,
  identityStatus: true,
} as const

export type SessionUserResponse = {
  id: string
  name: string
  email: string
  role: string
  avatarUrl: string | null
  verified: boolean
  twoFactorEnabled: boolean
  identityStatus: string | null
}

/**
 * Project a user row onto the own-session shape. Explicit allowlist: a column
 * added to the query later can never leak through here by accident.
 */
export function toSessionUser(user: {
  id: string
  name: string
  email: string
  role: string
  avatarUrl?: string | null
  verified?: boolean | null
  twoFactorEnabled?: boolean | null
  identityStatus?: string | null
}): SessionUserResponse {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl ?? null,
    verified: user.verified ?? false,
    twoFactorEnabled: user.twoFactorEnabled ?? false,
    identityStatus: user.identityStatus ?? null,
  }
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
 * JSON error response carrying `Cache-Control: no-store`.
 *
 * House rule: error responses are NEVER cacheable. Sem header, caches
 * heuristically cache 404s (RFC 7234 §4.2.2) — "prestador não encontrado"
 * ficaria preso no CDN/browser depois de o cadastro existir. Aplicado em
 * TODAS as saídas do handleError; rotas com retornos inline de erro usam o
 * mesmo contrato.
 */
export function noStoreJson(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): NextResponse {
  const response = NextResponse.json(body, {
    status: init?.status ?? 500,
    headers: init?.headers,
  })
  response.headers.set("Cache-Control", "no-store")
  return response
}

/**
 * Map any thrown error to a JSON response. Domain errors (`AuthError`,
 * `BookingError`, `PaymentError`) and `HttpError` are mapped to their
 * respective status codes and messages. Zod errors → 400 with issue details.
 *
 * Every response carries `Cache-Control: no-store` (custom `HttpError`
 * headers like rate-limit `Retry-After` are preserved).
 */
export function handleError(e: unknown) {
  if (e instanceof HttpError) {
    return noStoreJson({ error: e.message }, { status: e.status, headers: e.headers })
  }
  // Duck-type domain errors instead of instanceof: route tests mock domain modules
  // without exporting class definitions, which breaks instanceof across isolated contexts.
  const domainErr = e as { name?: string; code?: string; status?: number }
  if (
    domainErr?.name === "AuthError" ||
    domainErr?.name === "BookingError" ||
    domainErr?.name === "PaymentError"
  ) {
    return noStoreJson(
      { error: e instanceof Error ? e.message : "", code: domainErr.code },
      { status: domainErr.status ?? 500 },
    )
  }
  if (e instanceof ZodError) {
    return noStoreJson({ error: "Dados inválidos", details: e.issues }, { status: 400 })
  }
  if (e instanceof Error) {
    if (e.message === "UNAUTHORIZED") {
      return noStoreJson({ error: "Não autorizado" }, { status: 401 })
    }
    if (e.message === "FORBIDDEN") {
      return noStoreJson({ error: "Acesso proibido" }, { status: 403 })
    }
  }
  logger.error({ err: e, requestId: getRequestId() }, "unhandled api error")
  return noStoreJson(
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
