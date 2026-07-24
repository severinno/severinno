/**
 * Structured logger for the Severinno Marketplace.
 *
 * Uses pino (already installed). In development the output is piped through
 * pino-pretty for human-readable logs; in production it emits raw JSON so
 * log aggregators (GlitchTip / Datadog / Papertrail) can ingest it.
 */

import pino from "pino"

const isProduction = process.env.NODE_ENV === "production"

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? "info" : "debug"),
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
