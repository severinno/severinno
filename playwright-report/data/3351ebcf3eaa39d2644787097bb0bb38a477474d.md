# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: a11y.spec.ts >> Full Accessibility Audit (all pages) >> Busca (/busca): relatório completo de violações @full-audit
- Location: e2e\a11y.spec.ts:207:9

# Error details

```
Error: Busca: console errors found

expect(received).toHaveLength(expected)

Expected length: 0
Received length: 14
Received array:  ["./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
Reading source code for parsing failed
An unexpected error happened while trying to read the source code to parse: failed to convert rope into string·
Caused by:
- invalid utf-8 sequence of 1 bytes from index 5415·
Import trace:
  App Route:
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts", "./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
Reading source code for parsing failed
An unexpected error happened while trying to read the source code to parse: failed to convert rope into string·
Caused by:
- invalid utf-8 sequence of 1 bytes from index 5415·
Import trace:
  App Route:
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/stats/public/route.ts", "./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
Reading source code for parsing failed
An unexpected error happened while trying to read the source code to parse: failed to convert rope into string·
Caused by:
- invalid utf-8 sequence of 1 bytes from index 5415·
Import trace:
  App Route:
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/reviews/recent/route.ts", "./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
Reading source code for parsing failed
An unexpected error happened while trying to read the source code to parse: failed to convert rope into string·
Caused by:
- invalid utf-8 sequence of 1 bytes from index 5415·
Import trace:
  App Route:
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/providers/route.ts", "./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
Reading source code for parsing failed
An unexpected error happened while trying to read the source code to parse: failed to convert rope into string·
Caused by:
- invalid utf-8 sequence of 1 bytes from index 5415·
Import trace:
  App Route:
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/categories/route.ts", "./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
Reading source code for parsing failed
An unexpected error happened while trying to read the source code to parse: failed to convert rope into string·
Caused by:
- invalid utf-8 sequence of 1 bytes from index 5415·
Import trace:
  App Route:
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/login/route.ts", "./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
Reading source code for parsing failed
An unexpected error happened while trying to read the source code to parse: failed to convert rope into string·
Caused by:
- invalid utf-8 sequence of 1 bytes from index 5415·
Import trace:
  App Route:
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts", "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up. This can happen if a SSR-ed Client Component used:·
- A server/client branch `if (typeof window !== 'undefined')`.
- Variable input such as `Date.now()` or `Math.random()` which changes each time it's called.
- Date formatting in a user's locale which doesn't match the server.
- External changing data without sending a snapshot of it along with the HTML.
- Invalid HTML tag nesting.·
It can also happen if the client has a browser extension installed which messes with the HTML before React loaded.·
%s%s https://react.dev/link/hydration-mismatch··
  ...
    <HotReload globalError={[...]} webSocket={WebSocket} staticIndicatorState={{pathname:null, ...}}>
      <AppDevOverlayErrorBoundary globalError={[...]}>
        <ReplaySsrOnlyErrors>
        <DevRootHTTPAccessFallbackBoundary>
          <HTTPAccessFallbackBoundary notFound={<NotAllowedRootHTTPFallbackError>}>
            <HTTPAccessFallbackErrorBoundary pathname=\"/busca\" notFound={<NotAllowedRootHTTPFallbackError>} ...>
              <RedirectBoundary>
                <RedirectErrorBoundary router={{...}}>
                  <Head>
                  <__next_root_layout_boundary__>
                    <SegmentViewNode type=\"layout\" pagePath=\"/.freebuff...\">
                      <SegmentTrieNode>
                      <link>
                      <script>
                      <script>
                      <script>
                      <RootLayout>
                        <html lang=\"pt-BR\" suppressHydrationWarning={true}>
                          <body
                            className=\"geist_a71539c9-module__T19VSG__variable geist_mono_8d43a2aa-module__8Li5zG__var...\"
-                           style={{overflow-x:\"hidden\",overflow-y:\"hidden\"}}
                          >
                  ...
", "./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
Reading source code for parsing failed
An unexpected error happened while trying to read the source code to parse: failed to convert rope into string·
Caused by:
- invalid utf-8 sequence of 1 bytes from index 5415·
Import trace:
  App Route:
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts", "./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
Reading source code for parsing failed
An unexpected error happened while trying to read the source code to parse: failed to convert rope into string·
Caused by:
- invalid utf-8 sequence of 1 bytes from index 5415·
Import trace:
  App Route:
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts", …]
```

# Page snapshot

