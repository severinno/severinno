/**
 * sql-booking-builder.ts
 *
 * Pure SQL query builder for the bookings search.
 *
 * Encapsulates the construction of parameterized WHERE clauses used
 * when querying the "Booking" table via $queryRawUnsafe.
 *
 * The function is pure — no I/O, no side effects.  This makes it
 * trivially testable without mocks.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for {@link buildBookingWhereClause}. */
export interface BuildBookingWhereClauseOptions {
  /** Filter by client (who requested the booking). */
  clientId?: string
  /** Filter by provider (who will fulfil the booking). */
  providerId?: string
  /** Filter by booking status (PENDING, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED, etc.). */
  status?: string
  /** Only bookings scheduled at or after this date/time. */
  scheduledAfter?: Date | string
  /** Only bookings scheduled at or before this date/time. */
  scheduledBefore?: Date | string
  /** Only bookings created at or after this date/time. */
  createdAtAfter?: Date | string
  /** Only bookings created at or before this date/time. */
  createdAtBefore?: Date | string
  /**
   * When set, a PostGIS ST_DWithin radius filter is appended on the
   * booking's `location` geography column (backed by the GiST index
   * `idx_booking_location_gist`).
   * When null/undefined, no spatial filter is applied.
   */
  centerGeo?: { lat: number; lng: number; radiusKm: number } | null
}

/**
 * Shape of the WHERE clause builder used for booking queries.
 *
 * Defined here alongside the implementation so that the canonical
 * production function (`buildBookingWhereClause`) and any mock/injected
 * variants share the same contract.
 */
export type BookingWhereClauseBuilder = (
  opts: BuildBookingWhereClauseOptions,
) => [string, unknown[]]

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build the base WHERE clause and params for the booking search.
 *
 * Returns `[sqlString, paramsArray]` suitable for passing to
 * `$queryRawUnsafe` or embedding in a larger query.
 *
 * The clause always includes a soft-delete guard (`"deletedAt" IS NULL`).
 *
 * Optional filters (applied when the corresponding option is set):
 *   - clientId  — restrict to a specific client
 *   - providerId — restrict to a specific provider
 *   - status    — filter by booking status
 *   - scheduledAfter / scheduledBefore — date range on scheduledAt
 *   - createdAtAfter / createdAtBefore — date range on createdAt
 *
 * @example
 * ```ts
 * const [sql, params] = buildBookingWhereClause({
 *   providerId: "prov-123",
 *   status: "PENDING",
 * })
 * // sql:   "\"deletedAt\" IS NULL AND \"providerId\" = $1 AND \"status\" = $2"
 * // params: ["prov-123", "PENDING"]
 * ```
 */
export function buildBookingWhereClause(
  opts: BuildBookingWhereClauseOptions,
): [string, unknown[]] {
  const {
    clientId,
    providerId,
    status,
    scheduledAfter,
    scheduledBefore,
    createdAtAfter,
    createdAtBefore,
    centerGeo,
  } = opts

  const conditions: string[] = [`b.\"deletedAt\" IS NULL`]
  const params: unknown[] = []
  let idx = 0

  // Client filter
  if (clientId) {
    conditions.push(`b.\"clientId\" = $${++idx}`)
    params.push(clientId)
  }

  // Provider filter
  if (providerId) {
    conditions.push(`b.\"providerId\" = $${++idx}`)
    params.push(providerId)
  }

  // Status filter
  if (status) {
    conditions.push(`b.\"status\" = $${++idx}`)
    params.push(status)
  }

  // Scheduled date range
  if (scheduledAfter) {
    conditions.push(`b.\"scheduledAt\" >= $${++idx}::timestamptz`)
    params.push(scheduledAfter)
  }
  if (scheduledBefore) {
    conditions.push(`b.\"scheduledAt\" <= $${++idx}::timestamptz`)
    params.push(scheduledBefore)
  }

  // Created date range
  if (createdAtAfter) {
    conditions.push(`b.\"createdAt\" >= $${++idx}::timestamptz`)
    params.push(createdAtAfter)
  }
  if (createdAtBefore) {
    conditions.push(`b.\"createdAt\" <= $${++idx}::timestamptz`)
    params.push(createdAtBefore)
  }

  // PostGIS radius filter (uses idx_booking_location_gist)
  if (centerGeo) {
    conditions.push(
      `b.location IS NOT NULL`,
      `ST_DWithin(b.location, ST_SetSRID(ST_MakePoint($${++idx}, $${++idx}), 4326)::geography, ${centerGeo.radiusKm * 1000})`,
    )
    params.push(centerGeo.lng, centerGeo.lat)
  }

  return [conditions.join(" AND "), params]
}
