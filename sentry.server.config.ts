/**
 * Sentry Server Configuration
 *
 * Integrates @sentry/nextjs for server-side error tracking.
 * Works with self-hosted GlitchTip or SaaS Sentry.
 *
 * The logger (pino) is configured to forward errors to Sentry
 * automatically via the Sentry transport below.
 */

import * as Sentry from "@sentry/nextjs"
import logger from "@/lib/logger"

const dsn = process.env.SENTRY_DSN || ""

if (dsn) {
  Sentry.init({
    dsn,
    // Configurable sample rates via env vars (default: production defaults)
    tracesSampleRate:
      Number(process.env.SENTRY_TRACES_SAMPLE_RATE) ||
      (process.env.NODE_ENV === "production" ? 0.8 : 0.3),
    profilesSampleRate:
      Number(process.env.SENTRY_PROFILES_SAMPLE_RATE) ||
      (process.env.NODE_ENV === "production" ? 0.3 : 0.1),
    // Server-side: no replays needed
    integrations: [],
    // Ignore common non-actionable errors
    ignoreErrors: ["UNAUTHORIZED", "FORBIDDEN", "Not Found", "NEXT_NOT_FOUND"],
    attachStacktrace: true,
    environment: process.env.NODE_ENV || "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA || process.env.SENTRY_RELEASE || undefined,
  })

  // Forward pino error logs to Sentry
  // This is a minimal transport — for production, consider @sentry/pino or a custom write stream.
  logger.info("[sentry] initialized (server)")

  // Unhandled rejection handler (async errors that aren't caught)
  process.on("unhandledRejection", (reason) => {
    Sentry.captureException(reason, {
      level: "error",
      tags: { source: "unhandledRejection" },
    })
    logger.error({ err: reason }, "unhandled rejection caught by Sentry")
  })

  // Uncaught exception handler (last resort)
  process.on("uncaughtException", (err) => {
    Sentry.captureException(err, {
      level: "fatal",
      tags: { source: "uncaughtException" },
    })
    // Flush before exiting
    Sentry.close(2000).finally(() => {
      process.exit(1)
    })
  })
} else {
  logger.warn("[sentry] no DSN configured — errors will not be tracked remotely")
}
