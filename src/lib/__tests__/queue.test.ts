import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Use vi.hoisted to avoid hoisting issues with vi.mock()
const { mockChannel, mockConnection, mockDb } = vi.hoisted(() => {
  const _channel = {
    assertExchange: vi.fn(),
    assertQueue: vi.fn().mockResolvedValue({ queue: "test-queue" }),
    bindQueue: vi.fn(),
    prefetch: vi.fn(),
    consume: vi.fn(),
    publish: vi.fn().mockReturnValue(true),
    ack: vi.fn(),
    nack: vi.fn(),
    close: vi.fn(),
  }
  return {
    mockChannel: _channel,
    mockConnection: {
      createChannel: vi.fn().mockResolvedValue(_channel),
      on: vi.fn(),
      close: vi.fn(),
    },
    mockDb: {
      service: { findUnique: vi.fn() },
      user: { findMany: vi.fn() },
      booking: { findUnique: vi.fn() },
      $queryRaw: vi.fn(),
    },
  }
})

vi.mock("amqplib", () => ({
  default: { connect: vi.fn().mockResolvedValue(mockConnection) },
  connect: vi.fn().mockResolvedValue(mockConnection),
}))

import { publish, consume, close, EXCHANGE } from "../queue"
import { findBestProvider, findBestProviders, dispatchBooking } from "../dispatch"
import type { PublishOptions, ConsumeOptions } from "../queue"

vi.mock("../notification-queue", () => ({
  queueNotification: vi.fn(),
  saveAndQueueNotification: vi.fn(),
}))

vi.mock("../db", () => ({
  default: mockDb,
  db: mockDb,
}))

vi.mock("../routing", () => ({
  getRoute: vi.fn(),
  getMultiRoute: vi.fn(),
}))

import { queueNotification, saveAndQueueNotification } from "../notification-queue"
import { getRoute, getMultiRoute } from "../routing"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("publish", () => {
  it("publishes message to exchange with correct routing key", async () => {
    const opts: PublishOptions = { routingKey: "booking.created", payload: { bookingId: "book-1" } }

    await publish(opts)

    expect(mockChannel.publish).toHaveBeenCalledWith(
      EXCHANGE,
      "booking.created",
      expect.any(Buffer),
      expect.objectContaining({ persistent: true, contentType: "application/json" }),
    )
    const buffer = mockChannel.publish.mock.calls[0][2] as Buffer
    expect(JSON.parse(buffer.toString())).toEqual({ bookingId: "book-1" })
  })

  it("allows optional persistent flag", async () => {
    const opts: PublishOptions = { routingKey: "test.event", payload: { data: "test" }, persistent: false }
    await publish(opts)
    expect(mockChannel.publish).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), expect.any(Buffer),
      expect.objectContaining({ persistent: false }),
    )
  })

  it("does not throw when publish fails (logged internally)", async () => {
    mockChannel.publish.mockImplementation(() => { throw new Error("Channel closed") })
    await expect(publish({ routingKey: "test", payload: { data: "x" } })).resolves.toBeUndefined()
  })
})

