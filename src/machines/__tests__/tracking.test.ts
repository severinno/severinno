/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest"
import { createActor } from "xstate"
import { trackingMachine } from "../tracking.machine"

describe("trackingMachine", () => {
  it("executes happy path workflow successfully", () => {
    const actor = createActor(trackingMachine).start()

    // 1. Initial state is 'idle'
    expect(actor.getSnapshot().value).toBe("idle")

    // 2. ASSIGN event transitions to 'assigned'
    actor.send({
      type: "ASSIGN",
      data: {
        bookingId: "b-1",
        providerId: "p-1",
        clientId: "c-1",
        scheduledAt: "2026-07-24T12:00:00Z",
      },
    })

    const snapshotAssigned = actor.getSnapshot()
    expect(snapshotAssigned.value).toBe("assigned")
    expect(snapshotAssigned.context).toMatchObject({
      bookingId: "b-1",
      providerId: "p-1",
      clientId: "c-1",
      scheduledAt: "2026-07-24T12:00:00Z",
    })

    // 3. Update service location (does not change state)
    actor.send({
      type: "SERVICE_LOCATION",
      data: { lat: -23.55, lng: -46.63 },
    })
    expect(actor.getSnapshot().value).toBe("assigned")
    expect(actor.getSnapshot().context).toMatchObject({
      serviceLat: -23.55,
      serviceLng: -46.63,
    })

    // 4. Transition to 'en_route' by providing ETD
    actor.send({
      type: "EN_ROUTE",
      data: { etdMin: 15 },
    })
    expect(actor.getSnapshot().value).toBe("en_route")
    expect(actor.getSnapshot().context.etdMin).toBe(15)

    // 5. Update provider location (does not change state)
    actor.send({
      type: "PROVIDER_LOCATION",
      data: { lat: -23.54, lng: -46.62 },
    })
    expect(actor.getSnapshot().value).toBe("en_route")
    expect(actor.getSnapshot().context).toMatchObject({
      providerLat: -23.54,
      providerLng: -46.62,
    })

    // 6. ARRIVED event transitions to 'arrived'
    actor.send({ type: "ARRIVED" })
    expect(actor.getSnapshot().value).toBe("arrived")

    // 7. START event transitions to 'in_progress'
    actor.send({ type: "START" })
    expect(actor.getSnapshot().value).toBe("in_progress")

    // 8. COMPLETE event transitions to 'completed'
    actor.send({ type: "COMPLETE" })
    expect(actor.getSnapshot().value).toBe("completed")
  })

  it("respects guards (cannot transition to en_route without etdMin)", () => {
    const actor = createActor(trackingMachine).start()

    actor.send({
      type: "ASSIGN",
      data: {
        bookingId: "b-1",
        providerId: "p-1",
        clientId: "c-1",
        scheduledAt: "2026-07-24T12:00:00Z",
      },
    })

    // Send EN_ROUTE with empty or invalid etdMin (guard hasEtd)
    actor.send({
      type: "EN_ROUTE",
      data: { etdMin: 0 },
    })

    expect(actor.getSnapshot().value).toBe("assigned")
  })

  it("allows cancellation from assigned, en_route, or arrived states", () => {
    // Test cancel from 'assigned'
    const actor1 = createActor(trackingMachine).start()
    actor1.send({
      type: "ASSIGN",
      data: { bookingId: "b-1", providerId: "p-1", clientId: "c-1", scheduledAt: "2026" },
    })
    actor1.send({ type: "CANCEL" })
    expect(actor1.getSnapshot().value).toBe("cancelled")

    // Test cancel from 'en_route'
    const actor2 = createActor(trackingMachine).start()
    actor2.send({
      type: "ASSIGN",
      data: { bookingId: "b-1", providerId: "p-1", clientId: "c-1", scheduledAt: "2026" },
    })
    actor2.send({ type: "EN_ROUTE", data: { etdMin: 10 } })
    actor2.send({ type: "CANCEL" })
    expect(actor2.getSnapshot().value).toBe("cancelled")

    // Reset works from cancelled
    actor2.send({ type: "RESET" })
    expect(actor2.getSnapshot().value).toBe("idle")
    expect(actor2.getSnapshot().context.bookingId).toBeNull()
  })

  it("handles errors and resets context", () => {
    const actor = createActor(trackingMachine).start()

    actor.send({
      type: "ASSIGN",
      data: { bookingId: "b-1", providerId: "p-1", clientId: "c-1", scheduledAt: "2026" },
    })
    actor.send({ type: "EN_ROUTE", data: { etdMin: 10 } })
    actor.send({ type: "ARRIVED" })
    actor.send({ type: "START" })
    expect(actor.getSnapshot().value).toBe("in_progress")

    // Transition to error state
    actor.send({
      type: "ERROR",
      data: { error: "Something went wrong during execution" },
    })
    expect(actor.getSnapshot().value).toBe("error")
    expect(actor.getSnapshot().context.error).toBe("Something went wrong during execution")

    // RESET transitions back to idle and wipes context
    actor.send({ type: "RESET" })
    expect(actor.getSnapshot().value).toBe("idle")
    expect(actor.getSnapshot().context.bookingId).toBeNull()
    expect(actor.getSnapshot().context.error).toBeNull()
  })
})
