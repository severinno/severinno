import "server-only"
import logger from "./logger"

type Severity = "info" | "warn" | "error" | "fatal"

const isProd = process.env.NODE_ENV === "production"

/**
 * Lazy-load Sentry to avoid crashing when the DSN is not configured
 * (e.g. local dev without GlitchTip running).
 */
function getSentry() {
  try {
    return require("@sentry/nextjs") // eslint-disable-line @typescript-eslint/no-require-imports
  } catch {
    return null
  }
}

export function captureError(error: unknown, context?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error)
  logger.error({ err: error, ...context }, message)

  if (!isProd) return
  const Sentry = getSentry()
  if (!Sentry) return

  Sentry.withScope((scope: { setExtras: (ctx: Record<string, unknown> | undefined) => void; setTag: (key: string, value: string) => void }) => {
    if (context) scope.setExtras(context)
    scope.setTag("source", "server")
    Sentry.captureException(error)
  })
}

export function captureMessage(message: string, severity: Severity = "info", context?: Record<string, unknown>) {
  logger[severity](context ?? {}, message)

  if (!isProd) return
  const Sentry = getSentry()
  if (!Sentry) return

  Sentry.withScope((scope: { setExtras: (ctx: Record<string, unknown> | undefined) => void }) => {
    if (context) scope.setExtras(context)
    Sentry.captureMessage(message, severity === "fatal" ? "fatal" : severity === "error" ? "error" : severity === "warn" ? "warning" : "log")
  })
}

export async function flushSentry(timeoutMs = 2000) {
  if (!isProd) return
  const Sentry = getSentry()
  if (!Sentry) return

  try {
    await Sentry.close(timeoutMs)
  } catch {
    // skip
  }
}