```yaml
- generic:
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e5]:
          - navigation [ref=e6]:
            - button "previous" [disabled] [ref=e7]:
              - img "previous" [ref=e8]
            - generic [ref=e10]:
              - generic [ref=e11]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e12]:
              - img "next" [ref=e13]
          - img
        - generic [ref=e15]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e16] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e17]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e19]: Next.js 16.1.3 (stale)
            - generic [ref=e20]: Turbopack
          - img
      - dialog "Build Error" [ref=e22]:
        - generic [ref=e25]:
          - generic [ref=e26]:
            - generic [ref=e27]:
              - generic [ref=e29]: Build Error
              - generic [ref=e30]:
                - button "Copy Error Info" [ref=e31] [cursor=pointer]:
                  - img [ref=e32]
                - button "No related documentation found" [disabled] [ref=e34]:
                  - img [ref=e35]
                - button "Attach Node.js inspector" [ref=e37] [cursor=pointer]:
                  - img [ref=e38]
            - generic [ref=e47]: Reading source code for parsing failed
          - generic [ref=e49]:
            - generic [ref=e51]:
              - img [ref=e53]
              - generic [ref=e57]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e58] [cursor=pointer]:
                - img [ref=e60]
            - generic [ref=e64]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e65]: "1"
        - generic [ref=e66]: "2"
    - generic [ref=e71] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e72]:
        - img [ref=e73]
      - button "Open issues overlay" [ref=e77]:
        - generic [ref=e78]:
          - generic [ref=e79]: "0"
          - generic [ref=e80]: "1"
        - generic [ref=e81]: Issue
  - alert [ref=e82]
```

# Test source

