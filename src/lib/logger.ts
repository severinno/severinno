/**
 * Logger for the Severinno Marketplace.
 *
 * Uses pino in production, pino-pretty in development.
 * Singleton — import once and reuse across the app.
 */

import pino from "pino"

const isDev = process.env.NODE_ENV !== "production"

const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
})

export default logger
