"use client"

import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"

export type GeoStatus = "idle" | "locating" | "geocoding" | "ready" | "error" | "denied"

export type GeoState = {
  lat: number | null
  lng: number | null
  address: string | null
  cep: string | null
  district: string | null
  city: string | null
  state: string | null
  status: GeoStatus
  error: string | null
  /** ISO-8601 timestamp of when the location was last updated. */
  updatedAt: string | null

  setFromGPS: () => Promise<void>
  setFromCoords: (lat: number, lng: number, address?: string) => void
  setFromCEP: (cep: string) => Promise<void>
  clear: () => void
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

/** Check if the persisted geo data is older than 24h and should be cleared. */
function isStale(updatedAt: string | null): boolean {
  if (!updatedAt) return true
  return Date.now() - new Date(updatedAt).getTime() > TWENTY_FOUR_HOURS_MS
}

/** Build a display-name fallback from raw coordinates. */
function coordsToDisplayName(lat: number, lng: number): string {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`
}

export const useGeoStore = create<GeoState>()(
  persist(
    (set) => ({
      lat: null,
      lng: null,
      address: null,
      cep: null,
      district: null,
      city: null,
      state: null,
      status: "idle",
      error: null,
      updatedAt: null,

      setFromGPS: async () => {
        if (typeof navigator === "undefined" || !navigator.geolocation) {
          set({
            status: "error",
            error: "Geolocalização não suportada neste dispositivo.",
          })
          return
        }
        set({ status: "locating", error: null })
        return new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            async (pos) => {
              const { latitude: lat, longitude: lng } = pos.coords
              const now = new Date().toISOString()

              // Try reverse geocode to populate address fields
              let displayName = coordsToDisplayName(lat, lng)
              let city: string | null = null
              let state: string | null = null
              let district: string | null = null

              try {
                const { fetchReverseGeo } = await import("@/lib/api")
                const addr = await fetchReverseGeo(lat, lng)
                if (addr.displayName) displayName = addr.displayName
                city = addr.city ?? null
                state = addr.state ?? null
                district = addr.district ?? null
              } catch {
                // fallback: raw coordinates as display name
              }

              set({
                lat,
                lng,
                address: displayName,
                city,
                state,
                district,
                status: "ready",
                error: null,
                updatedAt: now,
              })
              resolve()
            },
            (err) => {
              const message =
                err.code === err.PERMISSION_DENIED
                  ? "Permissão de localização negada."
                  : err.code === err.POSITION_UNAVAILABLE
                    ? "Posição indisponível."
                    : err.code === err.TIMEOUT
                      ? "Tempo esgotado ao obter localização."
                      : "Erro ao obter localização."
              set({ status: "denied", error: message })
              resolve()
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
          )
        })
      },

      setFromCoords: (lat, lng, address) => {
        set({
          lat,
          lng,
          address: address ?? null,
          status: "ready",
          error: null,
          updatedAt: new Date().toISOString(),
        })
      },

      setFromCEP: async (cep) => {
        set({ status: "geocoding", error: null })
        try {
          const clean = cep.replace(/\D/g, "")
          const res = await fetch(`/api/geo/cep?cep=${encodeURIComponent(clean)}`)
          const data = await res.json()
          if (!res.ok || !data?.cep) {
            set({
              status: "error",
              error: data?.error || "CEP não encontrado.",
            })
            return
          }
          set({
            cep: data.cep,
            address: data.street ? `${data.street}` : null,
            district: data.district ?? null,
            city: data.city ?? null,
            state: data.state ?? null,
            status: "ready",
            error: null,
            updatedAt: new Date().toISOString(),
          })
        } catch {
          set({
            status: "error",
            error: "Erro de rede ao buscar CEP.",
          })
        }
      },

      clear: () =>
        set({
          lat: null,
          lng: null,
          address: null,
          cep: null,
          district: null,
          city: null,
          state: null,
          status: "idle",
          error: null,
          updatedAt: null,
        }),
    }),
    {
      name: "severinno:geo",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        lat: s.lat,
        lng: s.lng,
        address: s.address,
        cep: s.cep,
        district: s.district,
        city: s.city,
        state: s.state,
        status: s.status,
        updatedAt: s.updatedAt,
      }),
      // Expire stale data on rehydration
      onRehydrateStorage: () => (state) => {
        if (state && isStale(state.updatedAt)) {
          // Clear expired state by resetting to initial values
          // The store will re-render with empty location data
          useGeoStore.getState().clear()
        }
      },
    },
  ),
)
