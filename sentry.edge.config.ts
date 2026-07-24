/**
 * Sentry Edge Runtime Configuration
 *
 * Lightweight integration for the Next.js Edge Middleware.
 * Edge Runtime has limited API surface — uses captureException only.
 */

import * as Sentry from "@sentry/nextjs"

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || ""

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.NODE_ENV || "development",
  })
}
