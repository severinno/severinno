import "server-only"
import logger from "./logger"

const REALTIME_URL = process.env.REALTIME_URL ?? "http://localhost:3003"

export async function emitRealtime<T = Record<string, unknown>>(
  event: string,
  data: T,
): Promise<void> {
  try {
    await fetch(`${REALTIME_URL}/emit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, data }),
    })
  } catch (err) {
    logger.warn({ err, event }, "realtime emit failed")
  }
}

export async function sendBookingUpdate(opts: {
  bookingId: string
  clientId: string
  providerId: string
  status: string
}): Promise<void> {
  await emitRealtime("booking:update", opts)
}

export async function sendTrackingPosition(opts: {
  bookingId: string
  clientId: string
  lat: number
  lng: number
}): Promise<void> {
  await emitRealtime("tracking:position", opts)
}