```ts
  25  | // ── Helpers ───────────────────────────────────────────────────────────────
  26  | 
  27  | type A11yResult = {
  28  |   violations: number
  29  |   critical: number
  30  |   serious: number
  31  |   moderate: number
  32  |   minor: number
  33  | }
  34  | 
  35  | /**
  36  |  * Run axe-core audit on the given page.
  37  |  * Returns a summary of violations grouped by impact level.
  38  |  */
  39  | async function auditPage(page: import("@playwright/test").Page): Promise<{
  40  |   result: A11yResult
  41  |   raw: import("axe-core").AxeResults
  42  | }> {
  43  |   // Build axe with common exclusions for third-party UI libraries
  44  |   const builder = new AxeBuilder({ page })
  45  |     .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
  46  |     .disableRules([
  47  |       // Radix UI dialog/alert uses aria-describedby on dynamically-mounted content
  48  |       "aria-dialog-name",
  49  |       // Recharts SVGs may have nested interactive children
  50  |       "svg-img-alt",
  51  |       // MapLibre canvas elements
  52  |       "image-redundant-alt",
  53  |     ])
  54  | 
  55  |   const raw = await builder.analyze()
  56  | 
  57  |   const result: A11yResult = {
  58  |     violations: raw.violations.length,
  59  |     critical: raw.violations.filter((v) => v.impact === "critical").length,
  60  |     serious: raw.violations.filter((v) => v.impact === "serious").length,
  61  |     moderate: raw.violations.filter((v) => v.impact === "moderate").length,
  62  |     minor: raw.violations.filter((v) => v.impact === "minor").length,
  63  |   }
  64  | 
  65  |   return { result, raw }
  66  | }
  67  | 
  68  | /**
  69  |  * Monitor JS console errors and failed network requests during page load.
  70  |  * Must be registered BEFORE page.goto() to capture all events.
  71  |  *
  72  |  * Failed network requests from known non-actionable sources (favicon 404,
  73  |  * analytics beacons, etc.) are filtered out so that only unexpected
  74  |  * application errors cause test failures.
  75  |  */
  76  | async function collectErrors(
  77  |   page: import("@playwright/test").Page,
  78  | ): Promise<{ consoleErrors: string[]; failedRequests: string[] }> {
  79  |   const consoleErrors: string[] = []
  80  |   const failedRequests: string[] = []
  81  | 
  82  |   // Console errors (JS runtime errors logged with console.error)
  83  |   // Note: Chromium logs network 404s to console.error as well, but without
  84  |   // the URL in the message text. These are redundant with requestfailed events
  85  |   // which we track separately with precise URL filtering. We ignore them here
  86  |   // to avoid double-reporting.
  87  |   page.on("console", (msg) => {
  88  |     if (msg.type() === "error") {
  89  |       const text = msg.text()
  90  |       // Ignore Chromium's redundant resource-error messages
  91  |       if (text.includes("Failed to load resource")) {
  92  |         return
  93  |       }
  94  |       consoleErrors.push(text)
  95  |     }
  96  |   })
  97  | 
  98  |   // Failed network requests (404s, DNS failures, etc.)
  99  |   page.on("requestfailed", (request) => {
  100 |     const url = request.url()
  101 |     // Ignore known non-actionable failures
  102 |     if (
  103 |       url.includes("favicon.ico") ||           // Next.js dev-mode favicon
  104 |       url.endsWith(".map") ||                    // Source maps
  105 |       url.includes("sockjs-node")              // Webpack HMR
  106 |     ) {
  107 |       return
  108 |     }
  109 |     failedRequests.push(url)
  110 |   })
  111 | 
  112 |   return { consoleErrors, failedRequests }
  113 | }
  114 | 
  115 | /**
  116 |  * Assert that no unexpected errors occurred during page load.
  117 |  */
  118 | function expectNoErrors(
  119 |   errors: { consoleErrors: string[]; failedRequests: string[] },
  120 |   pageName: string,
  121 | ) {
  122 |   expect(
  123 |     errors.consoleErrors,
  124 |     `${pageName}: console errors found`,
> 125 |   ).toHaveLength(0)
      |     ^ Error: Busca: console errors found
  126 |   expect(
  127 |     errors.failedRequests,
  128 |     `${pageName}: failed network requests found: ${errors.failedRequests.join(", ")}`,
  129 |   ).toHaveLength(0)
  130 | }
  131 | 
  132 | /**
  133 |  * Print a readable summary of violations to the Playwright output.
  134 |  */
  135 | function printViolations(result: A11yResult, raw: import("axe-core").AxeResults, pageName: string) {
  136 |    
  137 |   console.log(`
  138 | ╔══════════════════════════════════════════════════╗
  139 | ║  Accessibility Audit — ${pageName.padEnd(27)}║
  140 | ╠══════════════════════════════════════════════════╣
  141 | ║  Total violations: ${result.violations.toString().padStart(5)}                    ║
  142 | ║    🔴 Critical:     ${result.critical.toString().padStart(5)}                    ║
  143 | ║    🟠 Serious:      ${result.serious.toString().padStart(5)}                    ║
  144 | ║    🟡 Moderate:     ${result.moderate.toString().padStart(5)}                    ║
  145 | ║    🔵 Minor:        ${result.minor.toString().padStart(5)}                    ║
  146 | ╚══════════════════════════════════════════════════╝
  147 | `)
  148 | 
  149 |   // Print details for each violation
  150 |   for (const v of raw.violations) {
  151 |      
  152 |     console.log(`  [${v.impact?.toUpperCase() ?? "N/A"}] ${v.id}: ${v.help}`)
  153 |      
  154 |     console.log(`         Tags: ${v.tags.join(", ")}`)
  155 |      
  156 |     console.log(`         Help: ${v.helpUrl}`)
  157 |      
  158 |     console.log(`         Elements: ${v.nodes.map((n) => n.target.join(", ")).join(" | ")}`)
  159 |      
  160 |     console.log("")
  161 |   }
  162 | }
  163 | 
  164 | // ── Pages to audit ───────────────────────────────────────────────────────
  165 | // Shared by all test suites — add new pages here to include them everywhere.
  166 | const PAGES = [
  167 |   { path: "/", name: "Home" },
  168 |   { path: "/busca", name: "Busca" },
  169 |   { path: "/login", name: "Login" },
  170 |   { path: "/register", name: "Register" },
  171 | ] as const
  172 | 
  173 | // ── Tests ─────────────────────────────────────────────────────────────────
  174 | 
  175 | test.describe("Accessibility Audit", () => {
  176 |   // Increase timeout for axe-core analysis
  177 |   test.describe.configure({ timeout: 60_000 })
  178 | 
  179 |   for (const { path, name } of PAGES) {
  180 |     test(`${name} (${path}): não deve ter violações críticas ou sérias @a11y`, async ({ page }) => {
  181 |       const errors = await collectErrors(page)
  182 |       await page.goto(path)
  183 |       await page.waitForLoadState("networkidle")
  184 |       await page.waitForTimeout(1_000)
  185 | 
  186 |       const { result, raw } = await auditPage(page)
  187 | 
  188 |       printViolations(result, raw, name)
  189 | 
  190 |       // No critical or serious violations allowed
  191 |       expect(
  192 |         result.critical + result.serious,
  193 |         `Found ${result.critical} critical + ${result.serious} serious violations on ${path}`,
  194 |       ).toBe(0)
  195 | 
  196 |       // No unexpected console errors or failed requests
  197 |       expectNoErrors(errors, name)
  198 |     })
  199 |   }
  200 | })
  201 | 
  202 | // ── Full Audit (runs only with --grep @full-audit) ──────────────────────
  203 | test.describe("Full Accessibility Audit (all pages)", () => {
  204 |   test.describe.configure({ timeout: 120_000 })
  205 | 
  206 |   for (const { path, name } of PAGES) {
  207 |     test(`${name} (${path}): relatório completo de violações @full-audit`, async ({ page }) => {
  208 |       const errors = await collectErrors(page)
  209 |       await page.goto(path)
  210 |       await page.waitForLoadState("networkidle")
  211 |       await page.waitForTimeout(1_000)
  212 | 
  213 |       const { result, raw } = await auditPage(page)
  214 | 
  215 |       printViolations(result, raw, name)
  216 | 
  217 |       // In full audit mode, report all violations but only fail on critical+serious
  218 |       expect(
  219 |         result.critical + result.serious,
  220 |         `Found ${result.critical} critical + ${result.serious} serious violations on ${path}.`,
  221 |       ).toBe(0)
  222 | 
  223 |       expectNoErrors(errors, name)
  224 |     })
  225 |   }
```