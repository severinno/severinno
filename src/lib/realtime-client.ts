import "server-only"
import logger from "./logger"
import { envTimeoutSignal } from "./fetch-timeout"

// Porta do realtime mini-service — REALTIME_PORT (fallback 3003), derivada
// na URL default do POST /emit. Isolation: rodar o realtime em porta
// alternativa (REALTIME_PORT=3199) reflete aqui sem tocar em código.
const REALTIME_PORT = process.env.REALTIME_PORT ?? "3003"
const REALTIME_URL = process.env.REALTIME_URL ?? `http://localhost:${REALTIME_PORT}`
const EMIT_TOKEN = process.env.REALTIME_EMIT_TOKEN
// Timeout (ms) do POST /emit. Um realtime que aceita o TCP mas nunca
// responde (processo travado / sem handler) deixaria o fetch pendurado —
// travando o logout (destroySession aguarda emitRealtime) e outros fluxos.
// Helper compartilhado (fetch-timeout.ts): AbortSignal.timeout() + guarda
// contra valores inválidos (NaN → default; zero/negativo → clamp).

/**
 * Emit one event to the realtime mini-service (POST /emit, Bearer).
 *
 * Retorna `true` SOMENTE quando a entrega foi CONFIRMADA (HTTP 2xx) — o
 * caller usa para decidir se reivindica a chave de dedupe (ex.:
 * `realtime:renewed:{userId}`). Um emit que falha (rede/timeout/HTTP
 * não-2xx) devolve `false` e NÃO pode marcar a chave como entregue: no
 * caso multi-réplica, uma falha de uma réplica não pode suprimir retries
 * das outras (antes o retorno era void — o app não sabia se a propagação
 * chegou e reivindicava a chave mesmo com o emit falho).
 */
export async function emitRealtime<T = Record<string, unknown>>(
  event: string,
  data: T,
): Promise<boolean> {
  try {
    const res = await fetch(`${REALTIME_URL}/emit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Bearer token exigido pelo realtime mini-service (fail closed).
        ...(EMIT_TOKEN ? { Authorization: `Bearer ${EMIT_TOKEN}` } : {}),
      },
      body: JSON.stringify({ event, data }),
      signal: envTimeoutSignal("REALTIME_EMIT_TIMEOUT_MS", 3000),
    })
    return res.ok
  } catch (err) {
    logger.warn({ err, event }, "realtime emit failed")
    return false
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
