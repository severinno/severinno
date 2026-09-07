import * as Sentry from "@sentry/nextjs"

const dsn = process.env.NEXT_PUBLIC_GLITCHTIP_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.5,

    // ── Error filtering ──────────────────────────────────────────────────────
    // Ignore common noise: ResizeObserver, hydration, abandoned fetches
    beforeSend(event) {
      const rawMsg = event.message
      const msg =
        typeof rawMsg === "string"
          ? rawMsg
          : rawMsg && typeof rawMsg === "object" && "formatted" in rawMsg
            ? String((rawMsg as { formatted: unknown }).formatted)
            : ""
      const exc = event.exception?.values?.[0]?.value ?? ""
      const combined = `${msg} ${exc}`

      // Ignore ResizeObserver loop errors (browser-level, not actionable)
      if (combined.includes("ResizeObserver")) return null
      // Ignore hydration mismatch (Next.js hydration)
      if (combined.includes("Hydration")) return null
      // Ignore aborted fetches (user navigated away)
      if (combined.includes("AbortError") || combined.includes("aborted")) return null
      // Ignore network errors when offline
      if (combined.includes("NetworkError") || combined.includes("Failed to fetch")) {
        if (typeof navigator !== "undefined" && !navigator.onLine) return null
      }
      return event
    },

    // ── User context ─────────────────────────────────────────────────────────
    // Set user info from auth store when available
    initialScope(scope) {
      try {
        // Dynamic import to avoid circular deps at init time (ESM-safe, no require).
        // Fire-and-forget: the user is attached as soon as the module resolves.
        void import("@/store/auth").then(({ useAuthStore }) => {
          const user = useAuthStore?.getState?.()?.user
          if (user?.id) {
            scope.setUser({
              id: user.id,
              username: user.name ?? undefined,
              email: user.email ?? undefined,
            })
          }
        })
      } catch {
        // Auth store not yet available during hydration — that's fine
      }
      return scope
    },
  })
}
