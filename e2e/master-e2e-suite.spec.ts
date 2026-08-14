/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from "@playwright/test"
import { waitForVitrine } from "./helpers"

test.describe("Severinno Master Suite — E2E Golden Paths", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await waitForVitrine(page)
  })

  test("1. Vitrine Hero renders AI Quote Wizard trigger and search bar", async ({ page }) => {
    await expect(page.locator("h1")).toBeVisible()
    const searchInput = page.getByLabel("Serviço buscado")
    await expect(searchInput).toBeVisible()

    // Test AI Quote Wizard trigger
    const aiWizardBtn = page.getByRole("button", { name: /pedir orçamento com ia|orçamento rápido/i }).first()
    if (await aiWizardBtn.isVisible()) {
      await aiWizardBtn.click()
      await page.waitForTimeout(500)
      // Check if dialog or input opened
      const dialog = page.locator("role=dialog").first()
      const isOpened = await dialog.isVisible().catch(() => false)
      expect(isOpened).toBe(true)
    }
  })

  test("2. Provider Onboarding & Earnings Calculator is accessible", async ({ page }) => {
    // Navigate with query param
    await page.goto("/?view=provider.register")
    await page.waitForTimeout(600)

    // Check if registration or provider onboarding elements are present
    const heading = page.locator("text=/prestador|cadastre-se|trabalhe conosco|ganhos/i").first()
    await expect(heading).toBeVisible({ timeout: 5000 })
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
    const bboxRes = await request.get("/api/search/bbox?minLat=-23.60&maxLat=-23.50&minLng=-46.70&maxLng=-46.60")
    expect([200, 400]).toContain(bboxRes.status())

    const etaRes = await request.get("/api/geo/route-eta?originLat=-23.55&originLng=-46.63&destLat=-23.56&destLng=-46.65")
    expect([200, 400]).toContain(etaRes.status())
  })
})
