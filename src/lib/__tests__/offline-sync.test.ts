import { describe, it, expect, beforeEach } from "vitest"
import {
  enqueueOfflineMutation,
  getPendingMutations,
  processSyncQueue,
  clearOfflineQueue,
  cacheItemLocally,
  getCachedItem,
  cacheProviderProfileLocally,
  getCachedProviderProfile,
  cacheBookingsLocally,
  getCachedBookings,
  isOnline,
} from "@/lib/offline-sync"

describe("Offline Sync & Local Caching Engine", () => {
  beforeEach(() => {
    clearOfflineQueue()
    localStorage.clear()
  })

  it("enqueues and retrieves offline mutations in order", () => {
    const m1 = enqueueOfflineMutation("SEND_MESSAGE", "peer-1", { text: "Olá offline" })
    const m2 = enqueueOfflineMutation("STATUS_UPDATE", "book-1", { status: "IN_PROGRESS" })

    const pending = getPendingMutations()
    expect(pending.length).toBe(2)
    expect(pending[0].id).toBe(m1.id)
    expect(pending[1].id).toBe(m2.id)
  })

  it("processes queue successfully with custom executor", async () => {
    enqueueOfflineMutation("CHECKIN", "book-1", { lat: -23.55, lng: -46.63 })

    const result = await processSyncQueue(async (mutation) => {
      expect(mutation.action).toBe("CHECKIN")
      return true
    })

    expect(result.processed).toBe(1)
    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.remaining).toBe(0)
    expect(getPendingMutations().length).toBe(0)
  })

  it("caches and retrieves provider profiles locally with expiration check", () => {
    const profile = { id: "p1", name: "Carlos Eletricista", rating: 4.9 }
    cacheProviderProfileLocally("carlos-eletricista", profile)

    const cached = getCachedProviderProfile<{ id: string; name: string }>("carlos-eletricista")
    expect(cached).toEqual(profile)

    // Not existing slug
    expect(getCachedProviderProfile("slug-inexistente")).toBeNull()
  })

  it("caches and retrieves user bookings locally", () => {
    const bookings = [{ id: "b1", amount: 150, service: "Limpeza" }]
    cacheBookingsLocally("user-1", bookings)

    const cached = getCachedBookings("user-1")
    expect(cached).toEqual(bookings)
  })

  it("expires cached items when past TTL", () => {
    cacheItemLocally("short-ttl", { val: 123 }, -1000) // already expired
    expect(getCachedItem("short-ttl")).toBeNull()
  })

  it("reports isOnline based on navigator.onLine", () => {
    expect(typeof isOnline()).toBe("boolean")
  })

  it("handles registerBackgroundSync gracefully when Service Worker sync is not present", async () => {
    const { registerBackgroundSync } = await import("@/lib/offline-sync")
    const result = await registerBackgroundSync("sync-offline-actions")
    expect(typeof result).toBe("boolean")
  })

  it("queues network request for background sync without throwing", async () => {
    const { queueBackgroundSyncRequest } = await import("@/lib/offline-sync")
    const res = await queueBackgroundSyncRequest("/api/checkin", {
      bookingId: "b1",
      lat: -18.85,
      lng: -41.94,
    })
    expect(typeof res).toBe("boolean")
  })
})
