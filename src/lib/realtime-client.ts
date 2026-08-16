import "server-only"
import logger from "./logger"

const REALTIME_URL = process.env.REALTIME_URL ?? "http://localhost:3003"
const EMIT_TOKEN = process.env.REALTIME_EMIT_TOKEN
// Timeout (ms) do POST /emit. Um realtime que aceita o TCP mas nunca
// responde (processo travado / sem handler) deixaria o fetch pendurado —
// travando o logout (destroySession aguarda emitRealtime) e outros fluxos.
// AbortSignal.timeout() aborta o fetch após o prazo (rejeita com
// TimeoutError, capturado pelo catch). Guarda contra valores inválidos:
// Number() → NaN → || 3000 cai no default; negativo/zero → Math.max(1, …).
const EMIT_TIMEOUT_MS = Math.max(1, Number(process.env.REALTIME_EMIT_TIMEOUT_MS) || 3000)

export async function emitRealtime<T = Record<string, unknown>>(
  event: string,
  data: T,
): Promise<void> {
  try {
    await fetch(`${REALTIME_URL}/emit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Bearer token exigido pelo realtime mini-service (fail closed).
        ...(EMIT_TOKEN ? { Authorization: `Bearer ${EMIT_TOKEN}` } : {}),
      },
      body: JSON.stringify({ event, data }),
      signal: AbortSignal.timeout(EMIT_TIMEOUT_MS),
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
