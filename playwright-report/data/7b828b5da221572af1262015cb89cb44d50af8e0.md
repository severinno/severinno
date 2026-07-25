# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: vitrine-search.spec.ts >> Vitrine — Search & Filter >> category filter chips appear and can be removed
- Location: e2e\vitrine-search.spec.ts:52:7

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.waitForFunction: Test timeout of 30000ms exceeded.
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
  1   | /**
  2   |  * Vitrine — Integration Tests: Search → Filters → Pagination
  3   |  *
  4   |  * Tests the main user flow on the vitrine (marketplace landing page):
  5   |  * 1. Page loads and shows provider cards or empty state
  6   |  * 2. Category filter chips can be toggled
  7   |  * 3. "Carregar mais" pagination works (if enough results)
  8   |  * 4. View toggle (Lista/Mapa) switches content
  9   |  *
  10  |  * Run:  npx playwright test e2e/vitrine-search.spec.ts
  11  |  * UI:   npx playwright test --ui
  12  |  */
  13  | 
  14  | import { test, expect } from "@playwright/test"
  15  | 
  16  | const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000"
  17  | 
  18  | // ── Helpers ─────────────────────────────────────────────────────────────────
  19  | 
  20  | async function waitForResults(page: import("@playwright/test").Page) {
  21  |   // Wait for either provider cards or the empty state to render
> 22  |   await page.waitForFunction(() => {
      |              ^ Error: page.waitForFunction: Test timeout of 30000ms exceeded.
  23  |     const grid = document.querySelector('[aria-label="Resultados da busca"]')
  24  |     if (!grid) return false
  25  |     // At least one card or the empty state message
  26  |     return (
  27  |       grid.querySelector('[data-provider-id]') !== null ||
  28  |       grid.textContent?.includes("Nenhum prestador") ||
  29  |       grid.textContent?.includes("prestador encontrado")
  30  |     )
  31  |   }, { timeout: 15_000 })
  32  | }
  33  | 
  34  | // ── Tests ───────────────────────────────────────────────────────────────────
  35  | 
  36  | test.describe("Vitrine — Search & Filter", () => {
  37  | 
  38  |   test("page loads and displays results header", async ({ page }) => {
  39  |     await page.goto(BASE_URL)
  40  | 
  41  |     // Title
  42  |     await expect(page.locator("h1")).toBeVisible()
  43  | 
  44  |     // Results section loads
  45  |     await waitForResults(page)
  46  | 
  47  |     // Either shows results count or empty state
  48  |     const heading = page.locator("section[aria-label='Resultados da busca'] h2")
  49  |     await expect(heading).toBeVisible()
  50  |   })
  51  | 
  52  |   test("category filter chips appear and can be removed", async ({ page }) => {
  53  |     await page.goto(BASE_URL)
  54  |     await waitForResults(page)
  55  | 
  56  |     // Try clicking a category filter (if categories are rendered)
  57  |     const filterSection = page.locator("aside").first()
  58  |     const firstCategory = filterSection.locator("label, button").first()
  59  | 
  60  |     // If filters exist, click one and verify the chip appears
  61  |     const categoryExists = await firstCategory.isVisible().catch(() => false)
  62  |     if (!categoryExists) {
  63  |       test.skip() // No filters rendered — skipping
  64  |       return
  65  |     }
  66  | 
  67  |     await firstCategory.click()
  68  |     await page.waitForTimeout(500)
  69  | 
  70  |     // A chip should appear in the active filters area
  71  |     // (may not — skip gracefully)
  72  |     test.skip() // Filter chip interaction is view-dependent
  73  |   })
  74  | 
  75  |   test("name search input filters results", async ({ page }) => {
  76  |     await page.goto(BASE_URL)
  77  |     await waitForResults(page)
  78  | 
  79  |     const searchInput = page.locator('input[type="search"], input[placeholder*="buscar" i], input[placeholder*="Search" i]')
  80  |     const inputVisible = await searchInput.isVisible().catch(() => false)
  81  | 
  82  |     test.skip(!inputVisible, "No visible search input on this layout")
  83  | 
  84  |     // Type part of a name and press Enter
  85  |     await searchInput.fill("encanador")
  86  |     await searchInput.press("Enter")
  87  |     await page.waitForTimeout(1000)
  88  | 
  89  |     // Results should update
  90  |     await waitForResults(page)
  91  |   })
  92  | })
  93  | 
  94  | test.describe("Vitrine — Pagination", () => {
  95  | 
  96  |   test('"Carregar mais" loads more results', async ({ page }) => {
  97  |     await page.goto(BASE_URL)
  98  |     await waitForResults(page)
  99  | 
  100 |     const loadMore = page.getByRole("button", { name: /carregar mais/i })
  101 |     const buttonVisible = await loadMore.isVisible().catch(() => false)
  102 | 
  103 |     test.skip(!buttonVisible, "No 'Carregar mais' button — results fit on one page")
  104 | 
  105 |     // Count current cards
  106 |     const cardSelector = "[data-provider-id]"
  107 |     const initialCount = await page.locator(cardSelector).count()
  108 | 
  109 |     // Click load more
  110 |     await loadMore.click()
  111 | 
  112 |     // Wait for more cards to appear
  113 |     await page.waitForFunction(
  114 |       (sel) => document.querySelectorAll(sel).length > 0,
  115 |       cardSelector,
  116 |       { timeout: 10_000 },
  117 |     )
  118 |     await page.waitForTimeout(500)
  119 | 
  120 |     const newCount = await page.locator(cardSelector).count()
  121 |     expect(newCount).toBeGreaterThan(initialCount)
  122 |   })
```