/**
 * Severinno Marketplace SaaS — Realtime Mini-Service: session_limit notification
 *
 * When the session concurrency limit kicks an OLD socket (a newer login on
 * another device/tab took over), we create an in-app notification so the user
 * sees "Sua sessão foi encerrada em outro dispositivo" in the bell dropdown
 * (the app's /api/notifications reads the same Notification table). The
 * STILL-CONNECTED socket (the newest one, in room user:{id}) then receives
 * `notification:new` and shows the toast + invalidates the bell query.
 *
 * Same shape as the app's createInAppNotification (src/lib/notifications.ts):
 *   type = "SESSION_LIMIT", title/body human-readable, read = false.
 *
 * The DB pool is DUCK-TYPED (`PoolLike`) and injected — the realtime service
 * wires the lazy pg pool loader, while unit tests inject a fake pool. This
 * module never imports `pg` (keeps it typecheckable without @types/pg and
 * testable in isolation). Fail-open: missing pool or query error → null (the
 * kick flow must never break because the notification insert failed).
 */

import { randomUUID } from "node:crypto"
import type { PoolLike, PoolLoader } from "./booking-participant"

export const SESSION_LIMIT_TYPE = "SESSION_LIMIT"
export const SESSION_LIMIT_TITLE = "Sua sessão foi encerrada em outro dispositivo"
export const SESSION_LIMIT_BODY =
  "Um novo login em outro dispositivo encerrou esta sessão. Se não foi você, troque sua senha."

/**
 * INSERT na tabela "Notification" (Prisma model sem @@map). Retorna id +
 * createdAt para o caller poder emitir notification:new com o registro real
 * (padrão createInAppNotification → emitRealtime do app).
 */
export const SESSION_LIMIT_NOTIFICATION_SQL = `
  INSERT INTO "Notification" ("id", "userId", "type", "title", "body", "read", "createdAt", "updatedAt")
  VALUES ($1, $2, $3, $4, $5, false, $6, $6)
  RETURNING "id", "createdAt"
`

export interface SessionNotificationResult {
  id: string
  createdAt: string
}

/**
 * Create a `(userId) => Promise<SessionNotificationResult | null>` notifier
 * backed by the injected pool loader. Fail-open: no pool / query error → null.
 */
export function createSessionLimitNotifier(
  loadPool: PoolLoader,
): (userId: string) => Promise<SessionNotificationResult | null> {
  return async (userId) => {
    let pool: PoolLike | null = null
    try {
      pool = await loadPool()
    } catch {
      pool = null
    }
    if (!pool) {
      // Sem DB não dá para persistir a notificação — fail-open, não quebra o kick.
      // (O loadBookingPool já avisa quando DATABASE_URL está ausente — sem warn duplicado.)
      return null
    }

    const id = randomUUID()
    const now = new Date().toISOString()
    try {
      const res = await pool.query(SESSION_LIMIT_NOTIFICATION_SQL, [
        id,
        userId,
        SESSION_LIMIT_TYPE,
        SESSION_LIMIT_TITLE,
        SESSION_LIMIT_BODY,
        now,
      ])
      const row = res.rows?.[0]
      if (!row) return null
      return { id: String(row.id ?? id), createdAt: String(row.createdAt ?? now) }
    } catch (err) {
      console.error("[realtime] session_limit notification insert error (fail-open):", err)
      return null
    }
  }
}
