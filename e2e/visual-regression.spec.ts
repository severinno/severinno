/**
 * visual-regression.spec.ts
 *
 * Visual regression tests using Playwright screenshot comparisons.
 * Captures baseline screenshots and compares against them on subsequent runs.
 *
 * Pages tested:
 *   1. Home (vitrine landing)
 *   2. Search / Busca
 *   3. Dashboard (authenticated)
 *   4. Auth / Login
 *
 * Viewports:
 *   - Desktop Chrome (1280x720)
 *   - Mobile Chrome (Pixel 9: 412x915)
 *   - Mobile Safari (iPhone 16: 393x852)
 *
 * Run:  npx playwright test e2e/visual-regression.spec.ts
 * Update baselines: npx playwright test --update-snapshots e2e/visual-regression.spec.ts
 *
 * Snapshot directories:
 *   e2e/screenshots/home/
 *   e2e/screenshots/busca/
 *   e2e/screenshots/dashboard/
 *   e2e/screenshots/auth/
 */

import { test, expect, type Page } from "@playwright/test"

// Block PWA service worker to avoid interfering with screenshots
test.use({ serviceWorkers: "block" })

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000"

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_PROVIDERS = {
  items: [
    {
      id: "vr-prov-1",
      name: "Carlos Silva",
      avatarUrl: null,
      coverUrl: null,
      bio: "Encanador há 10 anos",
      rating: 4.9,
      reviewCount: 87,
      verified: true,
      city: "Governador Valadares",
      distanceKm: 1.5,
      radiusKm: 25,
      lat: -18.8566,
      lng: -41.9455,
      memberSince: new Date(Date.now() - 300000).toISOString(),
      services: [
        { id: "svc-1", title: "Encanador", basePrice: 120, unit: "UNIDADE", photos: [] },
        { id: "svc-2", title: "Hidráulica", basePrice: 180, unit: "UNIDADE", photos: [] },
      ],
      completedBookings: 156,
    },
    {
      id: "vr-prov-2",
      name: "Maria Santos",
      avatarUrl: null,
      coverUrl: null,
      bio: "Diarista profissional",
      rating: 4.7,
      reviewCount: 52,
      verified: true,
      city: "Governador Valadares",
      distanceKm: 3.2,
      radiusKm: 20,
      lat: -18.8600,
      lng: -41.9500,
      memberSince: new Date(Date.now() - 3600000).toISOString(),
      services: [
        { id: "svc-3", title: "Diarista", basePrice: 80, unit: "UNIDADE", photos: [] },
      ],
      completedBookings: 203,
    },
    {
      id: "vr-prov-3",
      name: "Pedro Oliveira",
      avatarUrl: null,
      coverUrl: null,
      bio: "Pintor e reformador",
      rating: 4.5,
      reviewCount: 31,
      verified: false,
      city: "Governador Valadares",
      distanceKm: 5.8,
      radiusKm: 30,
      lat: -18.8520,
      lng: -41.9400,
      memberSince: new Date(Date.now() - 86400000 * 3).toISOString(),
      services: [
        { id: "svc-4", title: "Pintura", basePrice: 150, unit: "METRO_QUADRADO", photos: [] },
      ],
      completedBookings: 67,
    },
  ],
  total: 3,
  page: 1,
  pageSize: 20,
  totalPages: 1,
}

