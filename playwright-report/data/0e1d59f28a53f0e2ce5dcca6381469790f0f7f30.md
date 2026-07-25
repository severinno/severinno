# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accessibility-audit.spec.ts >> ResetPassword (/reset-password) >> has no accessibility violations and valid structure
- Location: e2e\accessibility-audit.spec.ts:172:9

# Error details

```
Error: expect(locator).toBeAttached() failed

Locator: locator('footer')
Expected: attached
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeAttached" with timeout 5000ms
  - waiting for locator('footer')

```

```yaml
- paragraph: Link inválido. Solicite uma nova redefinição de senha.
- region "Notifications alt+T"
- alert
```

# Test source

```ts
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
  163 |   expect(realErrors).toHaveLength(0)
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
> 185 |       await expect(page.locator("footer")).toBeAttached()
      |                                            ^ Error: expect(locator).toBeAttached() failed
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
  264 |   })
  265 | }
  266 | 
```