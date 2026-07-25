import { consume, close } from "../lib/queue"
import { setupGracefulShutdown } from "../lib/graceful-shutdown"
import { sendMail } from "../lib/mail"
import type { EmailPayload } from "../lib/email-queue"
import logger from "../lib/logger"

async function handleEmail(msg: Record<string, unknown>): Promise<void> {
  const { to, subject, html } = msg as unknown as EmailPayload
  if (!to || !subject || !html) {
    logger.warn({ msg }, "invalid email payload, skipping")
    return
  }
  try {
    await sendMail({ to, subject, html })
  } catch (err) {
    logger.error({ err, to, subject }, "failed to send email")
  }
}

async function main() {
  logger.info("starting email worker")

  await consume({
    queue: "emails",
    routingKey: "email",
    handler: handleEmail,
    prefetch: 5,
  })

  logger.info("listening on queue=emails")

  setupGracefulShutdown(async () => {
    logger.info("shutting down email worker")
    await close()
  })
}

main().catch((err) => {
  logger.error({ err }, "fatal")
  process.exit(1)
})
