/**
 * E2E — Geo Address Flow (AddressAutocomplete)
 *
 * Exercises the full address-selection flow on the isolated test page
 * (/test/address-autocomplete):
 *
 *   ✅ CEP input → ViaCEP result (dropdown + badge)
 *   ✅ ViaCEP resolves → structured Nominatim request fired with postcode/city/state
 *   ✅ Selecting an enriched CEP fills the input with the address
 *   ✅ Free-form address → Nominatim results dropdown
 *   ✅ Selecting a Nominatim result fills the input with the display name
 *   ✅ Structured failure is non-fatal — ViaCEP result still usable
 *
 * All geo APIs are intercepted via page.route() — no external network needed.
 *
 * Run:  npx playwright test e2e/geo-address-flow.spec.ts
 */

import { test, expect, type Page } from "@playwright/test"

// The PWA service worker (public/sw.js) intercepts /api/* GET requests and
// fetches them from inside the worker — requests initiated by the SW bypass
// page.route() and hit the real backend. Block it so the API mocks below
// actually take effect.
test.use({ serviceWorkers: "block" })

const TEST_PAGE = "/test/address-autocomplete"

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_CEP = {
  cep: "01310100",
  street: "Rua Augusta",
  district: "Consolação",
  city: "São Paulo",
  state: "SP",
}

const MOCK_STRUCTURED = [
  {
    lat: -23.5545,
    lng: -46.6403,
    displayName: "Rua Augusta, Consolação, São Paulo - SP, Brasil",
    street: "Rua Augusta",
    district: "Consolação",
    city: "São Paulo",
    state: "SP",
    cep: "01310-100",
    category: "highway",
    type: "residential",
    importance: 0.9,
  },
]

const MOCK_SEARCH = [
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
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupGeoMocks(page: Page, options: { failStructured?: boolean } = {}) {
  await page.route("**/api/geo/cep*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_CEP),
    })
  })

  await page.route("**/api/geo/search*", async (route, request) => {
    if (options.failStructured) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Nominatim unavailable" }),
      })
      return
    }
    const url = new URL(request.url())
    const hasStructured =
      url.searchParams.has("street") ||
      url.searchParams.has("city") ||
      url.searchParams.has("state")
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(hasStructured ? MOCK_STRUCTURED : MOCK_SEARCH),
    })
  })
}

/**
 * Navigate to the isolated autocomplete page and wait for React hydration.
 *
 * The dev server compiles JS chunks on demand — on a cold compile the page
 * HTML arrives before the client chunks are ready. Typing before React
 * attaches its event listeners loses the keystrokes silently, so we wait
 * for the network to quiesce (all chunks fetched) plus a short grace for
 * hydration before any interaction.
 */
async function gotoAutocompletePage(page: Page) {
  await page.goto(TEST_PAGE, { waitUntil: "domcontentloaded" })
  await page.waitForLoadState("networkidle")
  await expect(page.getByRole("combobox")).toBeAttached()
  await page.waitForTimeout(300)
}

async function typeAndWait(page: Page, text: string) {
  const input = page.getByRole("combobox")
  await input.click()
  await input.fill(text)
  // 300 ms debounce + fetch + re-render
  await page.waitForTimeout(700)
}

// ===========================================================================
// Tests
// ===========================================================================

test.describe("Geo Address Flow — CEP + ViaCEP + structured enrichment", () => {
  test.beforeEach(async ({ page }) => {
    await setupGeoMocks(page)
  })

  test("CEP input shows the ViaCEP result with badge", async ({ page }) => {
    await gotoAutocompletePage(page)
    await typeAndWait(page, "01310100")

    const option = page.getByRole("option")
    await expect(option).toHaveCount(1)
    await expect(option.getByText("ViaCEP")).toBeVisible()
    await expect(option.getByText(/Rua Augusta/)).toBeVisible()
  })

  test("ViaCEP resolution fires a structured Nominatim request", async ({ page }) => {
    const structuredRequests: string[] = []
    page.on("request", (req) => {
      if (req.url().includes("/api/geo/search")) structuredRequests.push(req.url())
    })

    await gotoAutocompletePage(page)
    await typeAndWait(page, "01310100")

    await expect(page.getByRole("option")).toHaveCount(1)

    // The structured request must include postcode/city/state (limit=1)
    const structured = structuredRequests.find((u) => new URL(u).searchParams.has("postcode"))
    expect(structured).toBeTruthy()
    const params = new URL(structured!).searchParams
    expect(params.get("postcode")).toBe("01310100")
    expect(params.get("city")).toBe("São Paulo")
    expect(params.get("state")).toBe("SP")
    expect(params.get("limit")).toBe("1")
  })

  test("selecting an enriched CEP fills the input with the address", async ({ page }) => {
    await gotoAutocompletePage(page)
    await typeAndWait(page, "01310100")

    await page.getByRole("option").click()

    // displayName built from ViaCEP fields (street, district, city, state)
    await expect(page.getByRole("combobox")).toHaveValue("Rua Augusta, Consolação, São Paulo, SP")
    await expect(page.getByRole("listbox")).not.toBeAttached()
  })
})

test.describe("Geo Address Flow — free-form Nominatim search", () => {
  test.beforeEach(async ({ page }) => {
    await setupGeoMocks(page)
  })

  test("typing an address shows Nominatim results", async ({ page }) => {
    await gotoAutocompletePage(page)
    await typeAndWait(page, "Av. Paulista")

    const option = page.getByRole("option")
    await expect(option).toHaveCount(1)
    await expect(option.getByText(/Avenida Paulista/)).toBeVisible()
  })

  test("selecting a Nominatim result fills the input with the display name", async ({ page }) => {
    await gotoAutocompletePage(page)
    await typeAndWait(page, "Av. Paulista")

    await page.getByRole("option").click()

    await expect(page.getByRole("combobox")).toHaveValue(
      "Avenida Paulista, Bela Vista, São Paulo - SP, Brasil",
    )
    await expect(page.getByRole("listbox")).not.toBeAttached()
  })

  test("short input (< 3 chars) does not open a dropdown", async ({ page }) => {
    await gotoAutocompletePage(page)
    await typeAndWait(page, "Av")

    await expect(page.getByRole("listbox")).not.toBeAttached()
  })
})

test.describe("Geo Address Flow — resilience", () => {
  test("ViaCEP result is still shown when the structured enrich fails", async ({ page }) => {
    await setupGeoMocks(page, { failStructured: true })

    await gotoAutocompletePage(page)
    await typeAndWait(page, "01310100")

    // Dropdown still opens with the ViaCEP result (coordinates are 0,0)
    const option = page.getByRole("option")
    await expect(option).toHaveCount(1)
    await expect(option.getByText("ViaCEP")).toBeVisible()

    // Selecting it still fills the input (display name from ViaCEP)
    await option.click()
    await expect(page.getByRole("combobox")).toHaveValue("Rua Augusta, Consolação, São Paulo, SP")
  })
})
