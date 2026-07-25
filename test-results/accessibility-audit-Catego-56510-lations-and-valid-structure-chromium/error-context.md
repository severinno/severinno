# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accessibility-audit.spec.ts >> CategoriaReparos (/categoria/reparos) >> has no accessibility violations and valid structure
- Location: e2e\accessibility-audit.spec.ts:172:9

# Error details

```
Error: expect(received).toHaveLength(expected)

Expected length: 0
Received length: 10
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
    ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts", "%o·
%s Error: @prisma/client did not initialize yet. Please run \"prisma generate\" and try to import it again.
    at createPrismaClient (about://React/Server/C:%5CPROJETOS%5Cseverinno%5C.freebuff%5Cworktrees%5Cthmrzp9vv9y86o%5C.next%5Cdev%5Cserver%5Cchunks%5Cssr%5C%5Broot-of-the-server%5D__5e799ebc._.js?229:141:18)
    at module evaluation (about://React/Server/C:%5CPROJETOS%5Cseverinno%5C.freebuff%5Cworktrees%5Cthmrzp9vv9y86o%5C.next%5Cdev%5Cserver%5Cchunks%5Cssr%5C%5Broot-of-the-server%5D__5e799ebc._.js?230:152:38)
    at <anonymous> (about://React/Server/C:%5CPROJETOS%5Cseverinno%5C.freebuff%5Cworktrees%5Cthmrzp9vv9y86o%5C.next%5Cdev%5Cserver%5Cchunks%5Cssr%5C_freebuff_worktrees_thmrzp9vv9y86o_src_lib_db_ts_2321cd88._.js?231:8:16)
    at  Page (about://React/Server/C:%5CPROJETOS%5Cseverinno%5C.freebuff%5Cworktrees%5Cthmrzp9vv9y86o%5C.next%5Cdev%5Cserver%5Cchunks%5Cssr%5C%5Broot-of-the-server%5D__c46a1670._.js?232:151:20)
    at resolveErrorDev (http://localhost:3000/_next/static/chunks/4b6fc_next_dist_compiled_react-server-dom-turbopack_5dd4833c._.js:1881:148)
    at processFullStringRow (http://localhost:3000/_next/static/chunks/4b6fc_next_dist_compiled_react-server-dom-turbopack_5dd4833c._.js:2389:29)
    at processFullBinaryRow (http://localhost:3000/_next/static/chunks/4b6fc_next_dist_compiled_react-server-dom-turbopack_5dd4833c._.js:2348:9)
    at processBinaryChunk (http://localhost:3000/_next/static/chunks/4b6fc_next_dist_compiled_react-server-dom-turbopack_5dd4833c._.js:2457:221)
    at progress (http://localhost:3000/_next/static/chunks/4b6fc_next_dist_compiled_react-server-dom-turbopack_5dd4833c._.js:2625:13) The above error occurred in the <Page> component. It was handled by the <ErrorBoundaryHandler> error boundary.", "[ErrorBoundary] Error: @prisma/client did not initialize yet. Please run \"prisma generate\" and try to import it again.
    at createPrismaClient (about://React/Server/C:%5CPROJETOS%5Cseverinno%5C.freebuff%5Cworktrees%5Cthmrzp9vv9y86o%5C.next%5Cdev%5Cserver%5Cchunks%5Cssr%5C%5Broot-of-the-server%5D__5e799ebc._.js?229:141:18)
    at module evaluation (about://React/Server/C:%5CPROJETOS%5Cseverinno%5C.freebuff%5Cworktrees%5Cthmrzp9vv9y86o%5C.next%5Cdev%5Cserver%5Cchunks%5Cssr%5C%5Broot-of-the-server%5D__5e799ebc._.js?230:152:38)
    at <anonymous> (about://React/Server/C:%5CPROJETOS%5Cseverinno%5C.freebuff%5Cworktrees%5Cthmrzp9vv9y86o%5C.next%5Cdev%5Cserver%5Cchunks%5Cssr%5C_freebuff_worktrees_thmrzp9vv9y86o_src_lib_db_ts_2321cd88._.js?231:8:16)
    at  Page (about://React/Server/C:%5CPROJETOS%5Cseverinno%5C.freebuff%5Cworktrees%5Cthmrzp9vv9y86o%5C.next%5Cdev%5Cserver%5Cchunks%5Cssr%5C%5Broot-of-the-server%5D__c46a1670._.js?232:151:20)
    at resolveErrorDev (http://localhost:3000/_next/static/chunks/4b6fc_next_dist_compiled_react-server-dom-turbopack_5dd4833c._.js:1881:148)
    at processFullStringRow (http://localhost:3000/_next/static/chunks/4b6fc_next_dist_compiled_react-server-dom-turbopack_5dd4833c._.js:2389:29)
    at processFullBinaryRow (http://localhost:3000/_next/static/chunks/4b6fc_next_dist_compiled_react-server-dom-turbopack_5dd4833c._.js:2348:9)
    at processBinaryChunk (http://localhost:3000/_next/static/chunks/4b6fc_next_dist_compiled_react-server-dom-turbopack_5dd4833c._.js:2457:221)
    at progress (http://localhost:3000/_next/static/chunks/4b6fc_next_dist_compiled_react-server-dom-turbopack_5dd4833c._.js:2625:13)", "[ErrorBoundary] Error: @prisma/client did not initialize yet. Please run \"prisma generate\" and try to import it again.
    at createPrismaClient (about://React/Server/C:%5CPROJETOS%5Cseverinno%5C.freebuff%5Cworktrees%5Cthmrzp9vv9y86o%5C.next%5Cdev%5Cserver%5Cchunks%5Cssr%5C%5Broot-of-the-server%5D__5e799ebc._.js?229:141:18)
    at module evaluation (about://React/Server/C:%5CPROJETOS%5Cseverinno%5C.freebuff%5Cworktrees%5Cthmrzp9vv9y86o%5C.next%5Cdev%5Cserver%5Cchunks%5Cssr%5C%5Broot-of-the-server%5D__5e799ebc._.js?230:152:38)
    at <anonymous> (about://React/Server/C:%5CPROJETOS%5Cseverinno%5C.freebuff%5Cworktrees%5Cthmrzp9vv9y86o%5C.next%5Cdev%5Cserver%5Cchunks%5Cssr%5C_freebuff_worktrees_thmrzp9vv9y86o_src_lib_db_ts_2321cd88._.js?231:8:16)
    at  Page (about://React/Server/C:%5CPROJETOS%5Cseverinno%5C.freebuff%5Cworktrees%5Cthmrzp9vv9y86o%5C.next%5Cdev%5Cserver%5Cchunks%5Cssr%5C%5Broot-of-the-server%5D__c46a1670._.js?232:151:20)
    at resolveErrorDev (http://localhost:3000/_next/static/chunks/4b6fc_next_dist_compiled_react-server-dom-turbopack_5dd4833c._.js:1881:148)
    at processFullStringRow (http://localhost:3000/_next/static/chunks/4b6fc_next_dist_compiled_react-server-dom-turbopack_5dd4833c._.js:2389:29)
    at processFullBinaryRow (http://localhost:3000/_next/static/chunks/4b6fc_next_dist_compiled_react-server-dom-turbopack_5dd4833c._.js:2348:9)
    at processBinaryChunk (http://localhost:3000/_next/static/chunks/4b6fc_next_dist_compiled_react-server-dom-turbopack_5dd4833c._.js:2457:221)
    at progress (http://localhost:3000/_next/static/chunks/4b6fc_next_dist_compiled_react-server-dom-turbopack_5dd4833c._.js:2625:13)"]
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e4]:
      - img [ref=e9]
      - generic [ref=e12]: "500"
      - heading "Erro interno" [level=1] [ref=e14]
      - paragraph [ref=e16]: Ocorreu um erro inesperado. Nossa equipe já foi notificada.
      - generic [ref=e17]:
        - button "Tentar novamente" [ref=e18]:
          - img [ref=e19]
          - text: Tentar novamente
        - link "Voltar ao início" [ref=e24] [cursor=pointer]:
          - /url: /
          - img [ref=e25]
          - text: Voltar ao início
      - generic [ref=e28]:
        - img [ref=e29]
        - generic [ref=e38]: "Ref: 1172065160"
    - contentinfo [ref=e39]:
      - paragraph [ref=e40]: © 2026 Severinno. Todos os direitos reservados.
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e43]:
      - generic [ref=e44]:
        - generic [ref=e45]:
          - navigation [ref=e46]:
            - button "previous" [disabled] [ref=e47]:
              - img "previous" [ref=e48]
            - generic [ref=e50]:
              - generic [ref=e51]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e52]:
              - img "next" [ref=e53]
          - img
        - generic [ref=e55]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e56] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e57]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e59]: Next.js 16.1.3 (stale)
            - generic [ref=e60]: Turbopack
          - img
      - dialog "Build Error" [ref=e62]:
        - generic [ref=e65]:
          - generic [ref=e66]:
            - generic [ref=e67]:
              - generic [ref=e69]: Build Error
              - generic [ref=e70]:
                - button "Copy Error Info" [ref=e71] [cursor=pointer]:
                  - img [ref=e72]
                - button "No related documentation found" [disabled] [ref=e74]:
                  - img [ref=e75]
                - button "Attach Node.js inspector" [ref=e77] [cursor=pointer]:
                  - img [ref=e78]
            - generic [ref=e87]: Reading source code for parsing failed
          - generic [ref=e89]:
            - generic [ref=e91]:
              - img [ref=e93]
              - generic [ref=e97]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e98] [cursor=pointer]:
                - img [ref=e100]
            - generic [ref=e104]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e105]: "1"
        - generic [ref=e106]: "2"
    - generic [ref=e111] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e112]:
        - img [ref=e113]
      - button "Open issues overlay" [ref=e117]:
        - generic [ref=e118]:
          - generic [ref=e119]: "0"
          - generic [ref=e120]: "1"
        - generic [ref=e121]: Issue
  - alert [ref=e122]
```

