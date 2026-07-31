/**
 * Playwright Visual Regression — AddressAutocomplete
 *
 * Captures pixel-perfect screenshots of the component in 8 states:
 *   1. empty          — initial render, no interactions
 *   2. geo-placeholder— city name from geo store as placeholder
 *   3. results-dropdown — dropdown open with 2 address results
 *   4. dropdown-hover — first result highlighted via mouseEnter
 *   5. gps-spinner    — GPS locate button showing loading spinner
 *   6. reverse-geocode-error — raw coordinates after reverse geocode failure
 *   7. fetch-error    — typed text preserved after fetch fails
 *   8. input-filled   — input filled after selecting a result
 *
 * Usage:
 *   bun run dev              (in another terminal)
 *   npx playwright test e2e/address-autocomplete-visual.spec.ts
 *
 * Screenshots are stored in test-results/ and the Playwright HTML report.
 * Baseline images can be committed for CI diff comparisons.
 */
import { test, expect } from "@playwright/test"
import path from "path"
import { mkdirSync } from "fs"

// ===========================================================================
// Constants
// ===========================================================================

const TEST_PAGE = "/test/address-autocomplete"
const SCREENSHOT_DIR = path.join("e2e", "screenshots", "address-autocomplete")

const MOCK_SEARCH_RESULTS = [
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

const MOCK_REVERSE_RESULT = {
  street: "Avenida Paulista",
  district: "Bela Vista",
  city: "São Paulo",
  state: "SP",
  cep: "01310-100",
  displayName: "Avenida Paulista, Bela Vista, São Paulo - SP, Brasil",
}

// ===========================================================================
// Helpers
// ===========================================================================

/** Register a route handler that returns mock search results. */
async function mockGeoSearchOk(page: import("@playwright/test").Page) {
  await page.route("**/api/geo/search*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_SEARCH_RESULTS),
    })
  })
}

/** Register a route handler that returns a 500 error for geo search. */
async function mockGeoSearchError(page: import("@playwright/test").Page) {
  await page.route("**/api/geo/search*", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Network error" }),
    })
  })
}

/** Register a route handler that returns an error for reverse geocode. */
async function mockReverseGeoError(page: import("@playwright/test").Page) {
  await page.route("**/api/geo/reverse*", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Reverse geocode failed" }),
    })
  })
}

/**
 * Type text into the combobox input and wait for the debounce + React
 * re-render so the dropdown (or error state) appears.
 */
async function typeAndWait(page: import("@playwright/test").Page, text: string) {
  const input = page.getByRole("combobox")
  await input.click()
  await input.fill(text)
  // Wait for debounce (300 ms) + React render
  await page.waitForTimeout(500)
}

/**
 * Take a screenshot of the AddressAutocomplete root element.
 * The root is the first `<div class="relative">` ancestor of the
 * combobox input.  The `..` locator walks up one DOM level, which
 * is the outermost div rendered by AddressAutocomplete.
 */
