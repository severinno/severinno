/**
 * api-middleware.ts
 *
 * Middleware helpers that eliminate repetitive try/catch + ZodError + handleError
 * boilerplate across API route handlers.
 */

import { z } from "zod"

// ---------------------------------------------------------------------------
// Body parser
// ---------------------------------------------------------------------------

/**
 * Parse and validate a JSON request body with a Zod schema.
 *
 * On success, returns the inferred type.
 * On failure, throws a `ZodError` which the caller's catch block handles
 * as a 400 response.
 *
 * @param request  The Next.js Request object.
 * @param schema   A Zod schema to validate against.
 * @returns        The validated and typed data.
 *
 * @example
 * ```ts
 * export async function POST(request: Request) {
 *   try {
 *     const data = await parseBody(request, bookingSchema)
 *     const booking = await db.booking.create({ data })
 *     return NextResponse.json({ booking }, { status: 201 })
 *   } catch (e) {
 *     return handleError(e)
 *   }
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
 * On failure, throws a `ZodError` which the caller's catch block handles.
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
 *   try {
 *     const { searchParams } = new URL(request.url)
 *     const { q, limit } = parseSearchParams(schema, searchParams)
 *     const results = await geocodeSearch(q, limit)
 *     return NextResponse.json(results)
 *   } catch (e) {
 *     return handleError(e)
 *   }
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
