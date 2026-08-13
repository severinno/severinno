/**
 * Push Payload Store — Armazenamento temporário para payloads grandes.
 *
 * Quando um payload de notificação push excede ~3KB, ele é armazenado aqui
 * com um ID único. Apenas o ID é enviado no push real (signal-only pattern).
 * O service worker então busca o payload completo via GET /api/push/payload/:id.
 *
 * Storage:
 *   1. Redis — preferencial (expira em 5 min)
 *   2. In-memory Map — fallback quando Redis está indisponível
 *
 * O payload expira em 5 minutos porque o push deve ser processado
 * rapidamente pelo navegador. Se o usuário estiver offline por mais
 * de 5 min, a notificação simplesmente não aparece (comportamento
 * padrão do Web Push — o push expira se não for entregue a tempo).
 */

import "server-only"
import { getClient } from "@/lib/redis"
import logger from "./logger"

const PAYLOAD_TTL = 300 // 5 minutes

// In-memory fallback store (only used when Redis is down)
const memoryStore = new Map<string, { payload: Record<string, unknown>; expiresAt: number }>()

// Periodically clean up expired in-memory entries
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now()
    for (const [key, val] of memoryStore) {
      if (now > val.expiresAt) memoryStore.delete(key)
    }
  }, 60_000)
}

/**
 * Store a rich payload and return its reference ID.
 * The ID is a short random string that fits easily in a 4KB push payload.
 */
export async function storePayload(payload: Record<string, unknown>): Promise<string> {
  const id = generateId()

  // Try Redis first
  try {
    const client = getClient()
    if (client && client.status === "ready") {
      await client.setex(`push:payload:${id}`, PAYLOAD_TTL, JSON.stringify(payload))
      logger.debug({ id, size: JSON.stringify(payload).length }, "push payload stored in Redis")
      return id
    }
  } catch {
    // Redis unavailable — fall through to memory
  }

  // Fallback: in-memory store
  memoryStore.set(id, {
    payload,
    expiresAt: Date.now() + PAYLOAD_TTL * 1000,
  })
  logger.debug(
    { id, size: JSON.stringify(payload).length },
    "push payload stored in memory (Redis unavailable)",
  )
  return id
}

/**
 * Retrieve a rich payload by its reference ID.
 * Returns null if expired or not found.
 */
export async function getPayload(id: string): Promise<Record<string, unknown> | null> {
  // Try Redis first
  try {
    const client = getClient()
    if (client && client.status === "ready") {
      const raw = await client.get(`push:payload:${id}`)
      if (raw) {
        // Delete after read (one-time access)
        await client!.del(`push:payload:${id}`).catch(() => {})
        return JSON.parse(raw) as Record<string, unknown>
      }
    }
  } catch {
    // Redis unavailable — fall through to memory
  }

  // Fallback: in-memory store
  const entry = memoryStore.get(id)
  if (!entry || Date.now() > entry.expiresAt) {
    memoryStore.delete(id)
    return null
  }
  memoryStore.delete(id) // One-time access
  return entry.payload
}

/**
 * Generate a short, URL-safe random ID.
 * 16 chars = enough uniqueness for 5-minute window.
 */
function generateId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let result = ""
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  for (let i = 0; i < 16; i++) {
    result += chars[array[i]! % chars.length]
  }
  return result
}
