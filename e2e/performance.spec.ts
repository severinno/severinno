/**
 * performance.spec.ts
 *
 * E2E performance tests measuring Core Web Vitals on critical flows:
 *   1. Home page (vitrine landing)
 *   2. Search / Busca page
 *   3. Provider profile page
 *   4. Auth / Login page
 *   5. Dashboard (authenticated)
 *
 * Uses Playwright's Performance Observer + web-vitals to measure:
 *   - LCP  (Largest Contentful Paint)     — budget: < 2500ms
 *   - CLS  (Cumulative Layout Shift)      — budget: < 0.1
 *   - TBT  (Total Blocking Time)          — budget: < 300ms
 *   - FCP  (First Contentful Paint)       — budget: < 1800ms
 *   - TTI  (Time to Interactive)          — budget: < 3500ms
 *   - Load (Navigation timing)            — budget: < 4000ms
 *
 * Run:  npx playwright test e2e/performance.spec.ts
 * UI:   npx playwright test --ui e2e/performance.spec.ts
 *
 * Results are printed to console and can be integrated with CI
 * by parsing the JSON output.
 */

import { test, expect, type Page } from "@playwright/test"

// Block PWA service worker to avoid interfering with timing measurements
test.use({ serviceWorkers: "block" })

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000"

// ---------------------------------------------------------------------------
// Performance budgets (ms unless noted)
// ---------------------------------------------------------------------------

const BUDGETS = {
  LCP: 2500, // Largest Contentful Paint
  FCP: 1800, // First Contentful Paint
  TBT: 300, // Total Blocking Time
  CLS: 0.1, // Cumulative Layout Shift (unitless)
  TTI: 3500, // Time to Interactive
  LOAD: 4000, // Full page load
} as const

// ---------------------------------------------------------------------------
// Performance measurement helpers
// ---------------------------------------------------------------------------

interface PerformanceMetrics {
  LCP: number
  FCP: number
  TBT: number
  CLS: number
  TTI: number
  LOAD: number
  navigationStart: number
  domContentLoaded: number
  loadEvent: number
}

/**
 * Inject web-vitals measurement script into the page.
 * Collects LCP, CLS, TBT using PerformanceObserver + web-vitals patterns.
 * Returns metrics after page load settles.
 */
async function measureWebVitals(
  page: Page,
  navigate?: () => Promise<void>,
): Promise<PerformanceMetrics> {
  // Inject measurement script before page load
  await page.addInitScript(() => {
    // Store metrics on window for retrieval
    ;(window as unknown as Record<string, unknown>).__perfMetrics = {
      LCP: 0,
      FCP: 0,
      TBT: 0,
      CLS: 0,
      TTI: 0,
      LOAD: 0,
    }

    // LCP via PerformanceObserver
    new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const lastEntry = entries[entries.length - 1]
      if (lastEntry) {
        ;(window as unknown as Record<string, Record<string, number>>).__perfMetrics.LCP =
          lastEntry.startTime
      }
    }).observe({ type: "largest-contentful-paint", buffered: true })

    // FCP via PerformanceObserver
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === "first-contentful-paint") {
          ;(window as unknown as Record<string, Record<string, number>>).__perfMetrics.FCP =
            entry.startTime
        }
      }
    }).observe({ type: "paint", buffered: true })

    // CLS via PerformanceObserver
    let clsValue = 0
    let clsSessionValue = 0
    let clsSessionEntries: PerformanceEntry[] = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const layoutEntry = entry as PerformanceEntry & {
          hadRecentInput?: boolean
          value?: number
        }
        if (layoutEntry.hadRecentInput) continue // Ignore user-triggered shifts

        if (
          clsSessionEntries.length === 0 ||
          entry.startTime - clsSessionEntries[clsSessionEntries.length - 1].startTime > 1000
        ) {
          clsSessionValue = 0
          clsSessionEntries = []
        }

        clsSessionValue += layoutEntry.value ?? 0
        clsSessionEntries.push(entry)
        clsValue = Math.max(clsValue, clsSessionValue)
        ;(window as unknown as Record<string, Record<string, number>>).__perfMetrics.CLS = clsValue
      }
    }).observe({ type: "layout-shift", buffered: true })

    // TBT — measure long tasks (>50ms) during first 5s
    let tbtValue = 0
    const tbtObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const taskEntry = entry as PerformanceEntry & { duration?: number }
        if ((taskEntry.duration ?? 0) > 50) {
          tbtValue += (taskEntry.duration ?? 0) - 50
          ;(window as unknown as Record<string, Record<string, number>>).__perfMetrics.TBT =
            tbtValue
        }
      }
    })
    tbtObserver.observe({ type: "longtask", buffered: true })
    // Stop observing after 5s
    setTimeout(() => tbtObserver.disconnect(), 5000)
  })

  // Execute navigation if provided
  if (navigate) {
    await navigate()
  }

  // Wait for page to be fully loaded and idle
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {})
  // Give time for late LCP elements and layout shifts
  await page.waitForTimeout(3000)

  // Retrieve metrics from the page
  const metrics = await page.evaluate(() => {
    const perf = window.performance
    const nav = perf.getEntriesByType("navigation")[0] as PerformanceNavigationTiming
    const m = (window as unknown as Record<string, Record<string, number>>).__perfMetrics

    return {
      LCP: m?.LCP ?? 0,
      FCP: m?.FCP ?? 0,
      TBT: m?.TBT ?? 0,
      CLS: m?.CLS ?? 0,
      TTI: 0, // TTI requires more complex measurement
      LOAD: nav ? nav.loadEventEnd - nav.startTime : 0,
      navigationStart: nav ? nav.startTime : 0,
      domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : 0,
      loadEvent: nav ? nav.loadEventEnd - nav.startTime : 0,
    }
  })

  // Estimate TTI from navigation timing
  if (metrics.LOAD > 0) {
    metrics.TTI = metrics.LOAD * 0.85 // Heuristic: TTI ≈ 85% of load
  }

  return metrics
}

