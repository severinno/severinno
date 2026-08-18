/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from "vitest"
import React from "react"
import { render, screen, fireEvent, act } from "@/__tests__/test-utils"
import AddressAutocomplete from "../address-autocomplete"

import {
  MOCK_RESULTS,
  mockGeoStore,
  mockFetchGeoSearch,
  getMockToast,
  resetCommonMocks,
  flushDebounce,
} from "./test-utils"

const mockToast = getMockToast()

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers()
  resetCommonMocks()
})

// ===========================================================================
// Tests
// ===========================================================================

describe("AddressAutocomplete — rendering", () => {
  it("renders the input with correct role", () => {
    render(<AddressAutocomplete />)
    expect(screen.getByRole("combobox")).toBeTruthy()
  })

  it("renders MapPin icon", () => {
    render(<AddressAutocomplete />)
    expect(screen.getByTestId("icon-mappin")).toBeTruthy()
  })

  it("does not show dropdown initially", () => {
    render(<AddressAutocomplete />)
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("uses custom placeholder when provided", () => {
    render(<AddressAutocomplete placeholder="Digite seu endereço" />)
    const input = screen.getByRole("combobox") as HTMLInputElement
    expect(input.placeholder).toBe("Digite seu endereço")
  })

  it("shows city from geo store as placeholder when input is empty", () => {
    mockGeoStore.city = "São Paulo"
    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox") as HTMLInputElement
    expect(input.placeholder).toBe("São Paulo")
  })

  it("applies className to the root element", () => {
    render(<AddressAutocomplete className="my-custom-class" />)
    const root = document.querySelector(".my-custom-class")
    expect(root).toBeTruthy()
  })
})

describe("AddressAutocomplete — debounce and fetch", () => {
  it("does not call fetchGeoSearch for input shorter than 3 chars", async () => {
    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av" } })
    })
    await flushDebounce()

    expect(mockFetchGeoSearch).not.toHaveBeenCalled()
  })

  it("calls fetchGeoSearch after debounce delay with correct params", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })

    // Not called immediately
    expect(mockFetchGeoSearch).not.toHaveBeenCalled()

    // Advance past debounce
    await flushDebounce()

    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(1)
    expect(mockFetchGeoSearch).toHaveBeenCalledWith("Av. Paulista", 5)
  })

  it("cancels previous request when input changes again", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Rua" } })
    })

    // Change before debounce fires
    await act(async () => {
      fireEvent.change(input, { target: { value: "Rua Augusta" } })
    })

    await flushDebounce()

    // Only one call — the second one (first was cancelled by the cleanup)
    expect(mockFetchGeoSearch).toHaveBeenCalledTimes(1)
    expect(mockFetchGeoSearch).toHaveBeenCalledWith("Rua Augusta", 5)
  })

  it("does not show dropdown when fetch returns empty array", async () => {
    mockFetchGeoSearch.mockResolvedValue([])

    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "XyzNotFound" } })
    })
    await flushDebounce()

    expect(screen.queryByRole("listbox")).toBeNull()
  })
})

describe("AddressAutocomplete — result display", () => {
  it("shows dropdown with results after fetch", async () => {
    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await flushDebounce()

    expect(screen.getByRole("listbox")).toBeTruthy()
    expect(screen.getByText(/Avenida Paulista/)).toBeTruthy()
    expect(screen.getByText(/Rua Augusta/)).toBeTruthy()
  })

  it("shows city and state subtitle for each result", async () => {
    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await flushDebounce()

    const subtitles = screen.getAllByText("São Paulo, SP")
    expect(subtitles.length).toBeGreaterThanOrEqual(1)
  })

  it("shows importance star for results with importance > 0.5", async () => {
    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await flushDebounce()

    const stars = screen.getAllByLabelText("Alta relevância")
    expect(stars.length).toBe(1)
  })
})

