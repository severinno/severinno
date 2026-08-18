/**
 * geo-cache.test.tsx
 *
 * Tests the in-memory GLOBAL_CACHE of AddressAutocomplete (5 min TTL,
 * max 50 entries, FIFO eviction) through observable component behavior.
 *
 * The cache helpers are module-level (not exported), so these tests drive
 * them via the component: type → debounce → fetch. A cache hit is proven by
 * the API mock NOT being called on a second search of the same key.
 *
 * Coverage:
 *   ✅ Cache hit on identical re-search (no API call)
 *   ✅ Case-insensitive keys — "Rua Teste" == "rua teste"
 *   ✅ Leading/trailing whitespace trimmed — "  Rua Teste  " == "Rua Teste"
 *   ✅ Internal whitespace NOT collapsed — "Rua   Teste" ≠ "Rua Teste" (miss)
 *   ✅ FIFO eviction at CACHE_MAX (50) — oldest entry re-fetches
 *   ✅ Cache key normalization is trim + lowercase only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act, cleanup } from "@/__tests__/test-utils"
import AddressAutocomplete from "../address-autocomplete"

import { mockFetchGeoSearch, resetCommonMocks, flushDebounce } from "./test-utils"
import type { GeoSearchResult } from "@/lib/api"

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_RESULTS: GeoSearchResult[] = [
  {
    lat: -23.5505,
    lng: -46.6333,
    displayName: "Avenida Paulista, Bela Vista, São Paulo - SP, Brasil",
    street: "Avenida Paulista",
    district: "Bela Vista",
    city: "São Paulo",
    state: "SP",
    cep: "01310-100",
    type: "residential",
    category: "highway",
    importance: 0.8,
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function typeAndFlush(value: string) {
  const input = screen.getByRole("combobox")
  await act(async () => {
    fireEvent.change(input, { target: { value } })
  })
  await flushDebounce()
}

async function clearAndSettle(): Promise<void> {
  const input = screen.getByRole("combobox")
  await act(async () => {
    fireEvent.change(input, { target: { value: "" } })
  })
  await flushDebounce()
}

afterEach(() => {
  cleanup()
})

// ===========================================================================
// Cache normalization
// ===========================================================================

describe("AddressAutocomplete GLOBAL_CACHE — key normalization", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetCommonMocks()
    // Expira cache de testes anteriores (TTL = 5 min)
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000)
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)
  })

  it("serves from cache on identical re-search (no API call)", async () => {
    render(<AddressAutocomplete />)

    await typeAndFlush("Rua Cache Normal")
    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(1)

    await clearAndSettle()
    mockFetchGeoSearch.mockClear()
    await typeAndFlush("Rua Cache Normal")

    expect(mockFetchGeoSearch).not.toHaveBeenCalled()
    expect(screen.getByRole("listbox")).toBeTruthy()
  })

  it("treats keys as case-insensitive — 'RUA CACHE NORMAL' hits the cache", async () => {
    render(<AddressAutocomplete />)

    await typeAndFlush("Rua Cache Case")
    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(1)

    await clearAndSettle()
    mockFetchGeoSearch.mockClear()
    await typeAndFlush("RUA CACHE CASE")

    expect(mockFetchGeoSearch).not.toHaveBeenCalled()
    expect(screen.getByRole("listbox")).toBeTruthy()
  })

  it("does NOT collapse internal whitespace — 'Rua   Cache   Espaco' is a cache miss", async () => {
    render(<AddressAutocomplete />)

    await typeAndFlush("Rua Cache Espaco")
    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(1)

    await clearAndSettle()
    mockFetchGeoSearch.mockClear()
    await typeAndFlush("Rua   Cache   Espaco")

    // Key = trim().toLowerCase() only → different key, so it re-fetches
    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(1)
  })

  it("trims leading/trailing whitespace on the cache key", async () => {
    render(<AddressAutocomplete />)

    await typeAndFlush("Rua Cache Trim")
    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(1)

    await clearAndSettle()
    mockFetchGeoSearch.mockClear()
    await typeAndFlush("  Rua Cache Trim  ")

    // trim() only — "  Rua Cache Trim  " == "Rua Cache Trim"
    expect(mockFetchGeoSearch).not.toHaveBeenCalled()
  })

  it("does NOT reuse a cache entry across different terms", async () => {
    render(<AddressAutocomplete />)

    await typeAndFlush("Rua Diferente Um")
    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(1)

    await clearAndSettle()
    mockFetchGeoSearch.mockClear()
    await typeAndFlush("Rua Diferente Dois")

    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(1)
  })
})

// ===========================================================================
// FIFO eviction at CACHE_MAX (50)
// ===========================================================================

describe("AddressAutocomplete GLOBAL_CACHE — FIFO eviction", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetCommonMocks()
    // Expira cache de testes anteriores
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000)
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)
  })

  it("evicts the oldest entry after 50 distinct searches (re-fetches)", async () => {
    render(<AddressAutocomplete />)

    // Search 51 distinct terms → fills the cache (max 50) and evicts the first
    for (let i = 0; i < 51; i++) {
      await typeAndFlush(`Rua Evict ${String(i).padStart(2, "0")}`)
      await clearAndSettle()
    }

    // First term (oldest) was evicted → re-searching it hits the API again
    mockFetchGeoSearch.mockClear()
    await typeAndFlush("Rua Evict 00")
    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(1)

    // A recent term is still cached → no API call
    mockFetchGeoSearch.mockClear()
    await clearAndSettle()
    await typeAndFlush("Rua Evict 50")
    expect(mockFetchGeoSearch).not.toHaveBeenCalled()
  })
})