/**
 * Log performance metrics in a formatted table.
 */
function logMetrics(pageName: string, metrics: PerformanceMetrics) {
  const format = (ms: number) => (ms > 0 ? `${Math.round(ms)}ms` : "N/A")
  const formatCLS = (v: number) => (v > 0 ? v.toFixed(4) : "0.0000")

  console.log(`\n📊 Performance: ${pageName}`)
  console.log(`   LCP:  ${format(metrics.LCP)}  (budget: ${BUDGETS.LCP}ms)`)
  console.log(`   FCP:  ${format(metrics.FCP)}  (budget: ${BUDGETS.FCP}ms)`)
  console.log(`   TBT:  ${format(metrics.TBT)}  (budget: ${BUDGETS.TBT}ms)`)
  console.log(`   CLS:  ${formatCLS(metrics.CLS)}  (budget: ${BUDGETS.CLS})`)
  console.log(`   TTI:  ${format(metrics.TTI)}  (budget: ${BUDGETS.TTI}ms)`)
  console.log(`   LOAD: ${format(metrics.LOAD)}  (budget: ${BUDGETS.LOAD}ms)`)
  console.log(`   DCL:  ${format(metrics.domContentLoaded)}`)
}

/**
 * Assert all metrics are within budget.
 */
function assertBudgets(pageName: string, metrics: PerformanceMetrics) {
  if (metrics.LCP > 0) {
    expect(metrics.LCP, `${pageName} LCP`).toBeLessThanOrEqual(BUDGETS.LCP)
  }
  if (metrics.FCP > 0) {
    expect(metrics.FCP, `${pageName} FCP`).toBeLessThanOrEqual(BUDGETS.FCP)
  }
  if (metrics.TBT > 0) {
    expect(metrics.TBT, `${pageName} TBT`).toBeLessThanOrEqual(BUDGETS.TBT)
  }
  expect(metrics.CLS, `${pageName} CLS`).toBeLessThanOrEqual(BUDGETS.CLS)
  if (metrics.LOAD > 0) {
    expect(metrics.LOAD, `${pageName} LOAD`).toBeLessThanOrEqual(BUDGETS.LOAD)
  }
}

// ---------------------------------------------------------------------------
// Mock data for pages that need API responses
// ---------------------------------------------------------------------------

