import logger from "./lib/logger"

const WARM_DISABLED = process.env.GEO_STARTUP_WARM_DISABLED === "true"

export async function register() {
  // Load env vars first — everything depends on them
  await import("./lib/env")

  // ── Global fetch timeout floor (server) ──────────────────────────────
  // Todo fetch SEM signal explícito ganha AbortSignal.timeout resolvido de
  // GLOBAL_FETCH_TIMEOUT_MS (default 60s) — fecha hangs de serviços que aceitam
  // TCP mas nunca respondem em código que não passa signal (libs de terceiros,
  // fora do guard check-fetch-timeout). Signal explícito (envTimeoutSignal por
  // chamada) VENCE. Idempotente; ver src/lib/fetch-timeout.ts.
  const { installGlobalFetchTimeoutFloor } = await import("./lib/fetch-timeout")
  installGlobalFetchTimeoutFloor()

  // ── Geo cache warming (post-restart) ────────────────────────────────
  // Pre-heats the Redis cache with the most popular geo queries so the
  // first users after restart get cached responses instead of 5s latencies.
  //
  // Runs in the background — does NOT block server startup.
  // Set GEO_STARTUP_WARM_DISABLED=true to opt out.
  if (!WARM_DISABLED) {
    import("./lib/geo-startup-warm")
      .then(async ({ warmGeoCacheFromLog }) => {
        const result = await warmGeoCacheFromLog()
        logger.info(
          {
            source: result.source,
            total: result.total,
            elapsedMs: result.elapsedMs,
            errors: result.errors,
          },
          "instrumentation: geo cache warming complete",
        )
      })
      .catch((err: unknown) => {
        logger.warn({ err }, "instrumentation: geo cache warming failed — skipping")
      })
  }
}
