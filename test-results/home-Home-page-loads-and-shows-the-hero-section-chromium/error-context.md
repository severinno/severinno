# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: home.spec.ts >> Home page >> loads and shows the hero section
- Location: e2e\home.spec.ts:4:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('h1')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('h1')

```

```yaml
- banner
- main:
  - complementary
- contentinfo
- region "Notifications alt+T"
- alert
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test"
  2  | 
  3  | test.describe("Home page", () => {
  4  |   test("loads and shows the hero section", async ({ page }) => {
  5  |     const response = await page.goto("/")
  6  |     expect(response?.ok()).toBeTruthy()
  7  | 
> 8  |     await expect(page.locator("h1")).toBeVisible()
     |                                      ^ Error: expect(locator).toBeVisible() failed
  9  |     await expect(page.getByPlaceholder(/buscar/i)).toBeVisible()
  10 |   })
  11 | 
  12 |   test("shows category showcase", async ({ page }) => {
  13 |     await page.goto("/")
  14 |     const categorySection = page.locator("text=/Categorias|Serviços/i").first()
  15 |     await expect(page.locator("header, main")).toBeVisible()
  16 |   })
  17 | 
  18 |   test("search input works on hero", async ({ page }) => {
  19 |     await page.goto("/")
  20 |     const searchInput = page.getByPlaceholder(/buscar/i)
  21 |     await expect(searchInput).toBeVisible()
  22 |     await searchInput.fill("eletricista")
  23 |     await expect(searchInput).toHaveValue("eletricista")
  24 |   })
  25 | 
  26 |   test("has footer with brand name", async ({ page }) => {
  27 |     await page.goto("/")
  28 |     await expect(page.locator("footer")).toBeVisible()
  29 |     await expect(page.locator("footer")).toContainText(/severinno/i)
  30 |   })
  31 | })
  32 | 
```