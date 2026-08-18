/**
 * E2E — Geo Compare Flow (CompareBar + CompareModal)
 *
 * Verifies the distance-aware comparison flow on the vitrine:
 *
 *   ✅ Compare icon on a provider card adds it to the selection
 *   ✅ Compare bar shows a chip per provider with formatted distance
 *   ✅ "+próx" badge marks the closest provider (data-compare-distance-km)
 *   ✅ "Comparar" button opens the modal
 *   ✅ Modal shows "Mais próximo" badge on the closest provider
 *
 * All APIs are intercepted — no external network needed.
 *
 * Run:  npx playwright test e2e/geo-compare.spec.ts
 */

import { test, expect, type Page } from "@playwright/test"

// The PWA service worker (public/sw.js) intercepts /api/* GET requests and
// fetches them from inside the worker — requests initiated by the SW bypass
// page.route() and hit the real backend. Block it so the API mocks take
// effect (providers/detail/categories) and no real network is needed.
test.use({ serviceWorkers: "block" })

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000"

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const PROVIDERS = [
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
    distanceKm: 2.5,
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
    distanceKm: 1.2,
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
    distanceKm: 9.8,
    radiusKm: 20,
    services: [
      { id: "svc-3", title: "Conserto de Vazamento", basePrice: 120, unit: "UNIDADE", photos: [] },
    ],
    completedBookings: 310,
    memberSince: "2022-11-20",
  },
]

function providerDetail(p: (typeof PROVIDERS)[number]) {
  return {
    ...p,
    whatsapp: "11999999999",
    address: "Av. Paulista, 1000",
    district: "Bela Vista",
    state: "SP",
    cep: "01310-100",
    availability: [{ id: "av-1", dayOfWeek: 1, startTime: "08:00", endTime: "18:00" }],
    reviews: [],
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupApiMocks(page: Page) {
  await page.addInitScript(() => {
    // Dismiss cookie banner (fixed bottom bar would overlap the compare bar)
    localStorage.setItem("severinno:cookie-consent", "accepted")
    // Clean compare state from previous runs
    localStorage.removeItem("severinno-compare")
  })

  await page.route("**/api/categories", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
  })

  // Provider list — registered BEFORE the detail routes: Playwright checks
  // routes in reverse registration order (last wins), and the broad
  // "**/api/providers**" pattern also matches "/api/providers/{id}", so it
  // would shadow the detail mocks below if registered after them.
  await page.route("**/api/providers**", async (route, request) => {
    if (request.method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: PROVIDERS,
          total: PROVIDERS.length,
          page: 1,
          limit: 20,
          nextCursor: null,
          hasMore: false,
          expandedRadius: null,
        }),
      })
      return
    }
    await route.fallback()
  })

  // Provider detail — the modal fetches each provider by id
  for (const p of PROVIDERS) {
    await page.route(`**/api/providers/${p.id}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(providerDetail(p)),
      })
    })
  }
}

// ===========================================================================
// Tests
// ===========================================================================

test.describe("Geo Compare Flow", () => {
  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page)
    await page.goto(`${BASE_URL}/`)
    // Wait for provider cards to render
    await expect(page.locator('[data-provider-id="a1b2c3"]').first()).toBeAttached({
      timeout: 15_000,
    })
  })

  test("compare bar shows distance chips after selecting two providers", async ({ page }) => {
    // Select Maria (2.5 km) and João (1.2 km)
    await page.getByLabel("Adicionar Maria Silva à comparação").click()
    await page.getByLabel("Adicionar João Eletricista à comparação").click()

    // Compare bar appears with counter
    await expect(page.getByText("Comparar prestadores")).toBeVisible()
    await expect(page.getByText(/2 de 3 selecionado/)).toBeVisible()

    // Distance chips read from the cards' data-attributes
    await expect(page.getByText("· 2,5 km")).toBeVisible()
    await expect(page.getByText("· 1,2 km")).toBeVisible()
  })

  test("'+próx' badge marks the closest selected provider", async ({ page }) => {
    await page.getByLabel("Adicionar Maria Silva à comparação").click() // 2.5 km
    await page.getByLabel("Adicionar João Eletricista à comparação").click() // 1.2 km

    await expect(page.getByText("+próx")).toBeVisible()

    // Exactly one badge with 2 providers (João is closest)
    await expect(page.getByText("+próx")).toHaveCount(1)
  })

  test("selecting the far provider too keeps '+próx' on the closest", async ({ page }) => {
    await page.getByLabel("Adicionar Maria Silva à comparação").click() // 2.5 km
    await page.getByLabel("Adicionar João Eletricista à comparação").click() // 1.2 km
    await page.getByLabel("Adicionar Ana Encanadora à comparação").click() // 9.8 km

    await expect(page.getByText("· 9,8 km")).toBeVisible()
    await expect(page.getByText("+próx")).toHaveCount(1)
  })

  test("modal opens and shows 'Mais próximo' on the closest provider", async ({ page }) => {
    await page.getByLabel("Adicionar Maria Silva à comparação").click()
    await page.getByLabel("Adicionar João Eletricista à comparação").click()

    // Exact match — the topbar also has a "Comparar N prestador(es)" icon button
    await page.getByRole("button", { name: "Comparar", exact: true }).click()

    // Modal content (distance + closest badge). Anchored regex — the modal
    // footer also contains the substring "…mais próximo." in a sentence, so
    // a plain substring match would resolve to 2 elements.
    const closestBadge = page.getByText(/^Mais próximo$/)
    await expect(closestBadge).toBeVisible({ timeout: 10_000 })
    // Closest is João (1.2 km) — Maria (2.5 km) does not get the badge
    await expect(closestBadge).toHaveCount(1)
  })

  test("removing a provider from the bar updates the chips", async ({ page }) => {
    await page.getByLabel("Adicionar Maria Silva à comparação").click()
    await page.getByLabel("Adicionar João Eletricista à comparação").click()

    await expect(page.getByText("· 2,5 km")).toBeVisible()
    await expect(page.getByText("· 1,2 km")).toBeVisible()

    // The card's compare toggle flips to "Remover … da comparação" when
    // selected, so there are two matching buttons (card + bar chip). The bar
    // renders last in the DOM — click its chip's remove button.
    await page.getByLabel("Remover Maria Silva da comparação").last().click()

    await expect(page.getByText("· 2,5 km")).not.toBeVisible()
    await expect(page.getByText("· 1,2 km")).toBeVisible()
  })
})
