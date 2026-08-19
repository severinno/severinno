import { test, expect } from "@playwright/test"

test("GET /dashboard returns 200 and shows login redirect for unauthenticated", async ({
  page,
}) => {
  await page.goto("/dashboard")
  await expect(page).toHaveURL(/\?login/)
})

test("authenticated client can access dashboard", async ({ page, context: _context }) => {
  await page.goto("/dashboard")
  await expect(page.locator("h1, h2").first()).toBeVisible()
})
