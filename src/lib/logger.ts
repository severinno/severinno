/**
 * Structured logger for the Severinno Marketplace.
 *
 * Uses pino (already installed). In development the output is piped through
 * pino-pretty for human-readable logs; in production it emits raw JSON so
 * log aggregators (GlitchTip / Datadog / Papertrail) can ingest it.
 *
 * Automatically includes request ID from AsyncLocalStorage when available.
 */

import pino from "pino"
import { getRequestId } from "./request-context"

const isProduction = process.env.NODE_ENV === "production"

/**
 * Custom pino mixin that adds request context to every log entry.
 * This runs on every log call and adds requestId if available.
 */
function requestContextMixin() {
  const requestId = getRequestId()
  if (requestId) {
    return { requestId }
  }
  return {}
}

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
  mixin: requestContextMixin,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }),
  redact: {
    paths: ["req.headers.cookie", "req.headers.authorization", "password", "passwordHash"],
    censor: "[REDACTED]",
  },
})

export default logger
