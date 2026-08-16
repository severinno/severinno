/**
 * Tests for mini-services/realtime/booking-participant.ts
 *
 * The checker validates that a user is a REAL participant (clientId OR
 * providerId) of a booking, gating message:send on booking membership.
 * The DB pool is duck-typed and injected, so these tests never touch pg.
 */

import { describe, it, expect, vi } from "vitest"
import {
  BOOKING_PARTICIPANT_SQL,
  createBookingParticipantChecker,
  type PoolLike,
  type PoolLoader,
} from "../../../mini-services/realtime/booking-participant"

function fakePool(rowCount: number | null): PoolLike {
  return { query: vi.fn().mockResolvedValue({ rowCount }) } as unknown as PoolLike
}

function loader(pool: PoolLike | null): PoolLoader {
  return () => Promise.resolve(pool)
}

describe("BOOKING_PARTICIPANT_SQL", () => {
  it("queries the Booking table by membership (clientId OR providerId)", () => {
    expect(BOOKING_PARTICIPANT_SQL).toContain('FROM "Booking"')
    expect(BOOKING_PARTICIPANT_SQL).toContain('"clientId" = $2')
    expect(BOOKING_PARTICIPANT_SQL).toContain('"providerId" = $2')
    expect(BOOKING_PARTICIPANT_SQL).toContain("id = $1")
    expect(BOOKING_PARTICIPANT_SQL).toContain("LIMIT 1")
  })
})

describe("createBookingParticipantChecker", () => {
  it("returns true when the user is a participant (rowCount 1)", async () => {
    const pool = fakePool(1)
    const check = createBookingParticipantChecker(loader(pool))
    await expect(check("bk-1", "user-1")).resolves.toBe(true)
    expect(pool.query).toHaveBeenCalledWith(BOOKING_PARTICIPANT_SQL, ["bk-1", "user-1"])
  })

  it("returns false when the user is NOT a participant (rowCount 0)", async () => {
    const check = createBookingParticipantChecker(loader(fakePool(0)))
    await expect(check("bk-1", "user-999")).resolves.toBe(false)
  })

  it("returns false when the booking does not exist (rowCount null)", async () => {
    const check = createBookingParticipantChecker(loader(fakePool(null)))
    await expect(check("bk-missing", "user-1")).resolves.toBe(false)
  })

  it("fails closed when the pool loader returns null (no DATABASE_URL)", async () => {
    const check = createBookingParticipantChecker(loader(null))
    await expect(check("bk-1", "user-1")).resolves.toBe(false)
  })

  it("fails closed when the pool loader throws", async () => {
    const check = createBookingParticipantChecker(() => {
      throw new Error("pool init failed")
    })
    await expect(check("bk-1", "user-1")).resolves.toBe(false)
  })

  it("fails closed when the query rejects", async () => {
    const pool = {
      query: vi.fn().mockRejectedValue(new Error("connection refused")),
    } as unknown as PoolLike
    const check = createBookingParticipantChecker(loader(pool))
    await expect(check("bk-1", "user-1")).resolves.toBe(false)
  })
})
