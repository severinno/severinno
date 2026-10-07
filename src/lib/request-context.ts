/**
 * request-context.ts
 *
 * Request context using Node.js AsyncLocalStorage to propagate
 * request-scoped data (request ID, user ID, etc.) across async calls.
 *
 * This allows any code in the request lifecycle to access the current
 * request ID without explicit parameter passing.
 *
 * Usage:
 *   import { getRequestId, RequestContext } from "@/lib/request-context"
 *
 *   // In middleware or route handler:
 *   const requestId = getRequestId() // returns current request ID or null
 *
 *   // In logger:
 *   logger.info({ requestId: getRequestId() }, "operation completed")
 */

import { AsyncLocalStorage } from "async_hooks"
import { headers } from "next/headers"

export interface RequestContextData {
  /** Unique request ID (UUID v4) */
  requestId: string
  /** User ID if authenticated */
  userId?: string
  /** User role if authenticated */
  userRole?: string
  /** Request start time for duration calculation */
  startTime: number
  /** HTTP method */
  method?: string
  /** Request path */
  path?: string
}

/**
 * AsyncLocalStorage instance for request context.
 * Each request gets its own isolated context.
 */
export const requestContext = new AsyncLocalStorage<RequestContextData>()

/**
 * Get the current request context.
 * Returns undefined if called outside of a request context.
 */
export function getRequestContext(): RequestContextData | undefined {
  return requestContext.getStore()
}

/**
 * Get the current request ID.
 * Returns null if called outside of a request context.
 */
export function getRequestId(): string | null {
  return getRequestContext()?.requestId ?? null
}

/**
 * Get the current user ID from request context.
 * Returns null if called outside of a request context or if user is not authenticated.
 */
export function getRequestUserId(): string | null {
  return getRequestContext()?.userId ?? null
}

/**
 * Run a function within a request context.
 * Used by middleware to establish context for the request lifecycle.
 *
 * @param context - The request context data
 * @param fn - The function to run within the context
 * @returns The function result
 */
export function runWithContext<T>(context: RequestContextData, fn: () => T): T {
  return requestContext.run(context, fn)
}

/**
 * Establish request context from Next.js headers.
 * Call this at the start of route handlers to enable request-scoped logging.
 *
 * `headers()` lança fora de um request scope do Next (testes unitários, cron,
 * jobs em background). O contexto é best-effort: sem headers disponíveis,
 * segue com um requestId gerado para não quebrar o chamador.
 *
 * @returns The request ID from the x-request-id header
 */
export async function establishRequestContext(): Promise<string> {
  let hdrs: Headers
  try {
    hdrs = await headers()
  } catch {
    // Fora de request scope — contexto mínimo com requestId sintético.
    const requestId = generateRequestId()
    requestContext.enterWith({ requestId, startTime: Date.now() })
    return requestId
  }
  const requestId = hdrs.get("x-request-id") || generateRequestId()
  const userId = hdrs.get("x-user-id") || undefined
  const userRole = hdrs.get("x-user-role") || undefined

  const context: RequestContextData = {
    requestId,
    userId,
    userRole,
    startTime: Date.now(),
    method: hdrs.get("x-forwarded-method") || undefined,
    path: hdrs.get("x-forwarded-path") || undefined,
  }

  requestContext.enterWith(context)
  return requestId
}

/**
 * Generate a unique request ID (UUID v4 format).
 * Uses crypto.randomUUID() for cryptographically secure IDs.
 */
export function generateRequestId(): string {
  return crypto.randomUUID()
}
