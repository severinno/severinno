/**
 * Graceful shutdown helper for workers.
 *
 * Usage:
 *   import { setupGracefulShutdown } from "@/lib/graceful-shutdown"
 *   const shutdown = setupGracefulShutdown(async () => {
 *     await closeConnection()
 *   })
 *   // shutdown() is called automatically on SIGINT/SIGTERM
 */

import logger from "./logger"

type CleanupFn = () => Promise<void>

export function setupGracefulShutdown(cleanup: CleanupFn, timeoutMs = 10_000): void {
  let shuttingDown = false

  async function handleSignal(signal: string) {
    if (shuttingDown) {
      logger.warn({ signal }, "forced shutdown — already shutting down")
      process.exit(1)
    }

    shuttingDown = true
    logger.info({ signal }, "graceful shutdown initiated")

    const timer = setTimeout(() => {
      logger.error({ timeoutMs }, "graceful shutdown timed out — forcing exit")
      process.exit(1)
    }, timeoutMs)

    try {
      await cleanup()
      logger.info("graceful shutdown complete")
    } catch (err) {
      logger.error({ err }, "error during graceful shutdown")
    } finally {
      clearTimeout(timer)
      process.exit(0)
    }
  }

  process.on("SIGINT", () => handleSignal("SIGINT"))
  process.on("SIGTERM", () => handleSignal("SIGTERM"))
}
