/**
 * Sentry Enhanced — breadcrumbs, context enrichment, performance monitoring
 *
 * Wraps the base captureError/captureMessage with additional context:
 * - User info from JWT
 * - Request metadata (URL, method, headers)
 * - Performance spans for DB queries
 */
import "server-only"
import logger from "./logger"

const isProd = process.env.NODE_ENV === "production"

let sentryModule: typeof import("@sentry/nextjs") | null | undefined = undefined

async function getSentry(): Promise<typeof import("@sentry/nextjs") | null> {
  if (sentryModule !== undefined) return sentryModule
  try {
    sentryModule = await import("@sentry/nextjs")
    return sentryModule
  } catch {
    sentryModule = null
    return null
  }
}

export interface SentryContext {
  /** Current user ID (from JWT) */
  userId?: string
  /** Current user role */
  userRole?: string
  /** Request URL */
  url?: string
  /** HTTP method */
  method?: string
  /** Additional tags */
  tags?: Record<string, string>
  /** Breadcrumb message */
  breadcrumb?: string
}

/**
 * Capture error with enriched context (user, request, tags).
 * Falls back gracefully if Sentry is unavailable.
 */
export async function captureErrorEnhanced(error: unknown, context?: SentryContext) {
  const message = error instanceof Error ? error.message : String(error)
  logger.error({ err: error, userId: context?.userId, url: context?.url }, message)

  if (!isProd) return
  const Sentry = await getSentry()
  if (!Sentry) return

  Sentry.withScope((scope) => {
    // User context
    if (context?.userId) {
      scope.setUser({ id: context.userId })
    }
    if (context?.userRole) {
      scope.setTag("userRole", context.userRole)
    }

    // Request context
    if (context?.url) scope.setTag("url", context.url)
    if (context?.method) scope.setTag("method", context.method)

    // Custom tags
    if (context?.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        scope.setTag(key, value)
      }
    }

    // Breadcrumb trail
    if (context?.breadcrumb) {
      scope.addBreadcrumb({
        category: "context",
        message: context.breadcrumb,
        level: "info",
      })
    }

    scope.setTag("source", "server")
    Sentry.captureException(error)
  })
}

/**
 * Add a breadcrumb for tracking user actions leading to errors.
 */
export async function addBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
) {
  const Sentry = await getSentry()
  if (!Sentry) return

  Sentry.addBreadcrumb({
    category,
    message,
    data,
    level: "info",
  })
}

/**
 * Create a performance span for tracking operation duration.
 * Returns a finish function that records the span.
 */
export async function startSpan(name: string, op: string): Promise<{ finish: () => void } | null> {
  const Sentry = await getSentry()
  if (!Sentry) return null

  // Sentry.startSpan callback returns the result; wrapping in Promise
  let spanResult: unknown = null
  try {
    Sentry.startSpan({ name, op }, (span: unknown) => {
      spanResult = span
    })
  } catch {
    // startSpan not available in this version
  }

  return {
    finish: () => {
      // Best-effort: if the span has end(), call it
      if (spanResult && typeof spanResult === "object" && "end" in spanResult) {
        ;(spanResult as { end: () => void }).end()
      }
    },
  }
}
