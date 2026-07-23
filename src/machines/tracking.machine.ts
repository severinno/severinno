import { setup } from "xstate"

export type TrackingContext = {
  bookingId: string | null
  providerId: string | null
  clientId: string | null
  providerLat: number | null
  providerLng: number | null
  serviceLat: number | null
  serviceLng: number | null
  scheduledAt: string | null
  etdMin: number | null
  error: string | null
}

export type TrackingEvent =
  | { type: "ASSIGN"; data: { bookingId: string; providerId: string; clientId: string; scheduledAt: string } }
  | { type: "PROVIDER_LOCATION"; data: { lat: number; lng: number } }
  | { type: "SERVICE_LOCATION"; data: { lat: number; lng: number } }
  | { type: "EN_ROUTE"; data: { etdMin: number } }
  | { type: "ARRIVED" }
  | { type: "START" }
  | { type: "COMPLETE" }
  | { type: "CANCEL" }
  | { type: "ERROR"; data: { error: string } }
  | { type: "RESET" }

export const trackingMachine = setup({
  types: {
    context: {} as TrackingContext,
    events: {} as TrackingEvent,
  },
  guards: {
    hasLocation: ({ context, event }) => {
      if (event.type === "SERVICE_LOCATION") {
        return !!event.data.lat && !!event.data.lng
      }
      return !!context.serviceLat && !!context.serviceLng
    },
    hasProvider: ({ context }) => !!context.providerId,
    hasEtd: ({ context, event }) => {
      if (event.type === "EN_ROUTE") {
        return !!event.data.etdMin
      }
      return !!context.etdMin
    },
  },
  actions: {
    assignBooking: ({ context, event }) => {
      if (event.type === "ASSIGN") {
        context.bookingId = event.data.bookingId
        context.providerId = event.data.providerId
        context.clientId = event.data.clientId
        context.scheduledAt = event.data.scheduledAt
      }
    },
    setProviderLocation: ({ context, event }) => {
      if (event.type === "PROVIDER_LOCATION") {
        context.providerLat = event.data.lat
        context.providerLng = event.data.lng
      }
    },
    setServiceLocation: ({ context, event }) => {
      if (event.type === "SERVICE_LOCATION") {
        context.serviceLat = event.data.lat
        context.serviceLng = event.data.lng
      }
    },
    setEtd: ({ context, event }) => {
      if (event.type === "EN_ROUTE") {
        context.etdMin = event.data.etdMin
      }
    },
    clearError: ({ context }) => {
      context.error = null
    },
    setError: ({ context, event }) => {
      if (event.type === "ERROR") {
        context.error = event.data.error
      }
    },
    resetAll: ({ context }) => {
      context.bookingId = null
      context.providerId = null
      context.clientId = null
      context.providerLat = null
      context.providerLng = null
      context.serviceLat = null
      context.serviceLng = null
      context.scheduledAt = null
      context.etdMin = null
      context.error = null
    },
  },
}).createMachine({
  id: "tracking",
  initial: "idle",
  context: {
    bookingId: null,
    providerId: null,
    clientId: null,
    providerLat: null,
    providerLng: null,
    serviceLat: null,
    serviceLng: null,
    scheduledAt: null,
    etdMin: null,
    error: null,
  },
  states: {
    idle: {
      on: {
        ASSIGN: {
          target: "assigned",
          actions: "assignBooking" as any,
        },
      },
    },
    assigned: {
      entry: "clearError" as any,
      on: {
        SERVICE_LOCATION: {
          actions: "setServiceLocation" as any,
          guard: "hasLocation",
        },
        EN_ROUTE: {
          target: "en_route",
          actions: "setEtd" as any,
          guard: "hasEtd",
        },
        CANCEL: { target: "cancelled" },
      },
    },
    en_route: {
      entry: "clearError" as any,
      on: {
        PROVIDER_LOCATION: {
          actions: "setProviderLocation" as any,
        },
        ARRIVED: { target: "arrived" },
        CANCEL: { target: "cancelled" },
      },
    },
    arrived: {
      entry: "clearError" as any,
      on: {
        START: { target: "in_progress" },
        CANCEL: { target: "cancelled" },
      },
    },
    in_progress: {
      entry: "clearError" as any,
      on: {
        COMPLETE: { target: "completed" },
        ERROR: { target: "error", actions: "setError" as any },
      },
    },
    completed: {
      type: "final",
      on: {
        RESET: { target: "idle", actions: "resetAll" as any },
      },
    },
    cancelled: {
      on: {
        RESET: { target: "idle", actions: "resetAll" as any },
      },
    },
    error: {
      on: {
        RESET: { target: "idle", actions: "resetAll" as any },
      },
    },
  },
})