describe("consume", () => {
  it("sets up consumer with correct queue binding", async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    await consume({ queue: "booking-notifications", routingKey: "booking.*", handler })

    expect(mockChannel.assertQueue).toHaveBeenCalledWith(
      "booking-notifications",
      expect.objectContaining({ durable: true }),
    )
    expect(mockChannel.bindQueue).toHaveBeenCalledWith("test-queue", EXCHANGE, "booking.*")
    expect(mockChannel.prefetch).toHaveBeenCalledWith(10)
    expect(mockChannel.consume).toHaveBeenCalledWith("test-queue", expect.any(Function))
  })

  it("allows custom prefetch count", async () => {
    await consume({ queue: "test-queue", routingKey: "test", handler: vi.fn(), prefetch: 5 })
    expect(mockChannel.prefetch).toHaveBeenCalledWith(5)
  })

  it("processes messages and acknowledges them", async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    await consume({ queue: "test-queue", routingKey: "test", handler })

    const consumeCallback = mockChannel.consume.mock.calls[0][1]
    const fakeMessage = { content: Buffer.from(JSON.stringify({ bookingId: "book-1" })) }
    await consumeCallback(fakeMessage)

    expect(handler).toHaveBeenCalledWith({ bookingId: "book-1" })
    expect(mockChannel.ack).toHaveBeenCalledWith(fakeMessage)
  })

  it("nacks messages when handler throws", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("Handler failed"))
    await consume({ queue: "test-queue", routingKey: "test", handler })

    const consumeCallback = mockChannel.consume.mock.calls[0][1]
    const fakeMessage = { content: Buffer.from(JSON.stringify({ data: "bad" })), properties: { headers: {} } }
    await consumeCallback(fakeMessage)

    expect(mockChannel.nack).toHaveBeenCalledWith(fakeMessage, false, true)
  })

  it("ignores null messages", async () => {
    const handler = vi.fn()
    await consume({ queue: "test-queue", routingKey: "test", handler })

    const consumeCallback = mockChannel.consume.mock.calls[0][1]
    await consumeCallback(null)
    expect(handler).not.toHaveBeenCalled()
  })
})

describe("close", () => {
  it("closes channel and connection", async () => {
    await publish({ routingKey: "test", payload: { data: "test" } })
    await close()
    expect(mockChannel.close).toHaveBeenCalled()
    expect(mockConnection.close).toHaveBeenCalled()
  })
})

describe("dispatch.findBestProvider", () => {
  it("returns null when service not found", async () => {
    mockDb.service.findUnique.mockResolvedValue(null)
    expect(await findBestProvider("service-1", -23.5, -46.6)).toBeNull()
  })

  it("returns null when provider is inactive", async () => {
    mockDb.service.findUnique.mockResolvedValue({ provider: { active: false } })
    expect(await findBestProvider("service-1", -23.5, -46.6)).toBeNull()
  })

  it("returns null when provider has no location data", async () => {
    mockDb.service.findUnique.mockResolvedValue({ provider: { active: true, lat: null, lng: null, radiusKm: null } })
    expect(await findBestProvider("service-1", -23.5, -46.6)).toBeNull()
  })

  it("returns null when provider is outside radius", async () => {
    mockDb.service.findUnique.mockResolvedValue({
      provider: { active: true, lat: -23.5, lng: -46.6, radiusKm: 10, reviewsReceived: [], availability: [], _count: { bookingsAsProvider: 0 }, id: "prov-1", name: "P1" },
    })
    vi.mocked(getRoute).mockResolvedValue({ distanceKm: 50, durationMin: 60 })
    expect(await findBestProvider("service-1", -23.5, -46.6)).toBeNull()
  })

  it("returns provider data when within radius", async () => {
    mockDb.service.findUnique.mockResolvedValue({
      provider: { id: "prov-1", name: "Maria", active: true, lat: -23.5, lng: -46.6, radiusKm: 50, reviewsReceived: [{ rating: 5 }, { rating: 4 }], availability: [], _count: { bookingsAsProvider: 0 } },
    })
    vi.mocked(getRoute).mockResolvedValue({ distanceKm: 5, durationMin: 15 })

    const result = await findBestProvider("service-1", -23.5, -46.6)
    expect(result!.providerId).toBe("prov-1")
    expect(result!.rating).toBe(4.5)
    expect(result!.distanceKm).toBe(5)
  })

  it("calculates rating as 0 when no reviews", async () => {
    mockDb.service.findUnique.mockResolvedValue({
      provider: { id: "prov-1", name: "No Reviews", active: true, lat: -23.5, lng: -46.6, radiusKm: 50, reviewsReceived: [], availability: [], _count: { bookingsAsProvider: 0 } },
    })
    vi.mocked(getRoute).mockResolvedValue({ distanceKm: 3, durationMin: 10 })
    expect((await findBestProvider("service-1", -23.5, -46.6))!.rating).toBe(0)
  })
})

