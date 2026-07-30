/**
 * E2E — Admin Geo-Metrics Dashboard
 *
 * Navigates to /admin/geo-metrics and verifies the GiSTSelectivitySection
 * renders with mocked API data via route interception.
 *
 * Run:  npx playwright test e2e/admin-geo-metrics.spec.ts
 * UI:   npx playwright test --ui
 *
 * NOTE: Requires the dev server to be running on BASE_URL (default :3000).
 */

import { test, expect, type Page } from "@playwright/test"

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000"

// =========================================================================
// Mock factories
// =========================================================================

type ServiceMetrics = {
  p50: number
  p95: number
  p99: number
  count: number
  errorRate: number
  lastSampleAt: number
  errorCount: number
}

type Services = Record<string, ServiceMetrics>

type HistoryEntry = {
  timestamp: number
  services: Record<string, { p50: number; p95: number; p99: number; count: number }>
}

type GeoMetricsResponse = {
  services: Services
  timestamp: number
  windowSeconds: number
  labels: Record<string, string>
  benchmark: {
    meta: { timestamp: string; platform: string; nodeVersion: string; centerLabel: string }
    comparisons: Array<{
      label: string
      scale: number
      haversine: { mean: number; opsPerSec: number }
      postgis: { mean: number; opsPerSec: number }
      ratio: number
    }>
    analysis: { note: string; avgHaversinePerProvider: number }
  } | null
  history: HistoryEntry[]
  baselines: Record<string, number>
}

function createMockGeoMetrics(): GeoMetricsResponse {
  const now = Date.now()

  const services: Services = {
    nominatim: {
      p50: 142,
      p95: 890,
      p99: 1200,
      count: 847,
      errorRate: 0.02,
      lastSampleAt: now,
      errorCount: 17,
    },
    viacep: {
      p50: 85,
      p95: 430,
      p99: 600,
      count: 312,
      errorRate: 0.01,
      lastSampleAt: now,
      errorCount: 3,
    },
    postgis: {
      p50: 12,
      p95: 45,
      p99: 120,
      count: 2301,
      errorRate: 0.005,
      lastSampleAt: now,
      errorCount: 11,
    },
  }

  const history: HistoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
    timestamp: now - (4 - i) * 60_000,
    services: {
      nominatim: { p50: 130 + i * 10, p95: 800 + i * 20, p99: 1100 + i * 30, count: 150 + i * 10 },
      viacep: { p50: 75 + i * 5, p95: 400 + i * 10, p99: 550 + i * 15, count: 60 + i * 5 },
      postgis: { p50: 10 + i * 2, p95: 40 + i * 3, p99: 100 + i * 5, count: 400 + i * 50 },
    },
  }))

  return {
    services,
    timestamp: now,
    windowSeconds: 900,
    labels: {
      nominatim: "Nominatim (OSM)",
      viacep: "ViaCEP",
      postgis: "PostGIS",
    },
    benchmark: {
      meta: {
        timestamp: new Date(now).toISOString(),
        platform: "win32",
        nodeVersion: "v22.14.0",
        centerLabel: "-23.5505, -46.6333",
      },
      comparisons: [
        {
          label: "100 providers",
          scale: 100,
          haversine: { mean: 49.78, opsPerSec: 20088 },
          postgis: { mean: 4200, opsPerSec: 238 },
          ratio: 84.4,
        },
        {
          label: "1 000 providers",
          scale: 1000,
          haversine: { mean: 497.8, opsPerSec: 2009 },
          postgis: { mean: 24000, opsPerSec: 42 },
          ratio: 48.2,
        },
        {
          label: "10 000 providers",
          scale: 10000,
          haversine: { mean: 4978, opsPerSec: 201 },
          postgis: { mean: 222000, opsPerSec: 4.5 },
          ratio: 44.6,
        },
      ],
      analysis: {
        note: "Haversine JS é significativamente mais rápido que PostGIS para buscas de providers em São Paulo.",
        avgHaversinePerProvider: 0.4978,
      },
    },
    history,
    baselines: { nominatim: 400, viacep: 250, postgis: 30 },
  }
}

// =========================================================================
// Helpers
// =========================================================================

/**
 * Set up route interception for the geo-metrics dashboard.
 *
 * Uses addInitScript for /api/auth/me (returns local Response directly
 * without a network round-trip) and page.route for /api/admin/geo-metrics
 * (returns cached mock data).
 *
 * NOTE: addInitScript receives a JavaScript string (NOT TypeScript).
 * No type annotations in the browser-evaluated code!
 */
async function setupGeoMetricsMocks(page: Page) {
  // 1. Mock auth — return admin user so the 403 guard in the route passes
  await page.addInitScript(`
    (() => {
      var __origFetch = window.fetch.bind(window);
      window.fetch = async function(url, opts) {
        opts = opts || {};
        var path;
        if (typeof url === 'string') {
          path = new URL(url, location.origin).pathname;
        } else if (url instanceof URL) {
          path = url.pathname;
        } else {
          path = new URL(url.url, location.origin).pathname;
        }

        // GET /api/auth/me — admin user
        if (path.endsWith('/api/auth/me') && (!opts.method || opts.method === 'GET')) {
          return new Response(JSON.stringify({
            user: { id: "admin-mock", name: "Admin", email: "admin@severinno.com.br", role: "ADMIN", avatarUrl: null }
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // All other requests pass through
        return __origFetch(url, opts);
      };
    })();
  `)

  // 2. Mock geo-metrics API via network interception
  await page.route("**/api/admin/geo-metrics", async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(createMockGeoMetrics()),
    })
  })
}

