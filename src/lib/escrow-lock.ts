/**
 * escrow-lock.ts — Distributed Mutex Lock for Escrow Transitions
 *
 * Prevents concurrent double-release or dispute race conditions
 * on booking escrow funds across multiple worker/API processes.
 */

import crypto from "crypto"
import { ensureConnected } from "@/lib/redis/client"
import logger from "@/lib/logger"

const log = typeof logger?.child === "function" ? logger.child({ module: "escrow-lock" }) : logger

// In-memory fallback mutex store when Redis is unavailable
const memoryLockStore = new Map<string, { token: string; expiresAt: number }>()

export interface EscrowLockResult {
  acquired: boolean
  lockToken?: string
  release: () => Promise<void>
}

/**
 * Attempts to acquire an exclusive lock on a booking escrow operation.
 *
 * @param bookingId Booking identifier
 * @param ttlSeconds Lock timeout in seconds (default: 15s)
 */
export async function acquireEscrowLock(
  bookingId: string,
  ttlSeconds: number = 15,
): Promise<EscrowLockResult> {
  const lockKey = `lock:escrow:${bookingId}`
  const token = `lock_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`
  const now = Date.now()

  // 1. Try Redis distributed lock (NX = only set if not exists, EX = expire in seconds)
  try {
    const c = await ensureConnected()
    if (c) {
      const res = await (
        c as unknown as {
          set: (
            k: string,
            v: string,
            mode: string,
            ex: number,
            cond: string,
          ) => Promise<string | null>
        }
      ).set(lockKey, token, "EX", ttlSeconds, "NX")
      if (res === "OK") {
        return {
          acquired: true,
          lockToken: token,
          release: async () => {
            try {
              // Lua script to safely release only if token matches
              const script = `
                if redis.call("get", KEYS[1]) == ARGV[1] then
                  return redis.call("del", KEYS[1])
                else
                  return 0
                end
              `
              await (
                c as unknown as {
                  eval: (s: string, numKeys: number, k: string, arg: string) => Promise<number>
                }
              ).eval(script, 1, lockKey, token)
            } catch (err) {
              log.warn({ err, bookingId }, "Falha ao liberar lock Redis do escrow")
            }
          },
        }
      } else {
        // Lock already held by another concurrent process
        return {
          acquired: false,
          release: async () => {},
        }
      }
    }
  } catch (err) {
    log.warn(
      { err, bookingId },
      "Erro ao contactar Redis para lock de escrow, usando fallback em memória",
    )
  }

  // 2. In-memory fallback
  const existing = memoryLockStore.get(lockKey)
  if (existing && existing.expiresAt > now) {
    return {
      acquired: false,
      release: async () => {},
    }
  }

  // Set in-memory lock
  memoryLockStore.set(lockKey, {
    token,
    expiresAt: now + ttlSeconds * 1000,
  })

  return {
    acquired: true,
    lockToken: token,
    release: async () => {
      const current = memoryLockStore.get(lockKey)
      if (current && current.token === token) {
        memoryLockStore.delete(lockKey)
      }
    },
  }
}

/**
 * Resets memory lock store (primarily for unit test cleanups)
 */
export function __resetMemoryLockStore(): void {
  memoryLockStore.clear()
}
