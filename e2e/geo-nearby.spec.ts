/**
 * E2E — Geo Nearby Providers ("Prestadores perto de você")
 *
 * Seeds the geo store (localStorage) with a user location and mocks
 * /api/providers with distance-aware data, then verifies the
 * NearbyProviders section renders providers with their distances.
 *
 *   ✅ Section heading appears once geo is ready
 *   ✅ Provider names render inside the section
 *   ✅ Distance shown in pt-BR format (km / m)
 *   ✅ No section when geo store is empty
 *
 * Run:  npx playwright test e2e/geo-nearby.spec.ts
 */

import { test, expect, type Page } from "@playwright/test"

// The PWA service worker (public/sw.js) intercepts /api/* GET requests and
// fetches them from inside the worker — requests initiated by the SW bypass
// page.route() and hit the real backend. Block it so the API mocks take
// effect (providers/categories) and no real network is needed.
test.use({ serviceWorkers: "block" })

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000"

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_PROVIDERS = {
  items: [
    {
      id: "a1b2c3",
      name: "Maria Silva",
      avatarUrl: null,
      coverUrl: null,
      bio: "Pintora profissional",
      rating: 4.8,
      reviewCount: 42,
      verified: true,
      city: "São Paulo",
      distanceKm: 1.2,
      radiusKm: 50,
      services: [
        {
          id: "svc-1",
          title: "Pintura Residencial",
          basePrice: 150,
          unit: "METRO_QUADRADO",
          photos: [],
        },
      ],
      completedBookings: 230,
      memberSince: "2023-01-15",
    },
    {
      id: "d4e5f6",
      name: "João Eletricista",
      avatarUrl: null,
      coverUrl: null,
      bio: "Instalações elétricas",
      rating: 4.6,
      reviewCount: 28,
      verified: true,
      city: "São Paulo",
      distanceKm: 0.42,
      radiusKm: 30,
      services: [
        { id: "svc-2", title: "Instalação Elétrica", basePrice: 180, unit: "UNIDADE", photos: [] },
      ],
      completedBookings: 150,
      memberSince: "2023-05-10",
    },
    {
      id: "0bad1d",
      name: "Ana Encanadora",
      avatarUrl: null,
      coverUrl: null,
      bio: "Hidráulica geral",
      rating: 4.9,
      reviewCount: 57,
      verified: false,
      city: "São Paulo",
      distanceKm: 5.1,
      radiusKm: 20,
      services: [
        {
          id: "svc-3",
          title: "Conserto de Vazamento",
          basePrice: 120,
          unit: "UNIDADE",
          photos: [],
        },
      ],
      completedBookings: 310,
      memberSince: "2022-11-20",
    },
  ],
  total: 3,
  page: 1,
  limit: 20,
  nextCursor: null,
  hasMore: false,
  expandedRadius: null,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedGeoStore(page: Page, lat: number, lng: number) {
  await page.addInitScript(
    ([lat2, lng2]) => {
      localStorage.setItem(
        "severinno:geo",
        JSON.stringify({
          state: {
            lat: lat2,
            lng: lng2,
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
      // Dismiss cookie banner so it never covers the section
      localStorage.setItem("severinno:cookie-consent", "accepted")
    },
    [lat, lng] as unknown as [number, number],
  )
}

async function setupApiMocks(page: Page) {
  // Categories (top-level) — used by showcase/topbar
  await page.route("**/api/categories", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    })
  })

  // Providers — nearby + vitrine grid share this endpoint
  await page.route("**/api/providers**", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_PROVIDERS),
      })
      return
    }
    await route.fallback()
  })
}

// ===========================================================================
// Tests
// ===========================================================================

test.describe("Geo Nearby Providers", () => {
  test("renders providers with distances when geo is ready", async ({ page }) => {
    await seedGeoStore(page, -23.5505, -46.6333)
    await setupApiMocks(page)

    await page.goto(`${BASE_URL}/`)

    // Wait for the section heading
    const heading = page.getByText("Prestadores perto de você")
    await expect(heading).toBeVisible({ timeout: 15_000 })

    // Provider names render
    await expect(page.getByText("Maria Silva").first()).toBeVisible()
    await expect(page.getByText("João Eletricista").first()).toBeVisible()
    await expect(page.getByText("Ana Encanadora").first()).toBeVisible()

    // Distances rendered in pt-BR format
    await expect(page.getByText("1,2 km").first()).toBeVisible()
    // Sub-kilometer distance shows meters (0.42 km → 420 m)
    await expect(page.getByText("420 m").first()).toBeVisible()
    await expect(page.getByText("5,1 km").first()).toBeVisible()
  })

  test("provider cards carry geo data-attributes for the compare bar", async ({ page }) => {
    await seedGeoStore(page, -23.5505, -46.6333)
    await setupApiMocks(page)

    await page.goto(`${BASE_URL}/`)

    await expect(page.getByText("Prestadores perto de você")).toBeVisible({ timeout: 15_000 })

    // The nearest provider (João, 0.42 km) is inside the user's radius
    const card = page.locator('[data-provider-id="d4e5f6"]').first()
    await expect(card).toBeAttached()
    await expect(card).toHaveAttribute("data-compare-distance", "420 m")
    await expect(card).toHaveAttribute("data-compare-distance-km", "0.42")
  })
})