# Test source

```ts
  63  | 
  64  | // Seed credentials (must match prisma/seed.ts)
  65  | const SEED_PROVIDER_EMAIL = "carlos@severinno.com"
  66  | const SEED_PROVIDER_PASS = "provider123"
  67  | 
  68  | // ===========================================================================
  69  | // Helpers
  70  | // ===========================================================================
  71  | 
  72  | /**
  73  |  * Configure the page to mock an authenticated session.
  74  |  *
  75  |  * 1. Seeds localStorage with the Zustand persist state so the auth store
  76  |  *    hydrates as "authenticated" on page load.
  77  |  * 2. Intercepts `/api/auth/me` so any session-verification call returns
  78  |  *    the mock user instead of hitting the real DB.
  79  |  * 3. Stubs data APIs that would fail without real data.
  80  |  */
  81  | async function mockAuth(page: Page, user: typeof MOCK_CLIENT | typeof MOCK_PROVIDER) {
  82  |   // ── 1. Seed Zustand persist in localStorage ──
  83  |   await page.addInitScript((u) => {
  84  |     localStorage.setItem("severinno:auth", JSON.stringify({
  85  |       state: { user: u, status: "authenticated" },
  86  |       version: 0,
  87  |     }))
  88  |   }, user)
  89  | 
  90  |   // ── 2. Intercept API routes ──
  91  |   await page.route("**/api/auth/me", async (route) => {
  92  |     await route.fulfill({
  93  |       status: 200,
  94  |       contentType: "application/json",
  95  |       body: JSON.stringify({ user }),
  96  |     })
  97  |   })
  98  | 
  99  |   // ── 3. Stub data APIs that need real DB ──
  100 |   for (const pattern of ["**/api/bookings**", "**/api/quotes**", "**/api/notifications**"]) {
  101 |     await page.route(pattern, async (route) => {
  102 |       await route.fulfill({
  103 |         status: 200,
  104 |         contentType: "application/json",
  105 |         body: JSON.stringify({ items: [], total: 0 }),
  106 |       })
  107 |     })
  108 |   }
  109 | }
  110 | 
  111 | /**
  112 |  * Run axe-core on the current page and assert results.
  113 |  */
  114 | async function runAxe(page: Page, label: string) {
  115 |   const results = await new AxeBuilder({ page })
  116 |     .disableRules(DISABLE_RULES)
  117 |     .analyze()
  118 | 
  119 |   const allViolations = results.violations
  120 |   const seriousViolations = allViolations.filter(
  121 |     (v) => v.impact === "critical" || v.impact === "serious",
  122 |   )
  123 | 
  124 |   if (allViolations.length > 0) {
  125 |     console.log(`\n══ ${label} — ${allViolations.length} violation(s) ══`)
  126 |     for (const v of allViolations) {
  127 |       console.log(`\n  [${v.id}] ${v.help}`)
  128 |       console.log(`  Impact: ${v.impact}`)
  129 |       console.log(`  Help: ${v.helpUrl}`)
  130 |       for (const node of v.nodes) {
  131 |         const html = node.html.length > 120
  132 |           ? node.html.slice(0, 120) + "..."
  133 |           : node.html
  134 |         console.log(`  → ${html}`)
  135 |       }
  136 |     }
  137 |   }
  138 | 
  139 |   expect(seriousViolations).toHaveLength(0)
  140 |   expect(allViolations.length).toBeLessThanOrEqual(3)
  141 | }
  142 | 
  143 | /**
  144 |  * Collect console errors during navigation, filter expected noise, and assert.
  145 |  */
  146 | async function collectAndAssertErrors(
  147 |   label: string,
  148 |   consoleErrors: string[],
  149 | ) {
  150 |   const realErrors = consoleErrors.filter(
  151 |     (e) =>
  152 |       !e.includes("WebSocket") &&
  153 |       !e.includes("ERR_CONNECTION_REFUSED") &&
  154 |       !e.includes("favicon.ico") &&
  155 |       !e.includes("404"),
  156 |   )
  157 |   if (realErrors.length > 0) {
  158 |     console.log(`\n── ${label} — ${realErrors.length} console error(s) ──`)
  159 |     for (const err of realErrors) {
  160 |       console.log(`  ❌ ${err.slice(0, 150)}`)
  161 |     }
  162 |   }
> 163 |   expect(realErrors).toHaveLength(0)
      |                      ^ Error: expect(received).toHaveLength(expected)
  164 | }
  165 | 
  166 | // ===========================================================================
  167 | // PUBLIC PAGES
  168 | // ===========================================================================
  169 | 
  170 | for (const { path, label, waitUntil } of PAGES) {
  171 |   test.describe(`${label} (${path})`, () => {
  172 |     test("has no accessibility violations and valid structure", async ({ page }) => {
  173 |       const consoleErrors: string[] = []
  174 |       page.on("console", (msg) => {
  175 |         if (msg.type() === "error") consoleErrors.push(msg.text())
  176 |       })
  177 | 
  178 |       await page.goto(path, { waitUntil })
  179 | 
  180 |       // ── Page title ──
  181 |       const title = await page.title()
  182 |       expect(title.trim()).toBeTruthy()
  183 | 
  184 |       // ── Footer landmark ──
  185 |       await expect(page.locator("footer")).toBeAttached()
  186 | 
  187 |       // ── Console errors ──
  188 |       await collectAndAssertErrors(label, consoleErrors)
  189 | 
  190 |       // ── Axe-core ──
  191 |       await runAxe(page, label)
  192 |     })
  193 |   })
  194 | }
  195 | 
  196 | // ===========================================================================
  197 | // PROVIDER PROFILE — uses login API to get a valid user ID
  198 | // ===========================================================================
  199 | 
  200 | test.describe("ProviderProfile (/u/[id])", () => {
  201 |   test("has no accessibility violations", async ({ page }) => {
  202 |     const consoleErrors: string[] = []
  203 |     page.on("console", (msg) => {
  204 |       if (msg.type() === "error") consoleErrors.push(msg.text())
  205 |     })
  206 | 
  207 |     // ── Login as a seeded provider to obtain a real user ID ──
  208 |     let providerPath = "/u/nao-existe" // fallback
  209 |     try {
  210 |       const loginRes = await page.request.post("/api/auth/login", {
  211 |         data: { email: SEED_PROVIDER_EMAIL, password: SEED_PROVIDER_PASS },
  212 |       })
  213 |       if (loginRes.ok()) {
  214 |         const loginData = await loginRes.json()
  215 |         if (loginData?.user?.id) {
  216 |           providerPath = `/u/${loginData.user.id}`
  217 |           console.log(`  ↳ Logged in as ${SEED_PROVIDER_EMAIL}, ID: ${loginData.user.id}`)
  218 |         }
  219 |       }
  220 |     } catch {
  221 |       console.log("  ↳ Login API unavailable — testing 404 fallback")
  222 |     }
  223 | 
  224 |     await page.goto(providerPath, { waitUntil: "load" })
  225 | 
  226 |     const title = await page.title()
  227 |     expect(title.trim()).toBeTruthy()
  228 |     await expect(page.locator("footer")).toBeAttached()
  229 | 
  230 |     await collectAndAssertErrors("ProviderProfile", consoleErrors)
  231 |     await runAxe(page, `ProviderProfile (${providerPath})`)
  232 |   })
  233 | })
  234 | 
  235 | // ===========================================================================
  236 | // AUTHENTICATED PAGES — mocked via localStorage + API interception
  237 | // ===========================================================================
  238 | 
  239 | for (const [role, user] of [
  240 |   ["CLIENT", MOCK_CLIENT] as const,
  241 |   ["PROVIDER", MOCK_PROVIDER] as const,
  242 | ]) {
  243 |   test.describe(`Dashboard (mocked ${role} auth)`, () => {
  244 |     test("has no accessibility violations", async ({ page }) => {
  245 |       const consoleErrors: string[] = []
  246 |       page.on("console", (msg) => {
  247 |         if (msg.type() === "error") consoleErrors.push(msg.text())
  248 |       })
  249 | 
  250 |       await mockAuth(page, user)
  251 |       // Use "load" — dashboard may open WebSocket connections that prevent
  252 |       // "networkidle" from ever resolving.
  253 |       await page.goto("/dashboard", { waitUntil: "load" })
  254 | 
  255 |       const title = await page.title()
  256 |       expect(title.trim()).toBeTruthy()
  257 | 
  258 |       // Wait for the authenticated panel to render (footer comes from root layout)
  259 |       await expect(page.locator("footer")).toBeAttached({ timeout: 10_000 })
  260 | 
  261 |       await collectAndAssertErrors(`Dashboard (${role})`, consoleErrors)
  262 |       await runAxe(page, `Dashboard (${role})`)
  263 |     })
```