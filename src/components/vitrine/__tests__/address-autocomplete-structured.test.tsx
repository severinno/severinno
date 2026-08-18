/**
 * address-autocomplete-structured.test.tsx
 *
 * Tests the Nominatim STRUCTURED search flow that runs AFTER a ViaCEP lookup:
 *
 *   CEP input → fetchCep (ViaCEP) → fetchGeoSearchStructured({ postcode,
 *   city, state, limit: 1 }) to enrich the CEP result with real lat/lng.
 *
 * Coverage:
 *   ✅ Structured search called after ViaCEP with postcode/city/state
 *   ✅ CEP result with coordinates → selection calls setFromCoords + onSelect(lat, lng)
 *   ✅ CEP result WITHOUT coordinates (empty structured) → onSelect(0, 0, displayName)
 *   ✅ Structured search failure is non-fatal — ViaCEP result still shown
 *   ✅ Structured search skipped when ViaCEP result has no city
 *   ✅ ViaCEP fields still written to the geo store on selection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act, cleanup } from "@/__tests__/test-utils"
import AddressAutocomplete from "../address-autocomplete"

import {
  mockGeoStore,
  mockFetchGeoSearch,
  mockFetchGeoSearchStructured,
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

/** A ViaCEP result WITHOUT city → structured search must be skipped. */
const MOCK_CEP_NO_CITY: CepResult = {
  cep: "99999999",
  street: "Via sem cidade",
  district: "Distrito X",
  city: undefined,
  state: undefined,
}

