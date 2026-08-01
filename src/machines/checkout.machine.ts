import { setup } from "xstate"

export type CheckoutContext = {
  providerId: string | null
  serviceId: string | null
  scheduledAt: string | null
  address: string | null
  cep: string | null
  lat: number | null
  lng: number | null
  paymentMethod: "PIX" | "CARD" | null
  amount: number | null
  notes: string | null
  error: string | null
}

export type CheckoutEvent =
  | { type: "NEXT" }
  | { type: "BACK" }
  | { type: "SET_ADDRESS"; data: { address: string; cep: string; lat: number; lng: number } }
  | { type: "SET_PAYMENT"; data: { paymentMethod: "PIX" | "CARD" } }
  | { type: "SET_SERVICE"; data: { providerId: string; serviceId: string; amount: number } }
  | { type: "SET_SCHEDULE"; data: { scheduledAt: string } }
  | { type: "SET_NOTES"; data: { notes: string } }
  | { type: "SUBMIT" }
  | { type: "ERROR"; data: { error: string } }
  | { type: "RETRY" }
  | { type: "RESET" }

export const checkoutMachine = setup({
  types: {
    context: {} as CheckoutContext,
    events: {} as CheckoutEvent,
  },
  guards: {
    hasAddress: ({ context, event }) => {
      if (event.type === "SET_ADDRESS") {
        return !!event.data.cep && !!event.data.lat && !!event.data.lng
      }
      return !!context.cep && !!context.lat && !!context.lng
    },
    hasPayment: ({ context, event }) => {
      if (event.type === "SET_PAYMENT") {
        return !!event.data.paymentMethod
      }
      return !!context.paymentMethod
    },
    hasService: ({ context, event }) => {
      if (event.type === "SET_SERVICE") {
        return !!event.data.serviceId && !!event.data.providerId
      }
      return !!context.serviceId && !!context.providerId
    },
    hasSchedule: ({ context, event }) => {
      if (event.type === "SET_SCHEDULE") {
        return !!event.data.scheduledAt
      }
      return !!context.scheduledAt
    },
  },
  actions: {
    clearError: ({ context }) => {
      context.error = null
    },
    setError: ({ context, event }) => {
      if (event.type === "ERROR") {
        context.error = event.data.error
      }
    },
    setAddress: ({ context, event }) => {
      if (event.type === "SET_ADDRESS") {
        context.address = event.data.address
        context.cep = event.data.cep
        context.lat = event.data.lat
        context.lng = event.data.lng
      }
    },
    setPayment: ({ context, event }) => {
      if (event.type === "SET_PAYMENT") {
        context.paymentMethod = event.data.paymentMethod
      }
    },
    setService: ({ context, event }) => {
      if (event.type === "SET_SERVICE") {
        context.providerId = event.data.providerId
        context.serviceId = event.data.serviceId
        context.amount = event.data.amount
      }
    },
    setSchedule: ({ context, event }) => {
      if (event.type === "SET_SCHEDULE") {
        context.scheduledAt = event.data.scheduledAt
      }
    },
    setNotes: ({ context, event }) => {
      if (event.type === "SET_NOTES") {
        context.notes = event.data.notes
      }
    },
    resetContext: ({ context }) => {
      context.providerId = null
      context.serviceId = null
      context.scheduledAt = null
      context.address = null
      context.cep = null
      context.lat = null
      context.lng = null
      context.paymentMethod = null
      context.amount = null
      context.notes = null
      context.error = null
    },
  },
}).createMachine({
  id: "checkout",
  initial: "cart",
  context: {
    providerId: null,
    serviceId: null,
    scheduledAt: null,
    address: null,
    cep: null,
    lat: null,
    lng: null,
    paymentMethod: null,
    amount: null,
    notes: null,
    error: null,
  },
  states: {
    cart: {
      on: {
        SET_SERVICE: {
          target: "address",
          actions: "setService",
        },
      },
    },
    address: {
      entry: "clearError",
      on: {
        SET_ADDRESS: {
          target: "payment",
          actions: "setAddress",
          guard: "hasAddress",
        },
        SET_SCHEDULE: {
          actions: "setSchedule",
        },
        BACK: { target: "cart" },
      },
    },
    payment: {
      entry: "clearError",
      on: {
        SET_PAYMENT: {
          target: "review",
          actions: "setPayment",
          guard: "hasPayment",
        },
        SET_ADDRESS: {
          actions: "setAddress",
          guard: "hasAddress",
        },
        BACK: { target: "address" },
      },
    },
    review: {
      entry: "clearError",
      on: {
        SET_NOTES: { actions: "setNotes" },
        SUBMIT: {
          target: "submitting",
          guard: "hasService",
        },
        BACK: { target: "payment" },
      },
    },
    submitting: {
      on: {
        ERROR: { target: "error", actions: "setError" },
      },
      after: {
        "5000": { target: "confirmed" },
      },
    },
    confirmed: {
      type: "final",
      on: {
        RESET: { target: "cart", actions: "resetContext" },
      },
    },
    error: {
      on: {
        RETRY: { target: "submitting", actions: "clearError" },
        BACK: { target: "review", actions: "clearError" },
        RESET: { target: "cart", actions: "resetContext" },
      },
    },
  },
})
