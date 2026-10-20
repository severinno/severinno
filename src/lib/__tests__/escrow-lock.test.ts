import { describe, it, expect, beforeEach, vi } from "vitest"
import { acquireEscrowLock, __resetMemoryLockStore } from "../escrow-lock"
import { ensureConnected } from "@/lib/redis/client"

describe("Escrow Distributed Mutex Lock (escrow-lock)", () => {
  beforeEach(() => {
    __resetMemoryLockStore()
    vi.clearAllMocks()
  })

  it("acquires lock successfully for an unlocked booking", async () => {
    const lock = await acquireEscrowLock("book-100", 10)
    expect(lock.acquired).toBe(true)
    expect(lock.lockToken).toBeDefined()

    await lock.release()
  })

  it("prevents concurrent acquisition for the same booking (mutual exclusion)", async () => {
    const client = await ensureConnected()
    if (client) {
      vi.mocked(client.set)
        .mockResolvedValueOnce("OK")
        .mockResolvedValueOnce(null as any)
        .mockResolvedValueOnce("OK")
    }

    const lock1 = await acquireEscrowLock("book-concurrent", 10)
    expect(lock1.acquired).toBe(true)

    // Second simultaneous request for same booking must fail
    const lock2 = await acquireEscrowLock("book-concurrent", 10)
    expect(lock2.acquired).toBe(false)

    // Release first lock
    await lock1.release()

    // Now a third attempt can acquire it
    const lock3 = await acquireEscrowLock("book-concurrent", 10)
    expect(lock3.acquired).toBe(true)
    await lock3.release()
  })

  it("allows independent locks for different bookings concurrently", async () => {
    const client = await ensureConnected()
    if (client) {
      vi.mocked(client.set).mockResolvedValue("OK")
    }

    const lockA = await acquireEscrowLock("book-A", 10)
    const lockB = await acquireEscrowLock("book-B", 10)

    expect(lockA.acquired).toBe(true)
    expect(lockB.acquired).toBe(true)

    await lockA.release()
    await lockB.release()
  })
})
