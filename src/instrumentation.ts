import logger from "./lib/logger"

const WARM_DISABLED = process.env.GEO_STARTUP_WARM_DISABLED === "true"

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Load env vars first — everything depends on them
    await import("./lib/env")

    // ── OpenTelemetry distributed tracing ──────────────────────────────
    // Must be initialized BEFORE any other imports that need instrumentation.
    // Set OTEL_ENABLED=true to enable (disabled by default for dev speed).
    if (process.env.OTEL_ENABLED === "true") {
      try {
        const { initTracing, shutdownTracing } = await import("./lib/tracing")
        initTracing()
        logger.info("instrumentation: OpenTelemetry tracing initialized")

        // Graceful shutdown — flush pending spans before exit
        const shutdown = async () => {
          logger.info("instrumentation: shutting down OpenTelemetry...")
          await shutdownTracing()
        }
        process.on("SIGTERM", shutdown)
        process.on("SIGINT", shutdown)
      } catch (err) {
        logger.warn({ err }, "instrumentation: OpenTelemetry init failed — skipping")
      }
    }

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
}
