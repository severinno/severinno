import { vi, afterEach } from "vitest"
import { act, cleanup } from "@testing-library/react"
import type { GeoSearchResult } from "@/lib/api"

// ===========================================================================
// Re-export shared mock objects from vitest.setup (which registers vi.mock)
// The vitest.setup file must be imported BEFORE any component imports.
// ===========================================================================

export {
  mockGeoStore,
  mockFetchGeoSearch,
  mockFetchGeoSearchStructured,
  mockFetchReverseGeo,
  mockFetchCep,
  getMockToast,
  resetCommonMocks,
} from "./vitest.setup"

// ===========================================================================
// Mock data — shared across all test files
// ===========================================================================

export const MOCK_RESULTS: GeoSearchResult[] = [
  {
    lat: -23.5505,
    lng: -46.6333,
    displayName: "Avenida Paulista, Bela Vista, São Paulo - SP, Brasil",
    street: "Avenida Paulista",
    district: "Bela Vista",
    city: "São Paulo",
    state: "SP",
    cep: "01310-100",
    category: "highway",
    type: "residential",
    importance: 0.8,
  },
  {
    lat: -23.561,
    lng: -46.656,
    displayName: "Rua Augusta, Consolação, São Paulo - SP, Brasil",
    street: "Rua Augusta",
    district: "Consolação",
    city: "São Paulo",
    state: "SP",
    cep: "01304-001",
    category: "highway",
    type: "residential",
    importance: 0.2,
  },
]

// ===========================================================================
// Global cleanup — Vitest runs this after every test in every file that
// imports this module
// ===========================================================================

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

// ===========================================================================
// Helpers
// ===========================================================================

/** Advance past the 300 ms debounce & flush React + microtasks. */
export async function flushDebounce(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(300)
  })
}
