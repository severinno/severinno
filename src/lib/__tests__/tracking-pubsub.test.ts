import { describe, it, expect, beforeEach } from "vitest"
import {
  publishTrackingEvent,
  subscribeTrackingEvents,
  __testing__resetTrackingPubsub,
} from "../tracking-pubsub"

describe("tracking-pubsub: Barramento Reativo de Telemetria", () => {
  beforeEach(() => {
    __testing__resetTrackingPubsub()
  })

  it("despacha eventos locais de telemetria instantaneamente via EventEmitter", async () => {
    const eventsReceived: Array<{ type: string; data: unknown }> = []

    const unsubscribe = subscribeTrackingEvents("book-123", (event) => {
      eventsReceived.push(event)
    })

    await publishTrackingEvent("book-123", {
      type: "position",
      data: { lat: -18.85, lng: -41.94, speed: 30 },
    })

    expect(eventsReceived.length).toBe(1)
    expect(eventsReceived[0].type).toBe("position")
    expect((eventsReceived[0].data as { lat: number }).lat).toBe(-18.85)

    // Cancela subscrição
    unsubscribe()

    await publishTrackingEvent("book-123", {
      type: "position",
      data: { lat: -18.851, lng: -41.941, speed: 25 },
    })

    // Não deve receber mais nenhum evento após unsubscribe
    expect(eventsReceived.length).toBe(1)
  })

  it("isola eventos de bookings diferentes", async () => {
    const booking1Events: string[] = []
    const booking2Events: string[] = []

    const unpub1 = subscribeTrackingEvents("book-A", (e) => booking1Events.push(e.type))
    const unpub2 = subscribeTrackingEvents("book-B", (e) => booking2Events.push(e.type))

    await publishTrackingEvent("book-A", { type: "position", data: {} })
    await publishTrackingEvent("book-B", { type: "status", data: { status: "IN_PROGRESS" } })

    expect(booking1Events).toEqual(["position"])
    expect(booking2Events).toEqual(["status"])

    unpub1()
    unpub2()
  })
})
