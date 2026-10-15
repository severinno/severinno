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

interface DsnConfig {
  key: string
  storeUrl: string
}

let cachedDsnConfig: DsnConfig | null | undefined = undefined

function getDsnConfig(): DsnConfig | null {
  if (cachedDsnConfig !== undefined) return cachedDsnConfig
  const dsn = process.env.SENTRY_DSN || process.env.GLITCHTIP_DSN
  if (!dsn) {
    cachedDsnConfig = null
    return null
  }
  try {
    const url = new URL(dsn)
    const key = url.username
    const projectId = url.pathname.replace(/^\/+/, "")
    if (!key || !projectId) {
      cachedDsnConfig = null
      return null
    }
    const storeUrl = `${url.protocol}//${url.host}/api/${projectId}/store/`
    cachedDsnConfig = { key, storeUrl }
    return cachedDsnConfig
  } catch {
    cachedDsnConfig = null
    return null
  }
}

async function sendDirectToStore(payload: Record<string, unknown>): Promise<void> {
  const dsn = getDsnConfig()
  if (!dsn) return
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    await fetch(dsn.storeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=severinno-store/1.0, sentry_key=${dsn.key}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))
  } catch (err) {
    logger.debug({ err }, "Direct Sentry/GlitchTip delivery failed")
  }
}

export async function captureError(error: unknown, context?: Record<string, unknown>) {
  const message = error instanceof Error ? error.message : String(error)
  logger.error({ err: error, ...context }, message)

  const Sentry = await getSentry()
  if (Sentry) {
    Sentry.withScope((scope) => {
      if (context) scope.setExtras(context)
      scope.setTag("source", "server")
      scope.setTag("environment", isProd ? "production" : "development")
      Sentry.captureException(error)
    })
    return
  }

  // Resilient direct fallback: delivers directly to GlitchTip/Sentry store API
  const isErrInstance = error instanceof Error
  const errType = isErrInstance ? error.name || "Error" : "Error"
  const errStack = isErrInstance && error.stack ? error.stack : undefined

  await sendDirectToStore({
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: new Date().toISOString(),
    platform: "node",
    level: "error",
    logger: "server",
    exception: {
      values: [
        {
          type: errType,
          value: message,
          stacktrace: errStack
            ? {
                frames: [
                  {
                    filename: "server",
                    function: "captureError",
                    lineno: 1,
                  },
                ],
              }
            : undefined,
        },
      ],
    },
    tags: {
      source: "server",
      environment: isProd ? "production" : "development",
    },
    extra: context,
  })
}

export async function captureMessage(
  message: string,
  severity: Severity = "info",
  context?: Record<string, unknown>,
) {
  logger[severity](context ?? {}, message)

  const Sentry = await getSentry()
  if (Sentry) {
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
    return
  }

  // Resilient direct fallback: delivers directly to GlitchTip/Sentry store API
  await sendDirectToStore({
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: new Date().toISOString(),
    platform: "node",
    level: severity === "fatal" ? "fatal" : severity === "warn" ? "warning" : severity,
    logger: "server",
    message,
    tags: {
      source: "server",
      environment: isProd ? "production" : "development",
    },
    extra: context,
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