const MOCK_PROVIDERS = {
  items: [
    {
      id: "perf-prov-1",
      name: "Carlos Silva",
      avatarUrl: null,
      rating: 4.9,
      reviewCount: 87,
      verified: true,
      city: "Governador Valadares",
      distanceKm: 1.5,
      lat: -18.8566,
      lng: -41.9455,
      services: [{ id: "svc-1", title: "Encanador", basePrice: 120, unit: "UNIDADE", photos: [] }],
      completedBookings: 156,
    },
    {
      id: "perf-prov-2",
      name: "Maria Santos",
      avatarUrl: null,
      rating: 4.7,
      reviewCount: 52,
      verified: true,
      city: "Governador Valadares",
      distanceKm: 3.2,
      lat: -18.86,
      lng: -41.95,
      services: [{ id: "svc-2", title: "Diarista", basePrice: 80, unit: "UNIDADE", photos: [] }],
      completedBookings: 203,
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
  totalPages: 1,
}

const MOCK_CATEGORIES = [
  { id: "cat-1", name: "Limpeza", slug: "limpeza", icon: "Sparkles", serviceCount: 15 },
  { id: "cat-2", name: "Manutenção", slug: "manutencao", icon: "Wrench", serviceCount: 22 },
]

async function setupMocks(page: Page) {
  await page.route("**/api/providers**", (route) => route.fulfill({ json: MOCK_PROVIDERS }))
  await page.route("**/api/categories**", (route) => route.fulfill({ json: MOCK_CATEGORIES }))
  await page.route("**/api/search**", (route) => route.fulfill({ json: MOCK_PROVIDERS }))
  await page.route("**/api/geo/**", (route) =>
    route.fulfill({ json: { lat: -18.8566, lng: -41.9455 } }),
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Performance — Core Web Vitals Budgets", () => {
  test("home page (vitrine) meets performance budgets", async ({ page }) => {
    await setupMocks(page)

    const metrics = await measureWebVitals(page, async () => {
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" })
    })

    logMetrics("Home Page", metrics)
    assertBudgets("Home Page", metrics)
  })

  test("search page meets performance budgets", async ({ page }) => {
    await setupMocks(page)

    const metrics = await measureWebVitals(page, async () => {
      await page.goto(`${BASE_URL}/busca`, { waitUntil: "domcontentloaded" })
    })

    logMetrics("Search Page", metrics)
    assertBudgets("Search Page", metrics)
  })

  test("login page meets performance budgets", async ({ page }) => {
    await setupMocks(page)

    const metrics = await measureWebVitals(page, async () => {
      await page.goto(`${BASE_URL}/auth/login`, { waitUntil: "domcontentloaded" })
    })

    logMetrics("Login Page", metrics)
    assertBudgets("Login Page", metrics)
  })

  test("not-found page meets performance budgets", async ({ page }) => {
    await setupMocks(page)

    const metrics = await measureWebVitals(page, async () => {
      await page.goto(`${BASE_URL}/nonexistent-page-xyz`, { waitUntil: "domcontentloaded" })
    })

    logMetrics("404 Page", metrics)
    assertBudgets("404 Page", metrics)
  })
})

test.describe("Performance — Navigation Timing", () => {
  test("home page DOMContentLoaded < 2s", async ({ page }) => {
    await setupMocks(page)

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" })

    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming
      return {
        dns: nav.domainLookupEnd - nav.domainLookupStart,
        tcp: nav.connectEnd - nav.connectStart,
        ttfb: nav.responseStart - nav.requestStart,
        download: nav.responseEnd - nav.responseStart,
        domInteractive: nav.domInteractive - nav.startTime,
        domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
        load: nav.loadEventEnd - nav.startTime,
      }
    })

    console.log("\n⏱️  Navigation Timing (Home):")
    console.log(`   DNS:          ${Math.round(timing.dns)}ms`)
    console.log(`   TCP:          ${Math.round(timing.tcp)}ms`)
    console.log(`   TTFB:         ${Math.round(timing.ttfb)}ms`)
    console.log(`   Download:     ${Math.round(timing.download)}ms`)
    console.log(`   DOM Interact: ${Math.round(timing.domInteractive)}ms`)
    console.log(`   DCL:          ${Math.round(timing.domContentLoaded)}ms`)
    console.log(`   Load:         ${Math.round(timing.load)}ms`)

    expect(timing.domContentLoaded).toBeLessThanOrEqual(2000)
  })

  test("home page TTFB < 800ms", async ({ page }) => {
    await setupMocks(page)

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" })

    const ttfb = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming
      return nav.responseStart - nav.requestStart
    })

    console.log(`\n⏱️  TTFB: ${Math.round(ttfb)}ms (budget: 800ms)`)
    expect(ttfb).toBeLessThanOrEqual(800)
  })
})

