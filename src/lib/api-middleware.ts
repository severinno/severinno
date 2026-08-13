/**
 * api-middleware.ts
 *
 * Middleware helpers that eliminate repetitive try/catch + ZodError + handleError
 * boilerplate across API route handlers.
 *
 * ## Motivation
 *
 * Every API route follows the same pattern:
 *
 * ```ts
 * export async function POST(request: Request) {
 *   try {
 *     await assertRateLimit(request, RATE_LIMITS.bookings)
 *     const session = await requireUser()
 *     const body = await request.json()
 *     const data = bookingSchema.parse(body)
 *     // business logic…
 *     return NextResponse.json({ booking })
 *   } catch (e) {
 *     return handleError(e)
 *   }
 * }
 * ```
 *
 * With `apiRoute` + `parseBody` this becomes:
 *
 * ```ts
 * export async function POST(request: Request) {
 *   return apiRoute(async () => {
 *     await assertRateLimit(request, RATE_LIMITS.bookings)
 *     const session = await requireUser()
 *     const data = await parseBody(request, bookingSchema)
 *     // business logic…
 *     return NextResponse.json({ booking })
 *   })
 * }
 * ```
 *
 * ## What it handles
 *
 * | Error type | Response |
 * |------------|----------|
 * | `HttpError` (badRequest, notFound, etc.) | JSON with `error` + status code |
 * | `ZodError` | 400 with `error: "Dados inválidos"` + `details` array |
 * | Auth errors (`UNAUTHORIZED` / `FORBIDDEN`) | 401 / 403 |
 * | Unknown errors | 500 + Sentry log |
 *
 * @example
 * ```ts
 * // GET handler with searchParams validation
 * export async function GET(request: Request) {
 *   return apiRoute(async () => {
 *     const { searchParams } = new URL(request.url)
 *     const { cep } = parseSearchParams(geocodeCepSchema, searchParams)
 *     const result = await geocodeCEP(cep)
 *     return cacheControlPublic(NextResponse.json(result), 60)
 *   })
 * }
 * ```
 */

import { NextResponse } from "next/server"
import { z } from "zod"
import { handleError } from "@/lib/api-server"

// ---------------------------------------------------------------------------
// Core wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap any API route handler with automatic try/catch + handleError.
 *
 * Inside the handler, throw `HttpError` (via `badRequest()`, `notFound()`,
 * etc.), `ZodError`, or any standard Error — they are all caught and mapped
 * to appropriate JSON error responses.
 *
 * @param handler  Async function that produces a NextResponse.
 * @returns        The handler's response on success, or an error JSON response.
 *
 * @example
 * ```ts
 * export async function GET(request: Request) {
 *   return apiRoute(async () => {
 *     const { searchParams } = new URL(request.url)
 *     const result = await db.service.findMany()
 *     return NextResponse.json(result)
 *   })
 * }
 * ```
 */
export async function apiRoute(handler: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await handler()
  } catch (e) {
    return handleError(e)
  }
}

// ---------------------------------------------------------------------------
// Body parser
// ---------------------------------------------------------------------------

/**
 * Parse and validate a JSON request body with a Zod schema.
 *
 * On success, returns the inferred type.
 * On failure, throws a `ZodError` which `apiRoute`'s catch block handles
 * automatically as a 400 response.
 *
 * @param request  The Next.js Request object.
 * @param schema   A Zod schema to validate against.
 * @returns        The validated and typed data.
 *
 * @example
 * ```ts
 * export async function POST(request: Request) {
 *   return apiRoute(async () => {
 *     const data = await parseBody(request, bookingSchema)
 *     const booking = await db.booking.create({ data })
 *     return NextResponse.json({ booking }, { status: 201 })
 *   })
 * }
 * ```
 */
export async function parseBody<T>(request: Request, schema: z.ZodSchema<T>): Promise<T> {
  const body = await request.json()
  return schema.parse(body)
}

// ---------------------------------------------------------------------------
// Search params parser
// ---------------------------------------------------------------------------

/**
 * Validate URLSearchParams against a Zod schema.
 *
 * Each field in `schema` is expected to match a search param name. Supports
 * Zod's `.optional()` and `.default()` for params that may be absent.
 *
 * On failure, throws a `ZodError` which `apiRoute`'s catch block handles.
 *
 * @param schema        A Zod object schema.
 * @param searchParams  The URLSearchParams from `new URL(request.url)`.
 * @returns             The validated and typed data.
 *
 * @example
 * ```ts
 * const schema = z.object({
 *   q: z.string().min(3).max(200),
 *   limit: z.coerce.number().int().min(1).max(10).default(5),
 * })
 *
 * export async function GET(request: Request) {
 *   return apiRoute(async () => {
 *     const { searchParams } = new URL(request.url)
 *     const { q, limit } = parseSearchParams(schema, searchParams)
 *     const results = await geocodeSearch(q, limit)
 *     return NextResponse.json(results)
 *   })
 * }
 * ```
 */
export function parseSearchParams<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  searchParams: URLSearchParams,
): z.infer<z.ZodObject<T>> {
  // Convert URLSearchParams to a plain object, collecting multi-values as arrays
  const raw: Record<string, string> = {}
  for (const key of Object.keys(schema.shape)) {
    const val = searchParams.get(key)
    if (val !== null) raw[key] = val
  }
  return schema.parse(raw)
}
