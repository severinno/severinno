/**
 * sql.ts
 *
 * Barrel for SQL builder utilities.
 *
 * Re-exports the most commonly used SQL builder functions and types:
 *
 *   Functions:
 *     buildProviderWhereClause    — parameterized WHERE clause for provider search
 *     buildBookingWhereClause     — parameterized WHERE clause for booking queries
 *     buildServiceWhereClause     — parameterized WHERE clause for service queries
 *
 *   Types:
 *     WhereClauseBuilder          — provider WHERE clause function signature
 *     BuildWhereClauseOptions     — provider filter input options
 *     BookingWhereClauseBuilder   — booking WHERE clause function signature
 *     BuildBookingWhereClauseOptions — booking filter input options
 *     ServiceWhereClauseBuilder   — service WHERE clause function signature
 *     BuildServiceWhereClauseOptions — service filter input options
 *
 * SQL modules should import from this barrel instead of reaching into
 * implementation modules directly, keeping the public API surface explicit
 * and making future refactoring easier.
 *
 * @example
 * ```ts
 * import {
 *   buildProviderWhereClause,
 *   buildBookingWhereClause,
 *   buildServiceWhereClause,
 *   type WhereClauseBuilder,
 *   type BookingWhereClauseBuilder,
 * } from "@/lib/sql"
 * ```
 */

export { buildProviderWhereClause } from "./sql-builder"
export type { WhereClauseBuilder, BuildWhereClauseOptions } from "./sql-builder"

export { buildBookingWhereClause } from "./sql-booking-builder"
export type {
  BookingWhereClauseBuilder,
  BuildBookingWhereClauseOptions,
} from "./sql-booking-builder"

export { buildServiceWhereClause } from "./sql-service-builder"
export type {
  ServiceWhereClauseBuilder,
  BuildServiceWhereClauseOptions,
} from "./sql-service-builder"
