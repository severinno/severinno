"use client"

import { useMachine } from "@xstate/react"
import { trackingMachine } from "../machines/tracking.machine"
import type { TrackingContext } from "../machines/tracking.machine"
import { useRealtime } from "./use-realtime"

export function useTracking() {
  const [snapshot, send] = useMachine(trackingMachine)
  const { sendTrackingPosition } = useRealtime()

  const state = snapshot.value as string
  const ctx = snapshot.context as TrackingContext

  return {
    state,
    context: ctx,
    isIdle: state === "idle",
    isAssigned: state === "assigned",
    isEnRoute: state === "en_route",
    isArrived: state === "arrived",
    isInProgress: state === "in_progress",
    isCompleted: state === "completed",
    isCancelled: state === "cancelled",
    isError: state === "error",

    assign(data: { bookingId: string; providerId: string; clientId: string; scheduledAt: string }) {
      send({ type: "ASSIGN", data })
    },

    setServiceLocation(lat: number, lng: number) {
      send({ type: "SERVICE_LOCATION", data: { lat, lng } })
    },

    setProviderLocation(lat: number, lng: number) {
      send({ type: "PROVIDER_LOCATION", data: { lat, lng } })
      if (ctx.clientId) {
        sendTrackingPosition({
          bookingId: ctx.bookingId ?? "",
          clientId: ctx.clientId,
          lat,
          lng,
        })
      }
    },

    enRoute(etdMin: number) {
      send({ type: "EN_ROUTE", data: { etdMin } })
    },

    arrived() {
      send({ type: "ARRIVED" })
    },

    start() {
      send({ type: "START" })
    },

    complete() {
      send({ type: "COMPLETE" })
    },

    cancel() {
      send({ type: "CANCEL" })
    },

    reset() {
      send({ type: "RESET" })
    },
  }
}
