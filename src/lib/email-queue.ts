import "server-only"
import { publish } from "./queue"

export type EmailPayload = {
  to: string
  subject: string
  html: string
}

export async function queueEmail(payload: EmailPayload): Promise<void> {
  await publish({
    routingKey: "email",
    payload: { ...payload, timestamp: new Date().toISOString() },
  })
}
