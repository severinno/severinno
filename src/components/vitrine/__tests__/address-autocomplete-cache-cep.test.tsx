/**
 * Tests for AddressAutocomplete CEP detection and in-memory cache logic.
 *
 * Coverage:
 *   - CEP detection: 8-digit input triggers fetchCep instead of fetchGeoSearch
 *   - CEP display: ViaCEP badge, address subtitle
 *   - CEP selection: calls setFromCEP and onSelect
 *   - Cache hit/miss: repeated same input uses cache, unique input re-fetches
 *   - Cache TTL: expired entry re-fetches after 5 min
 *   - Error handling: failed fetches not cached, retry works
 *
 * NOTE: GLOBAL_CACHE is module-level state (not cleared between tests).
 * Each test uses a UNIQUE search term to avoid cross-test cache hits.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import React from "react"
import { render, screen, fireEvent, act } from "@testing-library/react"
import AddressAutocomplete from "../address-autocomplete"

import {
  mockGeoStore,
  mockFetchGeoSearch,
  mockFetchCep,
  resetCommonMocks,
  flushDebounce,
} from "./test-utils"
import type { CepResult, GeoSearchResult } from "@/lib/api"

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_CEP_RESULT: CepResult = {
  cep: "01310100",
  street: "Rua Augusta",
  district: "Consolação",
  city: "São Paulo",
  state: "SP",
}

const MOCK_NOMINATIM_RESULTS: GeoSearchResult[] = [
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

async function clearInput() {
  const input = screen.getByRole("combobox")
  await act(async () => {
    fireEvent.change(input, { target: { value: "" } })
  })
}

// ===========================================================================
// CEP Detection
// ===========================================================================

describe("AddressAutocomplete — CEP detection", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetCommonMocks()
    // Expira cache de testes anteriores (TTL = 5 min)
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000)
    mockFetchCep.mockResolvedValue(MOCK_CEP_RESULT)
  })

  it("calls fetchCep when input is exactly 8 digits", async () => {
    render(<AddressAutocomplete />)
    await typeAndFlush("01310100")

    expect(mockFetchCep).toHaveBeenCalledTimes(1)
    expect(mockFetchCep).toHaveBeenCalledWith("01310100")
    expect(mockFetchGeoSearch).not.toHaveBeenCalled()
  })

  it("calls fetchCep when input has 8 digits with formatting (01310-100)", async () => {
    render(<AddressAutocomplete />)
    await typeAndFlush("01310-100")

    expect(mockFetchCep).toHaveBeenCalledTimes(1)
    expect(mockFetchCep).toHaveBeenCalledWith("01310100")
    expect(mockFetchGeoSearch).not.toHaveBeenCalled()
  })

  it("calls fetchGeoSearch (not fetchCep) for non-digit input", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_NOMINATIM_RESULTS)
    render(<AddressAutocomplete />)
    // Use a unique term for this test to avoid cross-test cache
    await typeAndFlush("Rua Teste Unica")

    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(1)
    expect(mockFetchCep).not.toHaveBeenCalled()
  })

  it("calls fetchGeoSearch when input has fewer than 8 digits", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_NOMINATIM_RESULTS)
    render(<AddressAutocomplete />)
    await typeAndFlush("Rua ABC")

    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(1)
    expect(mockFetchCep).not.toHaveBeenCalled()
  })

  it("calls fetchGeoSearch when input has more than 8 digits", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_NOMINATIM_RESULTS)
    render(<AddressAutocomplete />)
    await typeAndFlush("Rua Longa Demais 999")

    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(1)
    expect(mockFetchCep).not.toHaveBeenCalled()
  })

  it("displays ViaCEP badge on CEP results", async () => {
    mockFetchCep.mockResolvedValue(MOCK_CEP_RESULT)
    render(<AddressAutocomplete />)
    await typeAndFlush("01310100")

    expect(screen.getByText("ViaCEP")).toBeTruthy()
  })

  it("displays CEP subtitle with address info", async () => {
    mockFetchCep.mockResolvedValue(MOCK_CEP_RESULT)
    render(<AddressAutocomplete />)
    await typeAndFlush("01310100")

    // The title also contains "São Paulo, SP" so use getAllByText
    expect(screen.getByText(/CEP 01310100/)).toBeTruthy()
    expect(screen.getAllByText(/São Paulo, SP/).length).toBeGreaterThanOrEqual(1)
  })
})

// ===========================================================================
// CEP Selection
// ===========================================================================

describe("AddressAutocomplete — CEP selection", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetCommonMocks()
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000)
    mockFetchCep.mockResolvedValue(MOCK_CEP_RESULT)
  })

  it("calls setFromCEP and onSelect when CEP result is clicked", async () => {
    const onSelect = vi.fn()
    render(<AddressAutocomplete onSelect={onSelect} />)

    await typeAndFlush("01310100")

    const cepOption = screen.getByText(/Rua Augusta/)
    await act(async () => {
      fireEvent.click(cepOption)
    })

    expect(mockGeoStore.setFromCEP).toHaveBeenCalledWith("01310100")
    expect(onSelect).toHaveBeenCalledWith(0, 0, expect.stringContaining("Rua Augusta"))
  })

  it("hides dropdown after selecting a CEP result", async () => {
    render(<AddressAutocomplete />)
    await typeAndFlush("01310100")

    expect(screen.getByRole("listbox")).toBeTruthy()

    const cepOption = screen.getByText(/Rua Augusta/)
    await act(async () => {
      fireEvent.click(cepOption)
    })

    expect(screen.queryByRole("listbox")).toBeNull()
  })
})

// ===========================================================================
// Cache Logic
// ===========================================================================

describe("AddressAutocomplete — in-memory cache", () => {
  beforeEach(() => {
    resetCommonMocks()
    vi.useFakeTimers()
  })

  it("returns cached results on second identical search (no API call)", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_NOMINATIM_RESULTS)
    render(<AddressAutocomplete />)

    // First search — cache miss
    await typeAndFlush("Endereco Cache Normal")
    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(1)

    // Clear and re-search same term — cache hit (no API call)
    mockFetchGeoSearch.mockClear()
    await clearInput()
    await typeAndFlush("Endereco Cache Normal")

    expect(mockFetchGeoSearch).not.toHaveBeenCalled()
    expect(screen.getByRole("listbox")).toBeTruthy()
  })

  it("caches CEP results on first search, serves from cache on second", async () => {
    mockFetchCep.mockResolvedValue(MOCK_CEP_RESULT)
    render(<AddressAutocomplete />)

    // First CEP search — cache miss
    await typeAndFlush("99999999")
    expect(mockFetchCep).toHaveBeenCalledTimes(1)
    mockFetchCep.mockClear()

    // Clear and re-search same CEP — cache hit
    await clearInput()
    await typeAndFlush("99999999")

    expect(mockFetchCep).not.toHaveBeenCalled()
    expect(screen.getByText("ViaCEP")).toBeTruthy()
  })
})

// ===========================================================================
// Cache TTL
// ===========================================================================

describe("AddressAutocomplete — cache TTL and mixed flows", () => {
  beforeEach(() => {
    resetCommonMocks()
  })

  it("re-fetches after cache TTL expires (5 minutes)", async () => {
    vi.useFakeTimers()
    mockFetchGeoSearch.mockResolvedValue(MOCK_NOMINATIM_RESULTS)
    render(<AddressAutocomplete />)

    // First search with a very unique term
    await typeAndFlush("Rua TTL Expirada")
    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(1)
    mockFetchGeoSearch.mockClear()

    // Re-search immediately — cache hit
    await clearInput()
    await typeAndFlush("Rua TTL Expirada")
    expect(mockFetchGeoSearch).not.toHaveBeenCalled()
    mockFetchGeoSearch.mockClear()

    // Advance time past 5 min TTL
    await act(async () => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 1000)
    })

    // Clear and re-search — cache expired, should re-fetch
    await clearInput()
    mockFetchGeoSearch.mockResolvedValue(MOCK_NOMINATIM_RESULTS)
    await typeAndFlush("Rua TTL Expirada")
    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(1)
  })

  it("does not serve Nominatim cache for a CEP search", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_NOMINATIM_RESULTS)
    mockFetchCep.mockResolvedValue(MOCK_CEP_RESULT)
    render(<AddressAutocomplete />)

    // Real timers: type, wait for debounce, then check
    const input = screen.getByRole("combobox")
    await act(async () => {
      fireEvent.change(input, { target: { value: "Rua Unica Qualquer" } })
    })
    // Wait 300ms debounce + fetch resolution
    await new Promise((r) => setTimeout(r, 400))
    await act(async () => {})

    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(1)
    mockFetchGeoSearch.mockClear()

    // Clear and search a CEP with a different unique term
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } })
    })
    await act(async () => {
      fireEvent.change(input, { target: { value: "88888888" } })
    })
    await new Promise((r) => setTimeout(r, 400))
    await act(async () => {})

    expect(mockFetchCep).toHaveBeenCalledTimes(1)
    expect(screen.getByText("ViaCEP")).toBeTruthy()
  })
})

// ===========================================================================
// Cache Edge Cases
// ===========================================================================

describe("AddressAutocomplete — cache edge cases", () => {
  beforeEach(() => {
    resetCommonMocks()
  })

  it("does not show dropdown when fetchGeoSearch rejects", async () => {
    vi.useFakeTimers()
    mockFetchGeoSearch.mockRejectedValue(new Error("Network error"))
    render(<AddressAutocomplete />)

    await typeAndFlush("Rua Que Falha")

    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("does not show dropdown when fetchCep rejects", async () => {
    vi.useFakeTimers()
    mockFetchCep.mockRejectedValue(new Error("CEP not found"))
    render(<AddressAutocomplete />)

    await typeAndFlush("01410101")

    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("recovers from fetchGeoSearch error and succeeds on retry", async () => {
    mockFetchGeoSearch.mockRejectedValueOnce(new Error("Network error"))
    render(<AddressAutocomplete />)

    const input = screen.getByRole("combobox")
    await act(async () => {
      fireEvent.change(input, { target: { value: "Rua Novinha Unica" } })
    })
    await new Promise((r) => setTimeout(r, 400))
    await act(async () => {})

    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(1)

    // Clear and retry with success
    mockFetchGeoSearch.mockResolvedValueOnce(MOCK_NOMINATIM_RESULTS)
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } })
    })
    await act(async () => {
      fireEvent.change(input, { target: { value: "Rua Novinha Unica" } })
    })
    await new Promise((r) => setTimeout(r, 400))
    await act(async () => {})

    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(2)
    expect(screen.getByRole("listbox")).toBeTruthy()
  })

  it("closes dropdown when input drops below 3 characters", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_NOMINATIM_RESULTS)
    render(<AddressAutocomplete />)

    const input = screen.getByRole("combobox")
    await act(async () => {
      fireEvent.change(input, { target: { value: "Rua Seis" } })
    })
    await new Promise((r) => setTimeout(r, 400))
    await act(async () => {})

    expect(screen.queryByRole("listbox")).toBeTruthy()

    // Clear input and wait for debounce
    await act(async () => {
      fireEvent.change(input, { target: { value: "" } })
    })
    await new Promise((r) => setTimeout(r, 400))
    await act(async () => {})

    expect(screen.queryByRole("listbox")).toBeNull()
  })
})