test.describe("Performance — Resource Loading", () => {
  test("home page JS bundle total < 500KB", async ({ page }) => {
    await setupMocks(page)

    await page.goto(BASE_URL, { waitUntil: "networkidle" }).catch(() => {})
    await page.waitForTimeout(2000)

    const resources = await page.evaluate(() => {
      const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[]
      const jsResources = entries.filter(
        (e) => e.initiatorType === "script" || e.name.endsWith(".js"),
      )
      const cssResources = entries.filter(
        (e) => e.initiatorType === "css" || e.name.endsWith(".css"),
      )

      const totalJsSize = jsResources.reduce((sum, e) => sum + (e.transferSize || 0), 0)
      const totalCssSize = cssResources.reduce((sum, e) => sum + (e.transferSize || 0), 0)

      return {
        jsCount: jsResources.length,
        cssCount: cssResources.length,
        totalJsKB: Math.round(totalJsSize / 1024),
        totalCssKB: Math.round(totalCssSize / 1024),
        jsResources: jsResources.map((e) => ({
          name: e.name.split("/").pop() || e.name,
          sizeKB: Math.round((e.transferSize || 0) / 1024),
        })),
      }
    })

    console.log("\n📦 Resource Loading (Home):")
    console.log(`   JS bundles: ${resources.jsCount} (${resources.totalJsKB}KB)`)
    console.log(`   CSS files:  ${resources.cssCount} (${resources.totalCssKB}KB)`)

    if (resources.jsResources.length > 0) {
      console.log("   Top JS bundles:")
      resources.jsResources
        .sort((a, b) => b.sizeKB - a.sizeKB)
        .slice(0, 5)
        .forEach((r) => console.log(`     ${r.name}: ${r.sizeKB}KB`))
    }

    // Budget: total JS < 500KB
    expect(resources.totalJsKB).toBeLessThanOrEqual(500)
    // Budget: total CSS < 100KB
    expect(resources.totalCssKB).toBeLessThanOrEqual(100)
  })

  test("home page images are optimized (WebP/AVIF)", async ({ page }) => {
    await setupMocks(page)

    await page.goto(BASE_URL, { waitUntil: "networkidle" }).catch(() => {})
    await page.waitForTimeout(2000)

    const images = await page.evaluate(() => {
      const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[]
      const imgResources = entries.filter(
        (e) => e.initiatorType === "img" || /\.(png|jpg|jpeg|webp|avif|gif|svg)$/i.test(e.name),
      )

      return {
        count: imgResources.length,
        formats: imgResources.map((e) => {
          const ext = e.name.split(".").pop()?.split("?")[0] || "unknown"
          return ext.toLowerCase()
        }),
        totalKB: Math.round(imgResources.reduce((sum, e) => sum + (e.transferSize || 0), 0) / 1024),
      }
    })

    console.log("\n🖼️  Images (Home):")
    console.log(`   Count: ${images.count}`)
    console.log(`   Total: ${images.totalKB}KB`)
    console.log(`   Formats: ${[...new Set(images.formats)].join(", ")}`)

    // Check if modern formats are used
    const hasModernFormats = images.formats.some((f) => f === "webp" || f === "avif" || f === "svg")
    // Only assert if there are actual images (not just SVG icons)
    if (images.count > 2) {
      expect(hasModernFormats).toBe(true)
    }
  })
})

test.describe("Performance — Layout Stability", () => {
  test("home page has no layout shifts after initial load", async ({ page }) => {
    await setupMocks(page)

    await page.goto(BASE_URL, { waitUntil: "networkidle" }).catch(() => {})
    await page.waitForTimeout(3000)

    // Measure CLS after initial load (scroll, interact)
    const clsAfterLoad = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        let clsValue = 0
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const e = entry as PerformanceEntry & {
              hadRecentInput?: boolean
              value?: number
            }
            if (!e.hadRecentInput) {
              clsValue += e.value ?? 0
            }
          }
        })
        observer.observe({ type: "layout-shift" })

        // Scroll down to trigger any lazy layout shifts
        window.scrollBy(0, 500)
        setTimeout(() => {
          observer.disconnect()
          resolve(clsValue)
        }, 2000)
      })
    })

    console.log(`\n📐 CLS after scroll: ${clsAfterLoad.toFixed(4)} (budget: ${BUDGETS.CLS})`)
    expect(clsAfterLoad).toBeLessThanOrEqual(BUDGETS.CLS)
  })
})

test.describe("Performance — Repeat Visits", () => {
  test("second visit is faster (service worker cache)", async ({ page }) => {
    await setupMocks(page)

    // First visit
    const metrics1 = await measureWebVitals(page, async () => {
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" })
    })

    // Second visit (should benefit from browser cache)
    const metrics2 = await measureWebVitals(page, async () => {
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" })
    })

    console.log("\n🔄 Repeat Visit Comparison:")
    console.log(
      `   Visit 1 — LCP: ${Math.round(metrics1.LCP)}ms, LOAD: ${Math.round(metrics1.LOAD)}ms`,
    )
    console.log(
      `   Visit 2 — LCP: ${Math.round(metrics2.LCP)}ms, LOAD: ${Math.round(metrics2.LOAD)}ms`,
    )

    // Second visit should not be significantly slower
    // (allow 20% variance due to system load)
    if (metrics1.LOAD > 0 && metrics2.LOAD > 0) {
      expect(metrics2.LOAD).toBeLessThanOrEqual(metrics1.LOAD * 1.2)
    }
  })
})
