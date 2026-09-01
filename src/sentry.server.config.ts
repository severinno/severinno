import * as Sentry from "@sentry/nextjs"

const dsn = process.env.GLITCHTIP_DSN || process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.5,
    integrations: [
      Sentry.prismaIntegration(),
    ],

    // ── Error filtering (server-side) ────────────────────────────────────────
    beforeSend(event) {
      const msg = event.message?.formatted ?? ""
      const exc = event.exception?.values?.[0]?.value ?? ""
      const combined = `${msg} ${exc}`

      // Ignore Next.js internal hydration and redirect errors
      if (combined.includes("NEXT_REDIRECT")) return null
      if (combined.includes("NEXT_NOT_FOUND")) return null
      // Ignore connection refused to external services (Redis, etc.) during startup
      if (combined.includes("ECONNREFUSED")) return null
      return event
    },

    // ── Request context ─────────────────────────────────────────────────────
    initialScope(scope) {
      scope.setTag("runtime", "nodejs")
      scope.setTag("app", "severinno-server")
      return scope
    },
  })
}
