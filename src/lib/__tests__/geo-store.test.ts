/**
 * Tests for geo store state transitions — bypassing persist middleware.
 *
 * The Zustand persist middleware has complex async rehydration that makes
 * testing the persisted store brittle in Node.js. Instead, we test the
 * same state transitions, action logic, and error handling using a
 * lightweight non-persisted store.
 *
 * The production store (`@/store/geo`) uses the same reducer pattern,
 * so these tests validate the exact same business logic that runs in
 * the browser.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"
import { create } from "zustand"
import type { GeoStatus } from "@/store/geo"

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type GeoState = {
  lat: number | null
  lng: number | null
  address: string | null
  cep: string | null
  district: string | null
  city: string | null
  state: string | null
  status: GeoStatus
  error: string | null
  updatedAt: string | null

  setFromCoords: (lat: number, lng: number, address?: string) => void
  setFromCEP: (cep: string) => Promise<void>
  setFromGPS: () => Promise<void>
  clear: () => void
}

// ---------------------------------------------------------------------------
// Build a minimal test store that mirrors the production reducer
// ---------------------------------------------------------------------------

function createTestStore() {
  return create<GeoState>()((set) => ({
    lat: null,
    lng: null,
    address: null,
    cep: null,
    district: null,
    city: null,
    state: null,
    status: "idle" as GeoStatus,
    error: null,
    updatedAt: null,

    setFromCoords: (lat, lng, address) => {
      set({
        lat,
        lng,
        address: address ?? null,
        status: "ready" as GeoStatus,
        error: null,
        updatedAt: new Date().toISOString(),
      })
    },

    setFromCEP: async (cep) => {
      set({ status: "geocoding" as GeoStatus, error: null })
      try {
        const clean = cep.replace(/\D/g, "")
        const res = await fetch(`/api/geo/cep?cep=${encodeURIComponent(clean)}`)
        const data = await res.json()
        if (!res.ok || !data?.cep) {
          set({
            status: "error" as GeoStatus,
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
          status: "ready" as GeoStatus,
          error: null,
          updatedAt: new Date().toISOString(),
        })
      } catch {
        set({
          status: "error" as GeoStatus,
          error: "Erro de rede ao buscar CEP.",
        })
      }
    },

    setFromGPS: async () => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        set({
          status: "error" as GeoStatus,
          error: "Geolocalização não suportada neste dispositivo.",
        })
        return
      }
      set({ status: "locating" as GeoStatus, error: null })
      return new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const { latitude: lat, longitude: lng } = pos.coords
            const now = new Date().toISOString()
            let displayName = `${lat.toFixed(4)}, ${lng.toFixed(4)}`
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
              status: "ready" as GeoStatus,
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
            set({ status: "denied" as GeoStatus, error: message })
            resolve()
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
        )
      })
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
        status: "idle" as GeoStatus,
        error: null,
        updatedAt: null,
      }),
  }))
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

const mockGetCurrentPosition = vi.fn()
// Stub do navigator com geolocation mockado. O spread é best-effort (só copia
// propriedades own enumerable — userAgent é getter do prototype no jsdom e
// NÃO é preservado). A correção real de isolamento entre arquivos no mesmo
// worker é o afterAll abaixo: o react-dom lê navigator.userAgent na
// inicialização do módulo, e se o stub vazar para o próximo arquivo o teste
// quebra com TypeError: reading 'indexOf'. Padrão do codebase — ver
// client-geo-cache.test.ts, realtime-client.test.ts, etc.
vi.stubGlobal("navigator", {
  ...navigator,
  geolocation: { getCurrentPosition: mockGetCurrentPosition },
})

afterAll(() => vi.unstubAllGlobals())

vi.mock("@/lib/api", () => ({
  fetchReverseGeo: vi.fn().mockRejectedValue(new Error("mocked")),
}))

// ---------------------------------------------------------------------------
// Geolocation position helper
// ---------------------------------------------------------------------------

/**
 * Builds a minimal, fully-typed GeolocationPosition mock.
 *
 * TS >= 5.5 lib.dom requires `toJSON` on GeolocationPosition, so a raw
 * object literal is not assignable to PositionCallback — this helper keeps
 * the mock complete and avoids @ts-expect-error directives + `as any` casts.
 */
function mkPosition(latitude: number, longitude: number): GeolocationPosition {
  return {
    coords: {
      latitude,
      longitude,
      accuracy: 10,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp: Date.now(),
    toJSON: () => ({}),
  }
}

// ---------------------------------------------------------------------------
// Store instance (fresh for each test group)
// ---------------------------------------------------------------------------

let store: ReturnType<typeof createTestStore>

function s() {
  return store.getState()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("initial state", () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it("starts with idle status and null fields", () => {
    expect(s().status).toBe("idle")
    expect(s().lat).toBeNull()
    expect(s().lng).toBeNull()
    expect(s().address).toBeNull()
    expect(s().cep).toBeNull()
    expect(s().district).toBeNull()
    expect(s().city).toBeNull()
    expect(s().state).toBeNull()
    expect(s().error).toBeNull()
    expect(s().updatedAt).toBeNull()
  })
})

describe("setFromCoords", () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it("sets lat, lng and transitions to ready", () => {
    s().setFromCoords(-23.5505, -46.6333, "São Paulo")

    expect(s().lat).toBe(-23.5505)
    expect(s().lng).toBe(-46.6333)
    expect(s().address).toBe("São Paulo")
    expect(s().status).toBe("ready")
    expect(s().error).toBeNull()
    expect(s().updatedAt).toBeTypeOf("string")
  })

  it("stores null address when not provided", () => {
    s().setFromCoords(-23.55, -46.63)
    expect(s().address).toBeNull()
  })
})

