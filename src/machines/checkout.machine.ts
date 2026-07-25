import { setup, assign } from "xstate"

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
    clearError: assign({ error: null }),

    setError: assign(({ event }) => {
      if (event.type !== "ERROR") return {}
      return { error: event.data.error }
    }),

    setAddress: assign(({ event }) => {
      if (event.type !== "SET_ADDRESS") return {}
      return {
        address: event.data.address,
        cep: event.data.cep,
        lat: event.data.lat,
        lng: event.data.lng,
      }
    }),

    setPayment: assign(({ event }) => {
      if (event.type !== "SET_PAYMENT") return {}
      return { paymentMethod: event.data.paymentMethod }
    }),

    setService: assign(({ event }) => {
      if (event.type !== "SET_SERVICE") return {}
      return {
        providerId: event.data.providerId,
        serviceId: event.data.serviceId,
        amount: event.data.amount,
      }
    }),

    setSchedule: assign(({ event }) => {
      if (event.type !== "SET_SCHEDULE") return {}
      return { scheduledAt: event.data.scheduledAt }
    }),

    setNotes: assign(({ event }) => {
      if (event.type !== "SET_NOTES") return {}
      return { notes: event.data.notes }
    }),

    resetContext: assign({
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
    }),
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