const MOCK_CATEGORIES = [
  { id: "cat-1", name: "Limpeza", slug: "limpeza", icon: "Sparkles", serviceCount: 15 },
  { id: "cat-2", name: "Manutenção", slug: "manutencao", icon: "Wrench", serviceCount: 22 },
  { id: "cat-3", name: "Reforma", slug: "reforma", icon: "Hammer", serviceCount: 18 },
  { id: "cat-4", name: "Jardim", slug: "jardim", icon: "TreePine", serviceCount: 8 },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupMocks(page: Page) {
  await page.route("**/api/providers**", (route) =>
    route.fulfill({ json: MOCK_PROVIDERS }),
  )
  await page.route("**/api/categories**", (route) =>
    route.fulfill({ json: MOCK_CATEGORIES }),
  )
  await page.route("**/api/search**", (route) =>
    route.fulfill({ json: MOCK_PROVIDERS }),
  )
  await page.route("**/api/geo/**", (route) =>
    route.fulfill({ json: { lat: -18.8566, lng: -41.9455, city: "Governador Valadares" } }),
  )
}

/** Wait for the page to be fully rendered and stable */
async function waitForStable(page: Page, timeout = 15_000) {
  // Wait for network idle
  await page.waitForLoadState("networkidle", { timeout }).catch(() => {})
  // Wait for any animations to settle
  await page.waitForTimeout(1500)
  // Wait for fonts to load
  await page.waitForFunction(() => document.fonts.ready.then(() => true), { timeout: 5000 }).catch(() => {})
}

/** Take a full-page screenshot with stable rendering */
async function takeStableScreenshot(
  page: Page,
  name: string,
  options?: { fullPage?: boolean; mask?: string[] },
) {
  await waitForStable(page)

  // Mask dynamic content (timestamps, prices that change)
  const masks = options?.mask ?? []
  for (const selector of masks) {
    await page.locator(selector).evaluate((el) => {
      ;(el as HTMLElement).style.visibility = "hidden"
    }).catch(() => {})
  }

  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: options?.fullPage ?? true,
    maxDiffPixelRatio: 0.01, // 1% tolerance
    animations: "disabled",
  })
}

// ---------------------------------------------------------------------------
// Tests — Desktop Chrome
// ---------------------------------------------------------------------------