// =========================================================================
// Tests
// =========================================================================

test.describe("Admin Geo-Metrics Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await setupGeoMetricsMocks(page)
  })

  // ── Page Load & Structure ──────────────────────────────────────────

  test("page loads and shows the geo-metrics title", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/geo-metrics`)

    await expect(page.getByText("Métricas de Geolocalização")).toBeVisible({ timeout: 15_000 })
  })

  test("GiSTSelectivitySection renders with selectivity heading", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/geo-metrics`)

    await expect(page.getByText("Curva de Seletividade — GiST Index vs Haversine")).toBeVisible({
      timeout: 15_000,
    })
  })

  // ── Radius Selector ────────────────────────────────────────────────

  test("radius selector with all 4 preset buttons is visible", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/geo-metrics`)

    await expect(page.getByText("Selecionar Raio de Busca")).toBeVisible({ timeout: 15_000 })

    for (const km of [5, 15, 30, 50] as const) {
      await expect(page.getByRole("button", { name: `${km} km` })).toBeVisible()
    }
  })

  test("selectivity percentage shows 9% at default 15 km", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/geo-metrics`)

    await expect(page.getByText("Selecionar Raio de Busca")).toBeVisible({ timeout: 15_000 })

    // At 15km with REFERENCE_RADIUS_KM=50: (15/50)² = 0.09 → 9%
    await expect(page.getByText("9%").first()).toBeVisible()
  })

  // ── Cost & Crossover Tables ────────────────────────────────────────

  test("cost table shows provider counts and regime indicators", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/geo-metrics`)

    await expect(page.getByText(/Custo Estimado em/)).toBeVisible({ timeout: 15_000 })

    // Table headers
    await expect(page.getByText("Providers").first()).toBeVisible()
    await expect(page.getByText("PostGIS (ms)").first()).toBeVisible()
    await expect(page.getByText("Haversine (ms)").first()).toBeVisible()
    await expect(page.getByText("Regime").first()).toBeVisible()

    // Regime badges
    await expect(page.getByText(/GiST vence em/)).toBeVisible()
    await expect(page.getByText(/Haversine vence em/)).toBeVisible()
  })

  test("crossover table renders with provider counts", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/geo-metrics`)

    await expect(page.getByText("Pontos de Crossover")).toBeVisible({ timeout: 15_000 })

    await expect(page.getByText("Raio equivalente*")).toBeVisible()
    await expect(page.getByText("Seletividade")).toBeVisible()
  })

  test("measured vs model table renders with delta values", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/geo-metrics`)

    await expect(page.getByText("Modelo vs Medição (Full Scan)")).toBeVisible({ timeout: 15_000 })

    await expect(page.getByText("Modelo (ms)")).toBeVisible()
    await expect(page.getByText("Medido (ms)")).toBeVisible()
    await expect(page.getByText("Δ").first()).toBeVisible()
  })

  // ── Analysis / Interpretation ──────────────────────────────────────

  test("interpretation card shows regime descriptions", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/geo-metrics`)

    await expect(page.getByText("Interpretação")).toBeVisible({ timeout: 15_000 })

    await expect(page.getByText(/Regime GiST \(verde\)/)).toBeVisible()
    await expect(page.getByText(/Regime Haversine/)).toBeVisible()
  })

  // ── Interactive: Radius Preset Click ───────────────────────────────

  test("clicking 5 km radius updates selectivity to 0%", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/geo-metrics`)

    await expect(page.getByText("Selecionar Raio de Busca")).toBeVisible({ timeout: 15_000 })

    await page.getByRole("button", { name: "5 km" }).click()

    // At 5km: selectivity = (5/50)² = 1% → snapped to 0%
    // Use toBeVisible with timeout for retry — handles slow re-renders
    await expect(page.getByText("0%").first()).toBeVisible({ timeout: 5000 })
  })

  test("clicking 50 km radius updates selectivity to 100%", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/geo-metrics`)

    await expect(page.getByText("Selecionar Raio de Busca")).toBeVisible({ timeout: 15_000 })

    await page.getByRole("button", { name: "50 km" }).click()

    // At 50km: selectivity = (50/50)² = 100%
    await expect(page.getByText("100%").first()).toBeVisible({ timeout: 5000 })
  })

  // ── KPI Cards ──────────────────────────────────────────────────────

  test("KPI cards display header metrics", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/geo-metrics`)

    await expect(page.getByText(/Chamadas \(janela\)/)).toBeVisible({ timeout: 15_000 })

    await expect(page.getByText(/P95 Máximo/)).toBeVisible()
    await expect(page.getByText(/Erros/)).toBeVisible()
    await expect(page.getByText(/Serviços Saudáveis/)).toBeVisible()
  })

  // ── Console Errors ─────────────────────────────────────────────────

  test("page renders without console errors", async ({ page }) => {
    const errors: string[] = []

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text())
      }
    })

    page.on("pageerror", (err) => {
      errors.push(err.message)
    })

    await page.goto(`${BASE_URL}/admin/geo-metrics`)
    await expect(page.getByText("Métricas de Geolocalização")).toBeVisible({ timeout: 15_000 })

    await expect(page.getByText(/Curva de Seletividade/)).toBeVisible()

    // Allow known React 19 dev-mode warnings
    const filtered = errors.filter(
      (e) =>
        !e.includes("inside a test was not wrapped in act") && !e.includes("ReactDOMTestUtils.act"),
    )
    expect(filtered).toEqual([])
  })
})
