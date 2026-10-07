import "server-only"
import logger from "./logger"
import { safeFetch } from "./safe-fetch"
import { readRealtimeEmitKey } from "./realtime-emit-key"

const REALTIME_URL = process.env.REALTIME_URL ?? "http://localhost:3003"

/**
 * Chave do /emit do realtime — DEVE ser a mesma REALTIME_EMIT_API_KEY
 * configurada no mini-service. Sem ela o /emit responde 401/503 (fail-closed)
 * e o emitRealtime degrada para warn (eventos em tempo real são best-effort;
 * o estado converge pelo polling/refresh já existente).
 *
 * Fonte: Docker Secret via REALTIME_EMIT_API_KEY_FILE (produção) ou a env
 * direta (dev/staging) — ver src/lib/realtime-emit-key.ts.
 */
const EMIT_API_KEY = readRealtimeEmitKey()

export async function emitRealtime<T = Record<string, unknown>>(
  event: string,
  data: T,
): Promise<void> {
  if (!EMIT_API_KEY) {
    logger.warn(
      { event },
      "realtime emit skipped: REALTIME_EMIT_API_KEY not set (o /emit do realtime está fail-closed)",
    )
    return
  }
  try {
    await safeFetch(`${REALTIME_URL}/emit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": EMIT_API_KEY },
      body: JSON.stringify({ event, data }),
      timeoutMs: 5_000,
      label: "realtime",
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