describe("dispatch.findBestProviders", () => {
  it("returns empty array when service not found", async () => {
    mockDb.service.findUnique.mockResolvedValue(null)
    expect(await findBestProviders("service-1", -23.5, -46.6)).toEqual([])
  })

  it("filters and scores providers correctly", async () => {
    mockDb.service.findUnique.mockResolvedValue({ id: "service-1", categoryId: "cat-1", provider: { active: true } })
    mockDb.$queryRaw.mockResolvedValue([{ id: "prov-1" }, { id: "prov-2" }])
    mockDb.user.findMany.mockResolvedValue([
      { id: "prov-1", name: "P1", active: true, lat: -23.5, lng: -46.6, radiusKm: 50, reviewsReceived: [{ rating: 5 }], _count: { bookingsAsProvider: 0 } },
      { id: "prov-2", name: "P2", active: true, lat: -23.55, lng: -46.65, radiusKm: 30, reviewsReceived: [{ rating: 4 }], _count: { bookingsAsProvider: 0 } },
    ])
    vi.mocked(getMultiRoute).mockResolvedValue([
      { distanceKm: 5, durationMin: 15 },
      { distanceKm: 3, durationMin: 10 },
    ])

    const result = await findBestProviders("service-1", -23.5, -46.6)
    expect(result).toHaveLength(2)
    expect(result[0].providerId).toBe("prov-1") // score: 5*10 - 5 = 45
    expect(result[1].providerId).toBe("prov-2") // score: 4*10 - 3 = 37
  })

  it("respects limit parameter", async () => {
    mockDb.service.findUnique.mockResolvedValue({ id: "service-1", categoryId: "cat-1", provider: { active: true } })
    mockDb.$queryRaw.mockResolvedValue([{ id: "p1" }, { id: "p2" }, { id: "p3" }])
    // lat/lng must be truthy (positive non-zero) to pass the !p.lat guard
    mockDb.user.findMany.mockResolvedValue([
      { id: "p1", name: "P1", active: true, lat: 1, lng: 1, radiusKm: 100, reviewsReceived: [], _count: { bookingsAsProvider: 0 } },
      { id: "p2", name: "P2", active: true, lat: 1, lng: 1, radiusKm: 100, reviewsReceived: [], _count: { bookingsAsProvider: 0 } },
      { id: "p3", name: "P3", active: true, lat: 1, lng: 1, radiusKm: 100, reviewsReceived: [], _count: { bookingsAsProvider: 0 } },
    ])
    vi.mocked(getMultiRoute).mockResolvedValue([
      { distanceKm: 1, durationMin: 5 },
      { distanceKm: 1, durationMin: 5 },
      { distanceKm: 1, durationMin: 5 },
    ])
    expect(await findBestProviders("service-1", 1, 1, 2)).toHaveLength(2)
  })
})

describe("dispatchBooking", () => {
  it("queues notifications for both client and provider", async () => {
    mockDb.booking.findUnique.mockResolvedValue({
      id: "book-1", providerId: "prov-1", clientId: "client-1",
      scheduledAt: new Date("2026-07-20T14:00:00Z"),
      provider: { name: "Maria Souza" }, client: { name: "João Silva" },
    })

    await dispatchBooking("book-1")

    expect(saveAndQueueNotification).toHaveBeenCalledTimes(2)
    expect(saveAndQueueNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: "prov-1", type: "BOOKING_ASSIGNED" }))
    expect(saveAndQueueNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: "client-1", type: "BOOKING_CONFIRMED" }))
  })

  it("does nothing when booking not found", async () => {
    mockDb.booking.findUnique.mockResolvedValue(null)
    await dispatchBooking("nonexistent")
    expect(saveAndQueueNotification).not.toHaveBeenCalled()
  })
})
