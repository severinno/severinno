import { consume, close } from "../lib/queue"
import { setupGracefulShutdown } from "../lib/graceful-shutdown"
import { handleNotification } from "../lib/notification-queue"
import logger from "../lib/logger"

async function main() {
  logger.info("starting notification worker")

  await consume({
    queue: "notifications",
    routingKey: "notification",
    handler: handleNotification,
    prefetch: 10,
  })

  logger.info("listening on queue=notifications")

  setupGracefulShutdown(async () => {
    logger.info("shutting down notification worker")
    await close()
  })
}

main().catch((err) => {
  logger.error({ err }, "fatal")
  process.exit(1)
})
