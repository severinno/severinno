import "server-only"
import logger from "./logger"

type Severity = "info" | "warn" | "error" | "fatal"

const isProd = process.env.NODE_ENV === "production"

// Cache for the lazy-loaded Sentry module to avoid repeated dynamic imports.
let sentryModule: typeof import("@sentry/nextjs") | null | undefined = undefined

/**
 * Lazy-load Sentry using dynamic import (ESM-safe).
 *
 * Unlike require(), import() is asynchronous and won't crash the module if
 * the Sentry package is missing or corrupted — the error is caught gracefully.
 *
 * The result is cached after the first successful load for subsequent calls.
 */
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

export async function captureError(error: unknown, context?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error)
  logger.error({ err: error, ...context }, message)

  // In dev: log locally and still send to GlitchTip so errors are visible
  const Sentry = await getSentry()
  if (!Sentry) return

  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context)
    scope.setTag("source", "server")
    scope.setTag("environment", isProd ? "production" : "development")
    Sentry.captureException(error)
  })
}

export async function captureMessage(
  message: string,
  severity: Severity = "info",
  context?: Record<string, unknown>,
) {
  logger[severity](context ?? {}, message)

  const Sentry = await getSentry()
  if (!Sentry) return

  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context)
    scope.setTag("environment", isProd ? "production" : "development")
    Sentry.captureMessage(
      message,
      severity === "fatal"
        ? "fatal"
        : severity === "error"
          ? "error"
          : severity === "warn"
            ? "warning"
            : "log",
    )
  })
}

export async function flushSentry(timeoutMs = 2000) {
  const Sentry = await getSentry()
  if (!Sentry) return

  try {
    await Sentry.close(timeoutMs)
  } catch {
    // skip
  }
}
