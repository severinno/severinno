import { describe, it, expect, vi, beforeEach } from "vitest"
import React from "react"
import { render, screen, fireEvent, act } from "@testing-library/react"
import AddressAutocomplete from "../address-autocomplete"

import {
  MOCK_RESULTS,
  mockGeoStore,
  mockFetchGeoSearch,
  mockFetchReverseGeo,
  resetCommonMocks,
  flushDebounce,
} from "./test-utils"

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers()
  resetCommonMocks()
})

// ===========================================================================
// Snapshot tests — DOM structure regression checks
// ===========================================================================

describe("AddressAutocomplete — snapshot", () => {
  it("empty state: renders input with MapPin icon and GPS button, no dropdown, no clear", () => {
    const { asFragment } = render(<AddressAutocomplete />)
    expect(asFragment()).toMatchSnapshot("empty")
  })

  it("geo store placeholder: shows city name as placeholder when input is empty and geo store has city", () => {
    mockGeoStore.city = "São Paulo"

    const { asFragment } = render(<AddressAutocomplete />)
    const inputEl = screen.getByRole("combobox") as HTMLInputElement
    expect(inputEl.value).toBe("")
    expect(inputEl.placeholder).toBe("São Paulo")
    expect(asFragment()).toMatchSnapshot("geo-placeholder")
  })

  it("results dropdown: shows dropdown with result items after fetch", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    const { asFragment } = render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await flushDebounce()

    expect(screen.getByRole("listbox")).toBeTruthy()
    expect(asFragment()).toMatchSnapshot("results-dropdown")
  })

  it("dropdown hover: highlights first item on mouseEnter with bg-primary/10 and aria-selected=true", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    const { asFragment } = render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await flushDebounce()

    // Hover the first result option
    const options = screen.getAllByRole("option")
    await act(async () => {
      fireEvent.mouseEnter(options[0])
    })

    expect(options[0].getAttribute("aria-selected")).toBe("true")
    expect(options[1].getAttribute("aria-selected")).toBe("false")
    expect(options[0].className).toContain("bg-primary/10")
    expect(asFragment()).toMatchSnapshot("dropdown-hover")
  })

  it("GPS spinner: shows spinner while GPS is locating", async () => {
    mockGeoStore.setFromGPS = vi.fn().mockReturnValue(new Promise(() => {}))

    const { asFragment } = render(<AddressAutocomplete />)
    const gpsBtn = screen.getByLabelText("Usar localização atual")

    await act(async () => {
      fireEvent.click(gpsBtn)
    })

    expect(screen.getByTestId("icon-loading")).toBeTruthy()
    expect(asFragment()).toMatchSnapshot("gps-spinner")
  })

  it("reverse geocode error: shows raw coords input, clear button visible, no dropdown, GPS icon after GPS locate fails", async () => {
    mockGeoStore.setFromGPS = vi
      .fn()
      .mockImplementation(async () => {
        mockGeoStore.lat = -23.5505
        mockGeoStore.lng = -46.6333
      })
    mockFetchReverseGeo.mockRejectedValue(new Error("Reverse geocode failed"))

    const { asFragment } = render(<AddressAutocomplete />)
    const gpsBtn = screen.getByLabelText("Usar localização atual")

    await act(async () => {
      fireEvent.click(gpsBtn)
    })
    // Flush the async setFromGPS + fetchReverseGeo
    await act(async () => {})

    expect(screen.queryByRole("listbox")).toBeNull()
    const inputEl = screen.getByRole("combobox") as HTMLInputElement
    expect(inputEl.value).toBe("-23.5505, -46.6333")
    expect(screen.getByLabelText("Limpar localização")).toBeTruthy()
    expect(asFragment()).toMatchSnapshot("reverse-geocode-error")
  })

  it("fetch error: shows input with typed text, no dropdown, no loading spinner, GPS icon + clear button visible", async () => {
    mockFetchGeoSearch.mockRejectedValue(new Error("Network error"))

    const { asFragment } = render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await flushDebounce()

    // Wait for the rejected promise to flush through .catch / .finally
    await act(async () => {})

    expect(screen.queryByTestId("icon-loading")).toBeNull()
    expect(screen.queryByRole("listbox")).toBeNull()
    const inputEl = screen.getByRole("combobox") as HTMLInputElement
    expect(inputEl.value).toBe("Av. Paulista")
    expect(screen.getByLabelText("Limpar localização")).toBeTruthy()
    expect(asFragment()).toMatchSnapshot("fetch-error")
  })

  it("input filled: shows filled input with clear button and filled GPS icon after selection", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    const { asFragment } = render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await flushDebounce()

    const firstResult = screen.getByText(/Avenida Paulista/)
    await act(async () => {
      fireEvent.click(firstResult)
    })

    expect(screen.queryByRole("listbox")).toBeNull()
    const inputEl = screen.getByRole("combobox") as HTMLInputElement
    expect(inputEl.value).toBe("Avenida Paulista, Bela Vista, São Paulo - SP, Brasil")
    expect(screen.getByLabelText("Limpar localização")).toBeTruthy()
    expect(asFragment()).toMatchSnapshot("input-filled")
  })
})
