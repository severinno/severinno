/**
 * Accessibility (axe-core) tests for the AddressAutocomplete component.
 *
 * Tests ARIA attributes (role="combobox", aria-expanded, aria-autocomplete,
 * aria-controls) in multiple states and scans for axe violations.
 *
 * ── Known mock limitations ─────────────────────────────────────────────
 * 1. `color-contrast`: jsdom can't resolve Tailwind CSS variables, so axe
 *    colour checks always pass vacuously.
 * 2. `button-name`: lucide icons are mocked as <svg aria-hidden="true">,
 *    so icon-only buttons rely on their aria-label for accessible names.
 * 3. jest-dom matchers are available globally via vitest.d.ts + vitest.setup.ts,
 *    but this file intentionally uses getAttribute() for low-level attribute
 *    assertions rather than wrapper matchers (e.g. toHaveAttribute()).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import React from "react"
import { render, screen, fireEvent, act } from "@/__tests__/test-utils"
import { axe } from "vitest-axe"
import AddressAutocomplete from "../address-autocomplete"

import {
  MOCK_RESULTS,
  mockGeoStore,
  mockFetchGeoSearch,
  mockFetchReverseGeo,
  resetCommonMocks,
} from "./test-utils"

// ---------------------------------------------------------------------------
// Lucide icons must be mocked as <svg> (not <span>) so axe doesn't flag
// decorative icons as missing accessible names. The shared vitest.setup
// uses <span> stubs for the behavior/snapshot tests. Here we override the
// lucide-react mock specifically for the a11y tests.
// ---------------------------------------------------------------------------

vi.mock("lucide-react", () => {
  const Svg = (p: any) => <svg aria-hidden="true" data-testid="lucide-icon" {...p} />
  Svg.displayName = "LucideIcon"
  return {
    MapPin: Svg,
    LocateFixed: Svg,
    Loader2: (p: any) => (
      <svg aria-hidden="true" className="animate-spin" data-testid="icon-loading" {...p} />
    ),
    X: Svg,
  }
})

// ---------------------------------------------------------------------------
// Setup
//
// IMPORTANT: This file uses REAL timers (not vi.useFakeTimers) because
// axe-core uses setTimeout / requestAnimationFrame internally for colour-
// contrast and other checks.  Fake timers would prevent these from firing.
// ---------------------------------------------------------------------------

/** Wait for the component's 300 ms debounce using real timers. */
async function realDebounce() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 350))
  })
}

beforeEach(() => {
  resetCommonMocks()
})

// ===========================================================================
// ARIA attribute tests
// ===========================================================================

describe("AddressAutocomplete — ARIA attributes", () => {
  it("renders input with role combobox and correct ARIA attributes when closed", () => {
    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    expect(input).toBeTruthy()
    expect(input.getAttribute("role")).toBe("combobox")
    expect(input.getAttribute("aria-label")).toBe("Localização")
    expect(input.getAttribute("aria-autocomplete")).toBe("list")
    expect(input.getAttribute("aria-expanded")).toBe("false")
    expect(input.getAttribute("aria-controls")).toBeNull()
  })

  it("sets aria-expanded=true and aria-controls when results are shown", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await realDebounce()

    expect(input.getAttribute("aria-expanded")).toBe("true")
    expect(input.getAttribute("aria-controls")).toBe("address-suggestions")
  })

  it("renders listbox with role listbox and correct id when open", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await realDebounce()

    const listbox = screen.getByRole("listbox")
    expect(listbox).toBeTruthy()
    expect(listbox.getAttribute("id")).toBe("address-suggestions")
  })

  it("renders options with role option and correct aria-selected on hover", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await realDebounce()

    const options = screen.getAllByRole("option")
    expect(options).toHaveLength(2)
    expect(options[0].getAttribute("aria-selected")).toBe("false")

    await act(async () => {
      fireEvent.mouseEnter(options[0])
    })
    expect(options[0].getAttribute("aria-selected")).toBe("true")
    expect(options[1].getAttribute("aria-selected")).toBe("false")
  })

  it("has accessible name on GPS locate button", () => {
    render(<AddressAutocomplete />)
    const gpsBtn = screen.getByLabelText("Usar localização atual")
    expect(gpsBtn).toBeTruthy()
  })

  it("has accessible name on clear button when visible", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await realDebounce()

    const clearBtn = screen.getByLabelText("Limpar localização")
    expect(clearBtn).toBeTruthy()
  })

  it("does not render listbox when no results", () => {
    render(<AddressAutocomplete />)
    expect(screen.queryByRole("listbox")).toBeNull()
  })
})

// ===========================================================================
// Axe violation tests
// ===========================================================================

describe("AddressAutocomplete — axe violations", () => {
  it("has no axe violations in empty (closed) state", async () => {
    const { container } = render(<AddressAutocomplete />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations when results dropdown is open", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    const { container } = render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await realDebounce()

    expect(screen.getByRole("listbox")).toBeTruthy()
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations when GPS button loading", async () => {
    mockGeoStore.setFromGPS = vi.fn().mockReturnValue(new Promise(() => {}))

    const { container } = render(<AddressAutocomplete />)
    const gpsBtn = screen.getByLabelText("Usar localização atual")

    await act(async () => {
      fireEvent.click(gpsBtn)
    })

    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations with input filled after selection", async () => {
    mockFetchGeoSearch.mockResolvedValue(MOCK_RESULTS)

    const { container } = render(<AddressAutocomplete />)
    const input = screen.getByRole("combobox")

    await act(async () => {
      fireEvent.change(input, { target: { value: "Av. Paulista" } })
    })
    await realDebounce()

    const firstResult = screen.getByText(/Avenida Paulista/)
    await act(async () => {
      fireEvent.click(firstResult)
    })

    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })

  it("has no axe violations when geo store supplies city as placeholder", async () => {
    mockGeoStore.city = "São Paulo"

    const { container } = render(<AddressAutocomplete />)
    const results = await axe(container)
    expect(results.violations).toHaveLength(0)
  })
})