describe("AddressAutocomplete — result selection", () => {
  it("calls setFromCoords and onSelect when clicking a result", async () => {
    const onSelect = vi.fn()

    render(<AddressAutocomplete onSelect={onSelect} />)
    const input = screen.getByRole("combobox")

    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await flushDebounce()

    const firstResult = screen.getByText(/Avenida Paulista/)
    await act(async () => {
      fireEvent.click(firstResult)
    })

    expect(mockGeoStore.setFromCoords).toHaveBeenCalledWith(
      MOCK_RESULTS[0].lat,
      MOCK_RESULTS[0].lng,
      MOCK_RESULTS[0].displayName,
    )
    expect(onSelect).toHaveBeenCalledWith(
      MOCK_RESULTS[0].lat,
      MOCK_RESULTS[0].lng,
      MOCK_RESULTS[0].displayName,
    )
  })

  it("closes dropdown after selecting a result", async () => {
    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await flushDebounce()

    expect(screen.getByRole("listbox")).toBeTruthy()

    const firstResult = screen.getByText(/Avenida Paulista/)
    await act(async () => {
      fireEvent.click(firstResult)
    })

    expect(screen.queryByRole("listbox")).toBeNull()
  })
})

describe("AddressAutocomplete — keyboard navigation", () => {
  it("selects next item on ArrowDown", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await flushDebounce()

    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" })
    })

    const options = screen.getAllByRole("option")
    expect(options[0].getAttribute("aria-selected")).toBe("true")
    expect(options[1].getAttribute("aria-selected")).toBe("false")

    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" })
    })

    expect(options[0].getAttribute("aria-selected")).toBe("false")
    expect(options[1].getAttribute("aria-selected")).toBe("true")
  })

  it("selects previous item on ArrowUp", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await flushDebounce()

    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" })
    })
    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" })
    })

    const options = screen.getAllByRole("option")
    expect(options[1].getAttribute("aria-selected")).toBe("true")

    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowUp" })
    })

    expect(options[0].getAttribute("aria-selected")).toBe("true")
    expect(options[1].getAttribute("aria-selected")).toBe("false")
  })

  it("selects highlighted item on Enter", async () => {
    const onSelect = vi.fn()
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    render(<AddressAutocomplete onSelect={onSelect} />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await flushDebounce()

    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" })
    })
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" })
    })

    expect(onSelect).toHaveBeenCalledWith(
      MOCK_RESULTS[0].lat,
      MOCK_RESULTS[0].lng,
      MOCK_RESULTS[0].displayName,
    )
  })

  it("closes dropdown on Escape", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await flushDebounce()

    expect(screen.getByRole("listbox")).toBeTruthy()

    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" })
    })

    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("does not select on Enter when no item is highlighted", async () => {
    const onSelect = vi.fn()
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    render(<AddressAutocomplete onSelect={onSelect} />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await flushDebounce()

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" })
    })

    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe("AddressAutocomplete — click outside", () => {
  it("closes dropdown when clicking outside", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await flushDebounce()

    expect(screen.getByRole("listbox")).toBeTruthy()

    await act(async () => {
      fireEvent.mouseDown(document.body)
    })

    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("reopens dropdown on focus when results exist", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await flushDebounce()

    expect(screen.getByRole("listbox")).toBeTruthy()

    await act(async () => {
      fireEvent.keyDown(input, { key: "Escape" })
    })
    expect(screen.queryByRole("listbox")).toBeNull()

    await act(async () => {
      fireEvent.focus(input)
    })

    expect(screen.getByRole("listbox")).toBeTruthy()
  })
})

describe("AddressAutocomplete — clear button", () => {
  it("shows clear button when input has text and loading is false", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await flushDebounce()

    const clearBtn = screen.getByLabelText("Limpar localização")
    expect(clearBtn).toBeTruthy()
  })

  it("clears input and results when clear button is clicked", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox") as HTMLInputElement

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await flushDebounce()

    expect(input.value).toBe("Av. Paulista")
    expect(screen.getByRole("listbox")).toBeTruthy()

    const clearBtn = screen.getByLabelText("Limpar localização")
    await act(async () => {
      fireEvent.click(clearBtn)
    })

    expect(input.value).toBe("")
    expect(screen.queryByRole("listbox")).toBeNull()
  })

  it("does not show clear button when input is empty", () => {
    render(<AddressAutocomplete />)
    expect(screen.queryByLabelText("Limpar localização")).toBeNull()
  })
})

