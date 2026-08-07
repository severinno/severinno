/**
 * Sentry Client Configuration
 *
 * Integrates @sentry/nextjs for client-side error tracking.
 * Uses the provided DSN from environment variables.
 * In development, errors are only logged locally; in production,
 * they are sent to Sentry / self-hosted GlitchTip.
 *
 * The DSN is configured via:
 *   NEXT_PUBLIC_SENTRY_DSN (client-side — public by design)
 *   SENTRY_DSN             (server-side, set in Docker/.env)
 *
 * Note: withSentryConfig is NOT needed for GlitchTip.
 * The SDK sends events directly via the configured DSN.
 */

import * as Sentry from "@sentry/nextjs"

const dsn =
  process.env.NEXT_PUBLIC_SENTRY_DSN ||
  process.env.SENTRY_DSN ||
  ""

if (dsn) {
  Sentry.init({
    dsn,
    // 15% of transactions in prod to save quota; 20% in dev
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.15 : 0.2,
    // Profile sampling — stack traces for performance hotspots (20% of traced transactions)
    profilesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 0.1,
    // Replays for debugging user sessions (10% sampled)
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    // Tunnel: bypass ad-blockers by routing Sentry envelopes through our own domain.
    // The server-side handler at /api/sentry forwards them to the internal GlitchTip.
    tunnel: "/api/sentry",
    // Ignore common non-actionable errors
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      "NetworkError when attempting to fetch resource",
      "Failed to fetch",
      "Cancelled",
      "AbortError",
    ],
    // Integrate with pino logger for structured logging
    attachStacktrace: true,
    environment: process.env.NODE_ENV || "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA || process.env.SENTRY_RELEASE || undefined,
  })

  console.log("[sentry] initialized (client)")
} else {
  console.warn("[sentry] no DSN configured — errors will not be tracked remotely")
}