async function screenshot(page: import("@playwright/test").Page, name: string) {
  // Ensure the screenshots directory exists
  mkdirSync(SCREENSHOT_DIR, { recursive: true })

  // Walk up to the parent of the combobox (the root div.relative wrapper)
  const root = page.getByRole("combobox").locator("..")
  await root.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`) })
}

// ===========================================================================
// Test
// ===========================================================================

test.describe("AddressAutocomplete — Visual Regression", () => {
  test.describe.configure({ timeout: 60_000 })

  // -----------------------------------------------------------------------
  // 1. Empty
  // -----------------------------------------------------------------------
  test("empty state @visual", async ({ page }) => {
    await page.goto(TEST_PAGE, { waitUntil: "domcontentloaded" })
    const input = page.getByRole("combobox")
    await expect(input).toBeAttached()
    await expect(input).toHaveAttribute("aria-expanded", "false")

    await screenshot(page, "empty")
  })

  // -----------------------------------------------------------------------
  // 2. Geo store placeholder
  // -----------------------------------------------------------------------
  test("geo store placeholder @visual", async ({ browser }) => {
    // Create a new context so the localStorage seed doesn't leak
    const context = await browser.newContext()
    const page = await context.newPage()

    // Seed the Zustand persist store with a city before the page hydrates
    await page.addInitScript(() => {
      localStorage.setItem(
        "severinno:geo",
        JSON.stringify({
          state: {
            lat: -23.5505,
            lng: -46.6333,
            address: null,
            cep: null,
            district: null,
            city: "São Paulo",
            state: "SP",
            status: "ready",
            updatedAt: new Date().toISOString(),
          },
          version: 0,
        }),
      )
    })

    await page.goto(TEST_PAGE, { waitUntil: "domcontentloaded" })

    await expect(page.getByRole("combobox")).toBeAttached()
    await expect(page.getByRole("combobox")).toHaveAttribute("placeholder", "São Paulo")

    await screenshot(page, "geo-placeholder")
    await context.close()
  })

  // -----------------------------------------------------------------------
  // 3. Results dropdown
  // -----------------------------------------------------------------------
  test("results dropdown @visual", async ({ page }) => {
    await mockGeoSearchOk(page)
    await page.goto(TEST_PAGE, { waitUntil: "domcontentloaded" })

    await typeAndWait(page, "Av. Paulista")

    await expect(page.getByRole("listbox")).toBeAttached()
    await expect(page.getByRole("option")).toHaveCount(2)

    await screenshot(page, "results-dropdown")
  })

  // -----------------------------------------------------------------------
  // 4. Dropdown hover (first item highlighted)
  // -----------------------------------------------------------------------
  test("dropdown hover @visual", async ({ page }) => {
    await mockGeoSearchOk(page)
    await page.goto(TEST_PAGE, { waitUntil: "domcontentloaded" })

    await typeAndWait(page, "Av. Paulista")

    const options = page.getByRole("option")
    await expect(options).toHaveCount(2)

    // Hover the first option
    await options.first().hover()
    await expect(options.first()).toHaveAttribute("aria-selected", "true")
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "false")

    await screenshot(page, "dropdown-hover")
  })

  // -----------------------------------------------------------------------
  // 5. GPS spinner
  // -----------------------------------------------------------------------
  test("GPS spinner @visual", async ({ page }) => {
    await page.goto(TEST_PAGE, { waitUntil: "domcontentloaded" })

    // Override geolocation to NEVER resolve — the component's setFromGPS
    // calls navigator.geolocation.getCurrentPosition.  If it never calls
    // the callback, the component stays in "locating" state with spinner.
    await page.evaluate(() => {
      navigator.geolocation.getCurrentPosition = () => {
        // Never resolve or reject — keep spinner visible
      }
    })

    const gpsBtn = page.getByLabel("Usar localização atual")
    await gpsBtn.click()

    // The spinner should appear immediately
    await expect(page.getByTestId("icon-loading")).toBeAttached()

    await screenshot(page, "gps-spinner")
  })

  // -----------------------------------------------------------------------
  // 6. Reverse geocode error (GPS succeeds, reverse fails)
  // -----------------------------------------------------------------------
  test("reverse geocode error @visual", async ({ page }) => {
    await mockReverseGeoError(page)
    await page.goto(TEST_PAGE, { waitUntil: "domcontentloaded" })

    // Grant geolocation permission and set a fixed position
    const context = page.context()
    await context.grantPermissions(["geolocation"])
    await (page as any).setGeolocation({ latitude: -23.5505, longitude: -46.6333 })

    const gpsBtn = page.getByLabel("Usar localização atual")
    await gpsBtn.click()

    // Wait for async GPS + reverse geocode to complete
    await page.waitForTimeout(1000)

    const input = page.getByRole("combobox")
    // Input should show raw coordinates as fallback
    await expect(input).toHaveValue("-23.5505, -46.6333")

    await screenshot(page, "reverse-geocode-error")
  })

  // -----------------------------------------------------------------------
  // 7. Fetch error
  // -----------------------------------------------------------------------
  test("fetch error @visual", async ({ page }) => {
    await mockGeoSearchError(page)
    await page.goto(TEST_PAGE, { waitUntil: "domcontentloaded" })

    await typeAndWait(page, "Av. Paulista")

    const input = page.getByRole("combobox")
    await expect(input).toHaveValue("Av. Paulista")
    await expect(page.getByRole("listbox")).not.toBeAttached()

    await screenshot(page, "fetch-error")
  })

  // -----------------------------------------------------------------------
  // 8. Input filled after selection
  // -----------------------------------------------------------------------
  test("input filled @visual", async ({ page }) => {
    await mockGeoSearchOk(page)
    await page.goto(TEST_PAGE, { waitUntil: "domcontentloaded" })

    await typeAndWait(page, "Av. Paulista")

    // Click the first result
    const firstOption = page.getByRole("option").first()
    await firstOption.click()

    const input = page.getByRole("combobox")
    await expect(input).toHaveValue("Avenida Paulista, Bela Vista, São Paulo - SP, Brasil")
    await expect(page.getByRole("listbox")).not.toBeAttached()

    await screenshot(page, "input-filled")
  })
})
