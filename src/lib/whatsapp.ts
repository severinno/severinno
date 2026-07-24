import "server-only"
import { db } from "@/lib/db"
import logger from "@/lib/logger"

// Lazy accessors so vi.stubEnv works in tests (module-level consts are cached at import time)
function getApiUrl(): string {
  return process.env.WHATSAPP_API_URL ?? "http://localhost:8080"
}
function getApiKey(): string {
  return process.env.WHATSAPP_API_KEY ?? ""
}
function getInstance(): string {
  return process.env.WHATSAPP_INSTANCE ?? "severinno"
}

export type WhatsAppPayload = {
  userId: string
  title: string
  body?: string
  /** Optional deep link path (e.g. "/?view=client.bookings") */
  url?: string
}

/**
 * Send a WhatsApp text message to a user via the Evolution API gateway.
 * Silently skips if:
 *   - WHATSAPP_API_URL or WHATSAPP_API_KEY is not configured
 *   - The user has no WhatsApp number registered
 */
export async function sendWhatsApp(payload: WhatsAppPayload): Promise<void> {
  const apiUrl = getApiUrl()
  const apiKey = getApiKey()

  if (!apiUrl || !apiKey) {
    logger.warn("WHATSAPP_API_URL/KEY not configured — whatsapp notifications disabled")
    return
  }

  let phone: string | null
  try {
    const user = await db.user.findUnique({
      where: { id: payload.userId },
      select: { whatsapp: true },
    })
    phone = user?.whatsapp ?? null
  } catch (err) {
    logger.error({ err: (err as Error).message, userId: payload.userId }, "whatsapp: failed to fetch user phone")
    return
  }

  if (!phone) {
    logger.debug({ userId: payload.userId }, "whatsapp: user has no phone number — skipped")
    return
  }

  // Strip non-digits and ensure DDI (55 for Brazil)
  const digits = phone.replace(/\D/g, "")
  const number = digits.startsWith("55") ? digits : `55${digits}`

  // Build the message text
  const messageParts: string[] = [`*${payload.title}*`]
  if (payload.body) messageParts.push(payload.body)
  if (payload.url) messageParts.push(`\n🔗 ${payload.url}`)
  const text = messageParts.join("\n\n")

  const instance = getInstance()

  try {
    const response = await fetch(
      `${apiUrl}/message/send/${instance}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: apiKey,
        },
        body: JSON.stringify({
          number,
          text,
          delay: 1000,
        }),
      },
    )

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "")
      logger.warn(
        {
          status: response.status,
          userId: payload.userId,
          errorBody: errorBody.slice(0, 200),
        },
        "whatsapp: send failed",
      )
      return
    }

    logger.info({ userId: payload.userId }, "whatsapp: message sent")
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, userId: payload.userId },
      "whatsapp: send error (network)",
    )
  }
}

/**
 * Send WhatsApp to multiple users in parallel.
 */
export async function sendWhatsAppToMany(
  payloads: WhatsAppPayload[],
): Promise<void> {
  await Promise.allSettled(payloads.map((p) => sendWhatsApp(p)))
}
