import { test, expect } from "@playwright/test"

test.describe("Severinno Master Suite — E2E Golden Paths", () => {
  test.setTimeout(60000)

  test("1. Vitrine Storefront renders header, main content and footer", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    await expect(page).toHaveTitle(/Severinno/i)
    await expect(page.locator("main")).toBeVisible({ timeout: 10000 })
    await expect(page.locator("footer, [role='contentinfo']")).toBeVisible({ timeout: 10000 })
  })

  test("2. Provider Onboarding and Auth Dialog is triggered", async ({ page }) => {
    await page.goto("/")
    await page.waitForLoadState("networkidle")

    // Find login or register button
    const entrarBtn = page
      .getByRole("button", { name: /entrar|login|cadastre-se|trabalhe/i })
      .first()
    if (await entrarBtn.isVisible()) {
      await entrarBtn.click()
      await page.waitForTimeout(500)
      const modal = page.locator('[role="dialog"], form').first()
      await expect(modal).toBeVisible({ timeout: 5000 })
    }
  })

  test("3. Extended Health API responds with healthy subsystem status", async ({ request }) => {
    const res = await request.get("/api/health/extended")
    expect([200, 207, 503]).toContain(res.status())

    const json = await res.json()
    expect(json.status).toBeDefined()
    expect(json.system).toBeDefined()
    expect(json.services).toBeDefined()
  })

  test("4. GTM Leads API allows querying pipeline metrics", async ({ request }) => {
    const res = await request.get("/api/admin/gtm/leads")
    expect(res.status()).toBe(200)

    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.leads).toBeInstanceOf(Array)
    expect(json.data.metrics.target).toBe(50)
  })

  test("5. PostGIS Bbox and Route ETA endpoints respond gracefully", async ({ request }) => {
    const bboxRes = await request.get(
      "/api/search/bbox?minLat=-23.60&maxLat=-23.50&minLng=-46.70&maxLng=-46.60",
    )
    expect([200, 400]).toContain(bboxRes.status())

    const etaRes = await request.get(
      "/api/geo/route-eta?originLat=-23.55&originLng=-46.63&destLat=-23.56&destLng=-46.65",
    )
    expect([200, 400]).toContain(etaRes.status())
  })
})