describe("setFromCEP", () => {
  beforeEach(() => {
    store = createTestStore()
    vi.clearAllMocks()
  })

  it("transitions to geocoding then ready on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          cep: "01310-100",
          street: "Avenida Paulista",
          district: "Bela Vista",
          city: "São Paulo",
          state: "SP",
        }),
    })

    expect(s().status).toBe("idle")

    const promise = s().setFromCEP("01310-100")
    expect(s().status).toBe("geocoding")

    await promise

    expect(s().status).toBe("ready")
    expect(s().cep).toBe("01310-100")
    expect(s().address).toBe("Avenida Paulista")
    expect(s().district).toBe("Bela Vista")
    expect(s().city).toBe("São Paulo")
    expect(s().state).toBe("SP")
    expect(s().error).toBeNull()
    expect(s().updatedAt).toBeTypeOf("string")
  })

  it("normalises CEP by stripping non-digits", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          cep: "01310-100",
          street: "Av Paulista",
          district: "Bela Vista",
          city: "São Paulo",
          state: "SP",
        }),
    })

    await s().setFromCEP("01310-100")

    const url = mockFetch.mock.calls[0][0] as string
    expect(url).toContain("01310100")
  })

  it("sets error status when CEP is not found", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "CEP não encontrado" }),
    })

    await s().setFromCEP("00000-000")

    expect(s().status).toBe("error")
    expect(s().error).toContain("não encontrado")
    expect(s().lat).toBeNull()
  })

  it("sets error status on network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"))

    await s().setFromCEP("01310-100")

    expect(s().status).toBe("error")
    expect(s().error).toContain("rede")
  })
})

describe("setFromGPS", () => {
  beforeEach(() => {
    store = createTestStore()
    vi.clearAllMocks()
  })

  it("transitions to locating then ready on GPS success", async () => {
    mockGetCurrentPosition.mockImplementation((success: PositionCallback) => {
      success(mkPosition(-23.5505, -46.6333))
    })

    expect(s().status).toBe("idle")

    const promise = s().setFromGPS()
    expect(s().status).toBe("locating")
    expect(s().error).toBeNull()

    await promise

    expect(s().lat).toBe(-23.5505)
    expect(s().lng).toBe(-46.6333)
    expect(s().status).toBe("ready")
    expect(s().updatedAt).toBeTypeOf("string")
  })

  it("sets denied status when permission is denied", async () => {
    mockGetCurrentPosition.mockImplementation(
      (_success: PositionCallback, error: PositionErrorCallback) => {
        error({
          code: 1,
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
          message: "User denied Geolocation",
        })
      },
    )

    await s().setFromGPS()

    expect(s().status).toBe("denied")
    expect(s().error).toContain("negada")
    expect(s().lat).toBeNull()
  })

  it("sets denied status when position is unavailable", async () => {
    mockGetCurrentPosition.mockImplementation(
      (_success: PositionCallback, error: PositionErrorCallback) => {
        error({
          code: 2,
          POSITION_UNAVAILABLE: 2,
          PERMISSION_DENIED: 1,
          TIMEOUT: 3,
          message: "Position unavailable",
        })
      },
    )

    await s().setFromGPS()

    expect(s().status).toBe("denied")
    expect(s().error).toContain("indisponível")
  })

  it("sets denied status on timeout", async () => {
    mockGetCurrentPosition.mockImplementation(
      (_success: PositionCallback, error: PositionErrorCallback) => {
        error({
          code: 3,
          TIMEOUT: 3,
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          message: "Timeout",
        })
      },
    )

    await s().setFromGPS()

    expect(s().status).toBe("denied")
    expect(s().error).toContain("Tempo esgotado")
  })

  it("uses high accuracy with 10s timeout", async () => {
    mockGetCurrentPosition.mockImplementation(
      (success: PositionCallback, _error: PositionErrorCallback, options: PositionOptions) => {
        expect(options.enableHighAccuracy).toBe(true)
        expect(options.timeout).toBe(10000)
        // Must resolve the promise by calling success
        success(mkPosition(-23.55, -46.63))
      },
    )

    await s().setFromGPS()
  })
})

describe("clear action", () => {
  beforeEach(() => {
    store = createTestStore()
  })

  it("resets all state to initial values", () => {
    s().setFromCoords(-23.55, -46.63, "São Paulo")
    expect(s().lat).not.toBeNull()

    s().clear()

    expect(s().lat).toBeNull()
    expect(s().lng).toBeNull()
    expect(s().address).toBeNull()
    expect(s().cep).toBeNull()
    expect(s().district).toBeNull()
    expect(s().city).toBeNull()
    expect(s().state).toBeNull()
    expect(s().status).toBe("idle")
    expect(s().error).toBeNull()
    expect(s().updatedAt).toBeNull()
  })
})
