"use client"

import { useMachine } from "@xstate/react"
import { checkoutMachine, type CheckoutContext } from "@/machines/checkout.machine"

export function useCheckout() {
  const [snapshot, send] = useMachine(checkoutMachine)

  return {
    state: snapshot.value as CheckoutMachineState,
    context: snapshot.context as CheckoutContext,
    can: (event: string) => (snapshot as unknown as { nextEvents: string[] }).nextEvents.includes(event),
    isError: snapshot.value === "error",
    isConfirmed: snapshot.value === "confirmed",
    isSubmitting: snapshot.value === "submitting",
    error: snapshot.context.error,

    selectService: (data: { providerId: string; serviceId: string; amount: number }) =>
      send({ type: "SET_SERVICE", data }),

    setAddress: (data: { address: string; cep: string; lat: number; lng: number }) =>
      send({ type: "SET_ADDRESS", data }),

    setSchedule: (scheduledAt: string) =>
      send({ type: "SET_SCHEDULE", data: { scheduledAt } }),

    setPayment: (paymentMethod: "PIX" | "CARD") =>
      send({ type: "SET_PAYMENT", data: { paymentMethod } }),

    setNotes: (notes: string) =>
      send({ type: "SET_NOTES", data: { notes } }),

    submit: () => send({ type: "SUBMIT" }),

    back: () => send({ type: "BACK" }),

    retry: () => send({ type: "RETRY" }),

    reset: () => send({ type: "RESET" }),
  }
}

type CheckoutMachineState =
  | "cart"
  | "address"
  | "payment"
  | "review"
  | "submitting"
  | "confirmed"
  | "error"
