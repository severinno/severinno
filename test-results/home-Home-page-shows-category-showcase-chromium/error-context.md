# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: home.spec.ts >> Home page >> shows category showcase
- Location: e2e\home.spec.ts:12:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('header, main')
Expected: visible
Error: strict mode violation: locator('header, main') resolved to 2 elements:
    1) <header class="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">…</header> aka getByRole('banner')
    2) <main class="flex-1">…</main> aka getByRole('main')

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('header, main')

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]
    - main [ref=e10]:
      - complementary [ref=e22]
    - contentinfo [ref=e45]
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e69]:
      - generic [ref=e70]:
        - generic [ref=e71]:
          - navigation [ref=e72]:
            - button "previous" [disabled] [ref=e73]:
              - img "previous" [ref=e74]
            - generic [ref=e76]:
              - generic [ref=e77]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e78]:
              - img "next" [ref=e79]
          - img
        - generic [ref=e81]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e82] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e83]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e85]: Next.js 16.1.3 (stale)
            - generic [ref=e86]: Turbopack
          - img
      - dialog "Build Error" [ref=e88]:
        - generic [ref=e91]:
          - generic [ref=e92]:
            - generic [ref=e93]:
              - generic [ref=e95]: Build Error
              - generic [ref=e96]:
                - button "Copy Error Info" [ref=e97] [cursor=pointer]:
                  - img [ref=e98]
                - button "No related documentation found" [disabled] [ref=e100]:
                  - img [ref=e101]
                - button "Attach Node.js inspector" [ref=e103] [cursor=pointer]:
                  - img [ref=e104]
            - generic [ref=e113]: Reading source code for parsing failed
          - generic [ref=e115]:
            - generic [ref=e117]:
              - img [ref=e119]
              - generic [ref=e123]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e124] [cursor=pointer]:
                - img [ref=e126]
            - generic [ref=e130]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e131]: "1"
        - generic [ref=e132]: "2"
    - generic [ref=e137] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e138]:
        - img [ref=e139]
      - button "Open issues overlay" [ref=e143]:
        - generic [ref=e144]:
          - generic [ref=e145]: "0"
          - generic [ref=e146]: "1"
        - generic [ref=e147]: Issue
  - alert [ref=e148]
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
  8  |     await expect(page.locator("h1")).toBeVisible()
  9  |     await expect(page.getByPlaceholder(/buscar/i)).toBeVisible()
  10 |   })
  11 | 
  12 |   test("shows category showcase", async ({ page }) => {
  13 |     await page.goto("/")
  14 |     const categorySection = page.locator("text=/Categorias|Serviços/i").first()
> 15 |     await expect(page.locator("header, main")).toBeVisible()
     |                                                ^ Error: expect(locator).toBeVisible() failed
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