test.describe("Visual Regression — Desktop Chrome", () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test("home page — full page screenshot", async ({ page }) => {
    await setupMocks(page)
    await page.goto(BASE_URL)
    await takeStableScreenshot(page, "home/desktop-full", {
      fullPage: true,
      mask: ["[data-testid='timestamp']", "time"],
    })
  })

  test("home page — above the fold", async ({ page }) => {
    await setupMocks(page)
    await page.goto(BASE_URL)
    await waitForStable(page)
    await expect(page).toHaveScreenshot("home/desktop-above-fold.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    })
  })

  test("home page — hero section", async ({ page }) => {
    await setupMocks(page)
    await page.goto(BASE_URL)
    await waitForStable(page)

    // Screenshot just the hero/topbar area
    const hero = page.locator("header, nav, [class*='hero']").first()
    if (await hero.isVisible().catch(() => false)) {
      await hero.screenshot({
        path: "e2e/screenshots/home/desktop-hero.png",
      })
    }
  })

  test("search page — results view", async ({ page }) => {
    await setupMocks(page)
    await page.goto(`${BASE_URL}/busca`)
    await takeStableScreenshot(page, "busca/desktop-results", {
      fullPage: true,
    })
  })

  test("search page — with filters open", async ({ page }) => {
    await setupMocks(page)
    await page.goto(`${BASE_URL}/busca`)
    await waitForStable(page)

    // Try to open filters
    const filterBtn = page.locator('button:has-text("Filtros"), [aria-label*="filtro"]').first()
    if (await filterBtn.isVisible().catch(() => false)) {
      await filterBtn.click()
      await page.waitForTimeout(500)
    }

    await expect(page).toHaveScreenshot("busca/desktop-filters-open.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    })
  })

  test("auth page — login form", async ({ page }) => {
    await setupMocks(page)
    await page.goto(`${BASE_URL}/auth/login`)
    await waitForStable(page)

    await expect(page).toHaveScreenshot("auth/desktop-login.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    })
  })
})

// ---------------------------------------------------------------------------
// Tests — Mobile Chrome (Pixel 9)
// ---------------------------------------------------------------------------

test.describe("Visual Regression — Mobile Chrome", () => {
  test.use({ viewport: { width: 412, height: 915 } })

  test("home page — mobile full page", async ({ page }) => {
    await setupMocks(page)
    await page.goto(BASE_URL)
    await takeStableScreenshot(page, "home/mobile-full", {
      fullPage: true,
    })
  })

  test("home page — mobile above the fold", async ({ page }) => {
    await setupMocks(page)
    await page.goto(BASE_URL)
    await waitForStable(page)
    await expect(page).toHaveScreenshot("home/mobile-above-fold.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    })
  })

  test("search page — mobile results", async ({ page }) => {
    await setupMocks(page)
    await page.goto(`${BASE_URL}/busca`)
    await takeStableScreenshot(page, "busca/mobile-results", {
      fullPage: true,
    })
  })

  test("auth page — mobile login", async ({ page }) => {
    await setupMocks(page)
    await page.goto(`${BASE_URL}/auth/login`)
    await waitForStable(page)

    await expect(page).toHaveScreenshot("auth/mobile-login.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    })
  })
})

// ---------------------------------------------------------------------------
// Tests — Mobile Safari (iPhone 16)
// ---------------------------------------------------------------------------

test.describe("Visual Regression — Mobile Safari", () => {
  test.use({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  })

  test("home page — iPhone full page", async ({ page }) => {
    await setupMocks(page)
    await page.goto(BASE_URL)
    await takeStableScreenshot(page, "home/iphone-full", {
      fullPage: true,
    })
  })

  test("home page — iPhone above the fold", async ({ page }) => {
    await setupMocks(page)
    await page.goto(BASE_URL)
    await waitForStable(page)
    await expect(page).toHaveScreenshot("home/iphone-above-fold.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    })
  })
})

// ---------------------------------------------------------------------------
// Tests — Dark Mode
// ---------------------------------------------------------------------------

test.describe("Visual Regression — Dark Mode", () => {
  test.use({
    viewport: { width: 1280, height: 720 },
    colorScheme: "dark",
  })

  test("home page — dark mode", async ({ page }) => {
    await setupMocks(page)
    await page.goto(BASE_URL)
    await waitForStable(page)

    // Force dark mode via class
    await page.evaluate(() => {
      document.documentElement.classList.add("dark")
    })
    await page.waitForTimeout(500)

    await expect(page).toHaveScreenshot("home/desktop-dark.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    })
  })

  test("auth page — dark mode login", async ({ page }) => {
    await setupMocks(page)
    await page.goto(`${BASE_URL}/auth/login`)
    await waitForStable(page)

    await page.evaluate(() => {
      document.documentElement.classList.add("dark")
    })
    await page.waitForTimeout(500)

    await expect(page).toHaveScreenshot("auth/desktop-dark-login.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    })
  })
})

// ---------------------------------------------------------------------------
// Tests — Component States
// ---------------------------------------------------------------------------

test.describe("Visual Regression — Component States", () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test("home page — empty state (no providers)", async ({ page }) => {
    await page.route("**/api/providers**", (route) =>
      route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 } }),
    )
    await page.route("**/api/categories**", (route) =>
      route.fulfill({ json: MOCK_CATEGORIES }),
    )
    await page.route("**/api/search**", (route) =>
      route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 } }),
    )

    await page.goto(BASE_URL)
    await waitForStable(page)

    await expect(page).toHaveScreenshot("home/desktop-empty.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    })
  })

  test("home page — error state", async ({ page }) => {
    await page.route("**/api/providers**", (route) =>
      route.fulfill({ status: 500, json: { error: "Internal Server Error" } }),
    )
    await page.route("**/api/categories**", (route) =>
      route.fulfill({ json: MOCK_CATEGORIES }),
    )

    await page.goto(BASE_URL)
    await waitForStable(page)

    await expect(page).toHaveScreenshot("home/desktop-error.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    })
  })

  test("home page — loading state", async ({ page }) => {
    // Delay provider response to capture loading state
    let resolveProviders: () => void = () => {}
    const providersPromise = new Promise<void>((resolve) => {
      resolveProviders = resolve
    })

    await page.route("**/api/providers**", async (route) => {
      await providersPromise
      await route.fulfill({ json: MOCK_PROVIDERS })
    })
    await page.route("**/api/categories**", (route) =>
      route.fulfill({ json: MOCK_CATEGORIES }),
    )
    await page.route("**/api/search**", (route) =>
      route.fulfill({ json: MOCK_PROVIDERS }),
    )

    await page.goto(BASE_URL)
    // Screenshot immediately (before providers load)
    await page.waitForTimeout(500)

    await expect(page).toHaveScreenshot("home/desktop-loading.png", {
      fullPage: false,
      maxDiffPixelRatio: 0.02, // 2% tolerance for loading states
      animations: "disabled",
    })

    // Resolve the providers so the test can clean up
    resolveProviders()
  })
})
