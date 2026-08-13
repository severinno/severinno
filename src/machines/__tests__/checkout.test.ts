/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest"
import { createActor } from "xstate"
import { checkoutMachine } from "../checkout.machine"

describe("checkoutMachine", () => {
  it("executes happy path workflow successfully", () => {
    const actor = createActor(checkoutMachine).start()

    // 1. Initial state is 'cart'
    expect(actor.getSnapshot().value).toBe("cart")

    // 2. Transition to 'address' by setting service
    actor.send({
      type: "SET_SERVICE",
      data: { providerId: "prov-1", serviceId: "srv-1", amount: 150.0 },
    })

    const snapshotAfterCart = actor.getSnapshot()
    expect(snapshotAfterCart.value).toBe("address")
    expect(snapshotAfterCart.context).toMatchObject({
      providerId: "prov-1",
      serviceId: "srv-1",
      amount: 150.0,
    })

    // 3. Set schedule (does not change state)
    actor.send({
      type: "SET_SCHEDULE",
      data: { scheduledAt: "2026-07-24T10:00:00Z" },
    })
    expect(actor.getSnapshot().value).toBe("address")
    expect(actor.getSnapshot().context.scheduledAt).toBe("2026-07-24T10:00:00Z")

    // 4. Transition to 'payment' by setting valid address
    actor.send({
      type: "SET_ADDRESS",
      data: { address: "Rua A, 123", cep: "01001-000", lat: -23.55, lng: -46.63 },
    })

    const snapshotAfterAddress = actor.getSnapshot()
    expect(snapshotAfterAddress.value).toBe("payment")
    expect(snapshotAfterAddress.context).toMatchObject({
      address: "Rua A, 123",
      cep: "01001-000",
      lat: -23.55,
      lng: -46.63,
    })

    // 5. Transition to 'review' by setting payment
    actor.send({
      type: "SET_PAYMENT",
      data: { paymentMethod: "PIX" },
    })

    const snapshotAfterPayment = actor.getSnapshot()
    expect(snapshotAfterPayment.value).toBe("review")
    expect(snapshotAfterPayment.context.paymentMethod).toBe("PIX")

    // 6. Set notes (does not change state)
    actor.send({
      type: "SET_NOTES",
      data: { notes: "Leave key at door" },
    })
    expect(actor.getSnapshot().value).toBe("review")
    expect(actor.getSnapshot().context.notes).toBe("Leave key at door")

    // 7. Submit to transition to 'submitting'
    actor.send({ type: "SUBMIT" })
    expect(actor.getSnapshot().value).toBe("submitting")
  })

  it("respects guards (cannot transition without satisfying conditions)", () => {
    const actor = createActor(checkoutMachine).start()

    // Transition to address
    actor.send({
      type: "SET_SERVICE",
      data: { providerId: "prov-1", serviceId: "srv-1", amount: 150.0 },
    })

    // Try to transition to payment with incomplete address data
    actor.send({
      type: "SET_ADDRESS",
      data: { address: "", cep: "", lat: 0, lng: 0 },
    })

    // Guard hasAddress should prevent transition
    expect(actor.getSnapshot().value).toBe("address")
  })

  it("handles back buttons and resets correctly", () => {
    const actor = createActor(checkoutMachine).start()

    // Cart -> Address
    actor.send({
      type: "SET_SERVICE",
      data: { providerId: "prov-1", serviceId: "srv-1", amount: 150.0 },
    })
    expect(actor.getSnapshot().value).toBe("address")

    // Address -> Cart (via BACK)
    actor.send({ type: "BACK" })
    expect(actor.getSnapshot().value).toBe("cart")

    // Back to Address
    actor.send({
      type: "SET_SERVICE",
      data: { providerId: "prov-1", serviceId: "srv-1", amount: 150.0 },
    })

    // Address -> Payment
    actor.send({
      type: "SET_ADDRESS",
      data: { address: "Rua A", cep: "01001-000", lat: -23.55, lng: -46.63 },
    })
    expect(actor.getSnapshot().value).toBe("payment")

    // Payment -> Address (via BACK)
    actor.send({ type: "BACK" })
    expect(actor.getSnapshot().value).toBe("address")
  })

  it("handles error state and retries", () => {
    const actor = createActor(checkoutMachine).start()

    // Cart -> Address -> Payment -> Review -> Submitting
    actor.send({
      type: "SET_SERVICE",
      data: { providerId: "prov-1", serviceId: "srv-1", amount: 150.0 },
    })
    actor.send({
      type: "SET_ADDRESS",
      data: { address: "Rua A", cep: "01001-000", lat: -23.55, lng: -46.63 },
    })
    actor.send({
      type: "SET_PAYMENT",
      data: { paymentMethod: "CARD" },
    })
    actor.send({ type: "SUBMIT" })
    expect(actor.getSnapshot().value).toBe("submitting")

    // Simulate error response
    actor.send({
      type: "ERROR",
      data: { error: "Failed to process payment" },
    })
    expect(actor.getSnapshot().value).toBe("error")
    expect(actor.getSnapshot().context.error).toBe("Failed to process payment")

    // Retry transitions back to submitting
    actor.send({ type: "RETRY" })
    expect(actor.getSnapshot().value).toBe("submitting")
    expect(actor.getSnapshot().context.error).toBeNull()

    // Trigger error again, then reset back to cart
    actor.send({
      type: "ERROR",
      data: { error: "Network error" },
    })
    actor.send({ type: "RESET" })
    expect(actor.getSnapshot().value).toBe("cart")
    expect(actor.getSnapshot().context.providerId).toBeNull()
  })
})