const MOCK_STRUCTURED_RESULTS: GeoSearchResult[] = [
  {
    lat: -23.5545,
    lng: -46.6403,
    displayName: "Rua Augusta, Consolação, São Paulo - SP, Brasil",
    street: "Rua Augusta",
    district: "Consolação",
    city: "São Paulo",
    state: "SP",
    cep: "01310-100",
    type: "residential",
    category: "highway",
    importance: 0.9,
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Unique CEP per test — GLOBAL_CACHE (5 min TTL) is module-level and
 * persists between tests, so reusing the same CEP would serve cached
 * results and skip the fetch/structured chain entirely. */
let cepCounter = 0
function nextCep(): string {
  cepCounter += 1
  return String(13000000 + cepCounter) // 13000001, 13000002… (8 digits)
}

async function typeAndFlush(value: string) {
  const input = screen.getByRole("combobox")
  await act(async () => {
    fireEvent.change(input, { target: { value } })
  })
  await flushDebounce()
  // Flush the async chain: fetchCep → fetchGeoSearchStructured → setState
  await act(async () => {})
  await act(async () => {})
}

async function selectFirstOption() {
  await act(async () => {
    fireEvent.click(screen.getByRole("option"))
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  resetCommonMocks()
  // Expira cache de testes anteriores (TTL = 5 min)
  vi.advanceTimersByTime(5 * 60 * 1000 + 1000)
  mockFetchCep.mockResolvedValue(MOCK_CEP_RESULT)
})

afterEach(() => {
  cleanup()
})

// ===========================================================================
// Structured search triggered after ViaCEP
// ===========================================================================

describe("AddressAutocomplete — structured search after ViaCEP", () => {
  it("calls fetchGeoSearchStructured with postcode/city/state after ViaCEP resolves", async () => {
    const cep = nextCep()
    mockFetchCep.mockResolvedValue({ ...MOCK_CEP_RESULT, cep })
    mockFetchGeoSearchStructured.mockResolvedValue(MOCK_STRUCTURED_RESULTS)
    render(<AddressAutocomplete />)

    await typeAndFlush(cep)

    expect(mockFetchCep).toHaveBeenCalledTimes(1)
    expect(mockFetchGeoSearchStructured).toHaveBeenCalledWith({
      postcode: cep,
      city: "São Paulo",
      state: "SP",
      limit: 1,
    })
  })

  it("does not call plain fetchGeoSearch in the CEP flow", async () => {
    const cep = nextCep()
    mockFetchCep.mockResolvedValue({ ...MOCK_CEP_RESULT, cep })
    mockFetchGeoSearchStructured.mockResolvedValue(MOCK_STRUCTURED_RESULTS)
    render(<AddressAutocomplete />)

    await typeAndFlush(cep)

    expect(mockFetchGeoSearch).not.toHaveBeenCalled()
  })

  it("skips structured search when the ViaCEP result has no city", async () => {
    const cep = nextCep()
    mockFetchCep.mockResolvedValue({ ...MOCK_CEP_NO_CITY, cep })
    render(<AddressAutocomplete />)

    await typeAndFlush(cep)

    expect(mockFetchCep).toHaveBeenCalledTimes(1)
    expect(mockFetchGeoSearchStructured).not.toHaveBeenCalled()
    // ViaCEP result is still shown
    expect(screen.getByText("ViaCEP")).toBeTruthy()
  })

  it("is resilient to structured search failure — ViaCEP result still shown", async () => {
    const cep = nextCep()
    mockFetchCep.mockResolvedValue({ ...MOCK_CEP_RESULT, cep })
    mockFetchGeoSearchStructured.mockRejectedValue(new Error("Nominatim down"))
    render(<AddressAutocomplete />)

    await typeAndFlush(cep)

    expect(mockFetchCep).toHaveBeenCalledTimes(1)
    expect(mockFetchGeoSearchStructured).toHaveBeenCalledTimes(1)
    expect(screen.getByText("ViaCEP")).toBeTruthy()
    expect(screen.getByRole("option")).toBeTruthy()
  })
})

// ===========================================================================
// Selection behavior: with vs without coordinates
// ===========================================================================

describe("AddressAutocomplete — CEP selection with structured coordinates", () => {
  beforeEach(() => {
    mockFetchGeoSearchStructured.mockResolvedValue(MOCK_STRUCTURED_RESULTS)
  })

  it("calls setFromCoords + onSelect(lat, lng) when structured returns coordinates", async () => {
    const cep = nextCep()
    mockFetchCep.mockResolvedValue({ ...MOCK_CEP_RESULT, cep })
    const onSelect = vi.fn()
    render(<AddressAutocomplete onSelect={onSelect} />)

    await typeAndFlush(cep)
    await selectFirstOption()

    expect(mockGeoStore.setFromCoords).toHaveBeenCalledWith(
      -23.5545,
      -46.6403,
      expect.stringContaining("Rua Augusta"),
    )
    expect(onSelect).toHaveBeenCalledWith(
      -23.5545,
      -46.6403,
      expect.stringContaining("Rua Augusta"),
    )
  })

  it("writes ViaCEP address fields to the geo store on selection", async () => {
    const cep = nextCep()
    mockFetchCep.mockResolvedValue({ ...MOCK_CEP_RESULT, cep })
    const onSelect = vi.fn()
    render(<AddressAutocomplete onSelect={onSelect} />)

    await typeAndFlush(cep)
    await selectFirstOption()

    expect(mockGeoStore.cep).toBe(cep)
    expect(mockGeoStore.district).toBe("Consolação")
    expect(mockGeoStore.city).toBe("São Paulo")
    expect(mockGeoStore.state).toBe("SP")
    expect(mockGeoStore.status).toBe("ready")
  })

  it("falls back to onSelect(0, 0) when structured returns no coordinates", async () => {
    const cep = nextCep()
    mockFetchCep.mockResolvedValue({ ...MOCK_CEP_RESULT, cep })
    mockFetchGeoSearchStructured.mockResolvedValue([])
    const onSelect = vi.fn()
    render(<AddressAutocomplete onSelect={onSelect} />)

    await typeAndFlush(cep)
    await selectFirstOption()

    // No coords → synthetic (0, 0), but the display name is still meaningful
    expect(onSelect).toHaveBeenCalledWith(0, 0, expect.stringContaining("Rua Augusta"))
    expect(mockGeoStore.setFromCoords).not.toHaveBeenCalled()
  })

  it("falls back to onSelect(0, 0) when structured returns a result without lat/lng", async () => {
    const cep = nextCep()
    mockFetchCep.mockResolvedValue({ ...MOCK_CEP_RESULT, cep })
    mockFetchGeoSearchStructured.mockResolvedValue([
      {
        lat: 0,
        lng: 0,
        displayName: "Rua Sem Coordenadas, São Paulo - SP, Brasil",
        street: "Rua Sem Coordenadas",
        district: "Bela Vista",
        city: "São Paulo",
        state: "SP",
        cep: "01310-100",
        type: "residential",
        category: "highway",
        importance: 0.5,
      },
    ])
    const onSelect = vi.fn()
    render(<AddressAutocomplete onSelect={onSelect} />)

    await typeAndFlush(cep)
    await selectFirstOption()

    expect(onSelect).toHaveBeenCalledWith(0, 0, expect.any(String))
  })

  it("hides the dropdown after selecting an enriched CEP result", async () => {
    const cep = nextCep()
    mockFetchCep.mockResolvedValue({ ...MOCK_CEP_RESULT, cep })
    render(<AddressAutocomplete />)

    await typeAndFlush(cep)
    expect(screen.getByRole("listbox")).toBeTruthy()

    await selectFirstOption()

    expect(screen.queryByRole("listbox")).toBeNull()
  })
})