describe("AddressAutocomplete — GPS locate and reverse geocode", () => {
  it("renders GPS locate button", () => {
    render(<AddressAutocomplete />)
    expect(screen.getByLabelText("Usar localização atual")).toBeTruthy()
  })

  it("calls setFromGPS and uses address populated by store", async () => {
    mockGeoStore.setFromGPS = vi.fn().mockImplementation(async () => {
      mockGeoStore.lat = -23.5505
      mockGeoStore.lng = -46.6333
      mockGeoStore.address = "Avenida Paulista, São Paulo - SP, Brasil"
    })

    const onSelect = vi.fn()
    render(<AddressAutocomplete onSelect={onSelect} />)
    const gpsBtn = screen.getByLabelText("Usar localização atual")

    await act(async () => {
      fireEvent.click(gpsBtn)
    })
    await act(async () => {})

    expect(mockGeoStore.setFromGPS).toHaveBeenCalledTimes(1)
    // Component reads geo.address (populated by store's internal reverse geocode)
    expect(mockGeoStore.setFromCoords).toHaveBeenCalledWith(
      -23.5505,
      -46.6333,
      "Avenida Paulista, São Paulo - SP, Brasil",
    )
    expect(onSelect).toHaveBeenCalledWith(
      -23.5505,
      -46.6333,
      "Avenida Paulista, São Paulo - SP, Brasil",
    )
  })

  it("falls back to raw coordinates when store has no address", async () => {
    mockGeoStore.setFromGPS = vi.fn().mockImplementation(async () => {
      mockGeoStore.lat = -23.5505
      mockGeoStore.lng = -46.6333
      // address stays null → component falls back to raw coords
    })

    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox") as HTMLInputElement
    const gpsBtn = screen.getByLabelText("Usar localização atual")

    await act(async () => {
      fireEvent.click(gpsBtn)
    })
    await act(async () => {})

    expect(input.value).toBe("-23.5505, -46.6333")
    expect(mockGeoStore.setFromCoords).toHaveBeenCalledWith(
      -23.5505,
      -46.6333,
      "-23.5505, -46.6333",
    )
    expect(mockToast.success).toHaveBeenCalledWith("Localização atualizada!")
  })

  it("does nothing when GPS returns null coordinates", async () => {
    mockGeoStore.setFromGPS = vi.fn().mockImplementation(async () => {
      mockGeoStore.lat = null
      mockGeoStore.lng = null
    })

    const onSelect = vi.fn()
    render(<AddressAutocomplete onSelect={onSelect} />)
    const gpsBtn = screen.getByLabelText("Usar localização atual")

    await act(async () => {
      fireEvent.click(gpsBtn)
    })
    await act(async () => {})

    expect(mockGeoStore.setFromGPS).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("shows spinner on GPS button while locating", async () => {
    mockGeoStore.setFromGPS = vi.fn().mockReturnValue(new Promise(() => {}))

    render(<AddressAutocomplete />)
    const gpsBtn = screen.getByLabelText("Usar localização atual")

    await act(async () => {
      fireEvent.click(gpsBtn)
    })

    expect(screen.getByTestId("icon-loading")).toBeTruthy()
  })
})

describe("AddressAutocomplete — loading state", () => {
  it("shows loading spinner while fetch is in progress", async () => {
    mockFetchGeoSearch.mockReturnValue(new Promise(() => {}))

    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    // Query única — evita o GLOBAL_CACHE do módulo (persiste entre testes do
    // mesmo arquivo), forçando o caminho de fetch e o spinner de loading.
    await act(async () => {
      fireEvent.change(input, { target: { value: "Rua Do Loading Teste" } })
    })

    await flushDebounce()

    expect(screen.getByTestId("icon-loading")).toBeTruthy()
  })

  it("hides loading spinner after fetch resolves", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    // Query única (mesma razão: não pode bater no GLOBAL_CACHE).
    await act(async () => {
      fireEvent.change(input, { target: { value: "Rua Do Loading Resolve" } })
    })
    await flushDebounce()

    expect(screen.queryByTestId("icon-loading")).toBeNull()
    expect(screen.getByRole("listbox")).toBeTruthy()
  })
})
