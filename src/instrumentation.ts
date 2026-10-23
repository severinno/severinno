import logger from "./lib/logger"

const WARM_DISABLED = process.env.GEO_STARTUP_WARM_DISABLED === "true"

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Load env vars first — everything depends on them
    await import("./lib/env")

    // ── Eagerly connect Redis ────────────────────────────────────────
    // Prevents race condition where health check pings before lazy
    // connect completes. This ensures the client is ready on first request.
    try {
      const { ensureConnected } = await import("./lib/redis")
      const client = await ensureConnected()
      if (client) {
        logger.info("instrumentation: Redis connected eagerly")
      } else {
        logger.warn("instrumentation: Redis unavailable — falling through to memory tier")
      }
    } catch (err) {
      logger.warn({ err }, "instrumentation: Redis eager connect failed — memory tier active")
    }

    // ── Eagerly connect RabbitMQ ────────────────────────────────────
    // Mesmo padrão do Redis: conecta no boot para o /api/health refletir
    // o estado real desde o primeiro request e para a primeira notificação
    // não pagar o custo do lazy-connect. Falha não é fatal — o reconnect
    // da lib (promessa resetada) e a sonda do health assumem depois.
    try {
      const { getChannel } = await import("./lib/queue")
      await getChannel()
      logger.info("instrumentation: RabbitMQ connected eagerly")
    } catch (err) {
      logger.warn(
        { err },
        "instrumentation: RabbitMQ eager connect failed — health sonda e reconecta",
      )
    }

    // ── Sentry / GlitchTip error tracking ──────────────────────────────
    // sentry.server.config.ts is auto-loaded by Next.js instrumentation.
    // We add flush on shutdown so pending events are delivered before exit.
    if (process.env.GLITCHTIP_DSN || process.env.SENTRY_DSN) {
      try {
        const { flushSentry } = await import("./lib/sentry")
        const shutdown = async () => {
          await flushSentry(3000)
        }
        process.on("SIGTERM", shutdown)
        process.on("SIGINT", shutdown)
        logger.info("instrumentation: GlitchTip/Sentry error tracking active")
      } catch {
        logger.warn("instrumentation: Sentry init skipped")
      }
    }
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

    // ── Seed in-memory spatial index from DB ──────────────────────────
    // Powers the fast path in searchNearbyProvidersFast (<1ms lookups).
    // Runs once on startup, before any requests arrive.
    import("./lib/redis-geo")
      .then(async ({ seedGeoIndexFromDB }) => {
        const count = await seedGeoIndexFromDB()
        logger.info({ count }, "instrumentation: geo spatial index seeded")
      })
      .catch((err: unknown) => {
        logger.warn(
          { err },
          "instrumentation: geo spatial index seed failed — falling through to PostGIS",
        )
      })

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
