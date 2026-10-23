import { describe, it, expect, beforeEach } from "vitest"
import {
  enqueueOfflinePing,
  getPendingOfflinePings,
  clearOfflinePings,
  flushOfflineGeoQueue,
} from "../offline-geo-queue"

describe("OfflineGeoQueue (src/lib/offline-geo-queue.ts)", () => {
  beforeEach(async () => {
    await clearOfflinePings()
  })

  it("enqueues and retrieves offline pings correctly", async () => {
    const ping = {
      bookingId: "book-123",
      lat: -18.852,
      lng: -41.942,
      speed: 12.5,
      heading: 90,
      accuracy: 8,
      timestamp: new Date().toISOString(),
    }

    await enqueueOfflinePing(ping)
    const pending = await getPendingOfflinePings("book-123")

    expect(pending.length).toBe(1)
    expect(pending[0].lat).toBe(-18.852)
    expect(pending[0].bookingId).toBe("book-123")
  })

  it("filters pending pings by bookingId", async () => {
    await enqueueOfflinePing({
      bookingId: "book-A",
      lat: -18.85,
      lng: -41.94,
      speed: null,
      heading: null,
      accuracy: 5,
      timestamp: new Date().toISOString(),
    })

    await enqueueOfflinePing({
      bookingId: "book-B",
      lat: -18.86,
      lng: -41.95,
      speed: null,
      heading: null,
      accuracy: 10,
      timestamp: new Date().toISOString(),
    })

    const pingsA = await getPendingOfflinePings("book-A")
    const pingsB = await getPendingOfflinePings("book-B")

    expect(pingsA.length).toBe(1)
    expect(pingsA[0].bookingId).toBe("book-A")
    expect(pingsB.length).toBe(1)
    expect(pingsB[0].bookingId).toBe("book-B")
  })

  it("flushes queue successfully when sender succeeds", async () => {
    await enqueueOfflinePing({
      bookingId: "book-flush",
      lat: -18.851,
      lng: -41.941,
      speed: 5,
      heading: 45,
      accuracy: 6,
      timestamp: new Date().toISOString(),
    })

    let sentCount = 0
    const count = await flushOfflineGeoQueue(async (pings) => {
      sentCount = pings.length
      return true
    }, "book-flush")

    expect(count).toBe(1)
    expect(sentCount).toBe(1)

    const remaining = await getPendingOfflinePings("book-flush")
    expect(remaining.length).toBe(0)
  })

  it("preserves queue when sender fails", async () => {
    await enqueueOfflinePing({
      bookingId: "book-fail",
      lat: -18.851,
      lng: -41.941,
      speed: 5,
      heading: 45,
      accuracy: 6,
      timestamp: new Date().toISOString(),
    })

    const count = await flushOfflineGeoQueue(async () => false, "book-fail")
    expect(count).toBe(0)

    const remaining = await getPendingOfflinePings("book-fail")
    expect(remaining.length).toBe(1)
  })
})
