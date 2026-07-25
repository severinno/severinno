# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: dashboard.spec.ts >> authenticated client can access dashboard
- Location: e2e\dashboard.spec.ts:8:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('h1, h2').first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('h1, h2').first()

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
  3  | test("GET /dashboard returns 200 and shows login redirect for unauthenticated", async ({ page }) => {
  4  |   await page.goto("/dashboard")
  5  |   await expect(page).toHaveURL(/\?login/)
  6  | })
  7  | 
  8  | test("authenticated client can access dashboard", async ({ page, context }) => {
  9  |   await page.goto("/dashboard")
> 10 |   await expect(page.locator("h1, h2").first()).toBeVisible()
     |                                                ^ Error: expect(locator).toBeVisible() failed
  11 | })
  12 | 
```