/**
 * Severinno Marketplace SaaS — Realtime Mini-Service: booking participant check
 *
 * Verifies that a user is a REAL participant (clientId OR providerId) of a
 * booking, so `message:send` can be gated on actual booking membership, not
 * just on a self-declared fromId.
 *
 * The DB pool is DUCK-TYPED (`PoolLike`): the realtime service injects a lazy
 * pg.Pool loader in index.ts, while unit tests inject a fake pool — this
 * module never imports `pg` (keeps it typecheckable without @types/pg and
 * testable in isolation). Fail-closed: missing pool or query error → false.
 */

export interface PoolLike {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rowCount: number | null; rows?: Array<Record<string, unknown>> }>
}

export type PoolLoader = () => PoolLike | null | Promise<PoolLike | null>

/**
 * Booking query — table "Booking", membership = clientId OR providerId.
 * Prisma model has no `@@map`, so the table name is the model name.
 */
export const BOOKING_PARTICIPANT_SQL = `
  SELECT 1 FROM "Booking"
  WHERE id = $1 AND ("clientId" = $2 OR "providerId" = $2)
  LIMIT 1
`

/**
 * Create an async `(bookingId, userId) => Promise<boolean>` resolver backed by
 * the injected pool loader. Fail-closed: no pool / query error → false.
 */
export function createBookingParticipantChecker(
  loadPool: PoolLoader,
): (bookingId: string, userId: string) => Promise<boolean> {
  return async (bookingId, userId) => {
    let pool: PoolLike | null = null
    try {
      pool = await loadPool()
    } catch {
      pool = null
    }
    if (!pool) return false // fail-closed: sem DB não dá para verificar participação

    try {
      const res = await pool.query(BOOKING_PARTICIPANT_SQL, [bookingId, userId])
      return (res.rowCount ?? 0) > 0
    } catch {
      return false // fail-closed
    }
  }
}
