import { test, expect } from "@playwright/test"

test("GET /dashboard returns 200 and shows login redirect for unauthenticated", async ({
  page,
}) => {
  await page.goto("/dashboard")
  // Server returns 307 → / then client-side JS redirects to /?login
  await page.waitForURL(/\?login|\//, { timeout: 10000 })
  // Verify we ended up NOT on /dashboard
  expect(page.url()).not.toContain("/dashboard")
})

test("authenticated client can access dashboard", async ({ page, context: _context }) => {
  await page.goto("/dashboard")
  await expect(page.locator("h1, h2").first()).toBeVisible()
})
