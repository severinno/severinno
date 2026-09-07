import { test, expect } from "@playwright/test"

test.describe("PWA Manifest & Service Worker", () => {
  test("validates manifest.json structure, icons and shortcuts", async ({ request }) => {
    const response = await request.get("/manifest.json")
    expect(response.ok()).toBeTruthy()
    expect(response.headers()["content-type"]).toContain("application/json")

    const manifest = await response.json()
    expect(manifest.name).toBe("Severinno — Marketplace de Serviços")
    expect(manifest.short_name).toBe("Severinno")
    expect(manifest.display).toBe("standalone")
    expect(manifest.start_url).toContain("pwa")
    expect(manifest.scope).toBe("/")

    // Check icons
    expect(Array.isArray(manifest.icons)).toBeTruthy()
    const icon192 = manifest.icons.find((i: { sizes: string }) => i.sizes === "192x192")
    const icon512 = manifest.icons.find((i: { sizes: string }) => i.sizes === "512x512")
    expect(icon192).toBeDefined()
    expect(icon512).toBeDefined()

    // Check shortcuts (including provider shortcuts)
    expect(Array.isArray(manifest.shortcuts)).toBeTruthy()
    const shortcutUrls = manifest.shortcuts.map((s: { url: string }) => s.url)
    expect(shortcutUrls.some((u: string) => u.includes("tab=quotes"))).toBeTruthy()
    expect(shortcutUrls.some((u: string) => u.includes("tab=services"))).toBeTruthy()
  })

  test("serves sw.js with offline cache and sync capabilities", async ({ request }) => {
    const response = await request.get("/sw.js")
    expect(response.ok()).toBeTruthy()

    const body = await response.text()
    expect(body).toContain("ASSETS")
    expect(body).toContain('"/offline"')
    expect(body).toContain("self.addEventListener")
  })

  test("renders offline fallback page correctly", async ({ page }) => {
    const response = await page.goto("/offline")
    expect(response?.ok()).toBeTruthy()

    await expect(page.locator("h1")).toContainText(/Sem conexão/i)
    const retryBtn = page.getByRole("button", { name: /Tentar novamente/i })
    await expect(retryBtn).toBeVisible()
  })
})

test.describe("Mobile Viewport & PWA Meta Tags", () => {
  test("renders Apple and mobile web app meta tags in html head", async ({ page }) => {
    await page.goto("/")

    const manifestLink = page.locator('link[rel="manifest"]')
    await expect(manifestLink).toHaveAttribute("href", "/manifest.json")

    const appleMobileWebApp = page.locator('meta[name="apple-mobile-web-app-capable"]')
    await expect(appleMobileWebApp).toHaveAttribute("content", "yes")

    const mobileWebAppCapable = page.locator('meta[name="mobile-web-app-capable"]')
    await expect(mobileWebAppCapable).toHaveAttribute("content", "yes")
  })

  test("scales properly on mobile viewport (iPhone 16 / Pixel)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/")

    await expect(page.locator("header, main").first()).toBeVisible()
    const body = page.locator("body")
    await expect(body).toBeVisible()
  })
})
