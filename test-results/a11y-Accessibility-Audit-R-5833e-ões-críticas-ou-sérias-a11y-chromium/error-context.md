# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: a11y.spec.ts >> Accessibility Audit >> Register (/register): não deve ter violações críticas ou sérias @a11y
- Location: e2e\a11y.spec.ts:180:9

# Error details

```
Error: Found 0 critical + 1 serious violations on /register

expect(received).toBe(expected) // Object.is equality

Expected: 0
Received: 1
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e4]:
      - img [ref=e9]
      - generic [ref=e13]: "404"
      - heading "Página não encontrada" [level=1] [ref=e14]
      - paragraph [ref=e15]: O conteúdo que você procura não existe ou foi removido. Verifique o link ou busque por profissionais na página inicial.
      - generic [ref=e16]:
        - link "Voltar ao início" [ref=e17] [cursor=pointer]:
          - /url: /
          - img [ref=e18]
          - text: Voltar ao início
        - link "Buscar profissionais" [ref=e21] [cursor=pointer]:
          - /url: /busca
          - img [ref=e22]
          - text: Buscar profissionais
    - contentinfo [ref=e25]:
      - paragraph [ref=e26]: © 2026 Severinno. Todos os direitos reservados.
  - region "Notifications alt+T"
  - generic [active]:
    - generic [ref=e29]:
      - generic [ref=e30]:
        - generic [ref=e31]:
          - navigation [ref=e32]:
            - button "previous" [disabled] [ref=e33]:
              - img "previous" [ref=e34]
            - generic [ref=e36]:
              - generic [ref=e37]: 1/
              - text: "1"
            - button "next" [disabled] [ref=e38]:
              - img "next" [ref=e39]
          - img
        - generic [ref=e41]:
          - link "Next.js 16.1.3 (stale) Turbopack" [ref=e42] [cursor=pointer]:
            - /url: https://nextjs.org/docs/messages/version-staleness
            - img [ref=e43]
            - generic "There is a newer version (16.2.11) available, upgrade recommended!" [ref=e45]: Next.js 16.1.3 (stale)
            - generic [ref=e46]: Turbopack
          - img
      - dialog "Build Error" [ref=e48]:
        - generic [ref=e51]:
          - generic [ref=e52]:
            - generic [ref=e53]:
              - generic [ref=e55]: Build Error
              - generic [ref=e56]:
                - button "Copy Error Info" [ref=e57] [cursor=pointer]:
                  - img [ref=e58]
                - button "No related documentation found" [disabled] [ref=e60]:
                  - img [ref=e61]
                - button "Attach Node.js inspector" [ref=e63] [cursor=pointer]:
                  - img [ref=e64]
            - generic [ref=e73]: Reading source code for parsing failed
          - generic [ref=e75]:
            - generic [ref=e77]:
              - img [ref=e79]
              - generic [ref=e83]: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts
              - button "Open in editor" [ref=e84] [cursor=pointer]:
                - img [ref=e86]
            - generic [ref=e90]: "Reading source code for parsing failed An unexpected error happened while trying to read the source code to parse: failed to convert rope into string Caused by: - invalid utf-8 sequence of 1 bytes from index 5415 Import trace: App Route: ./.freebuff/worktrees/thmrzp9vv9y86o/src/lib/api-server.ts ./.freebuff/worktrees/thmrzp9vv9y86o/src/app/api/auth/me/route.ts"
        - generic [ref=e91]: "1"
        - generic [ref=e92]: "2"
    - generic [ref=e97] [cursor=pointer]:
      - button "Open Next.js Dev Tools" [ref=e98]:
        - img [ref=e99]
      - button "Open issues overlay" [ref=e103]:
        - generic [ref=e104]:
          - generic [ref=e105]: "0"
          - generic [ref=e106]: "1"
        - generic [ref=e107]: Issue
  - alert [ref=e108]
```

# Test source

```ts
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
  125 |   ).toHaveLength(0)
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
> 194 |       ).toBe(0)
      |         ^ Error: Found 0 critical + 1 serious violations on /register
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
  226 | })
  227 | 
  228 | // ── WCAG Compliance Report (runs only with --grep @wcag) ────────────────
  229 | test.describe("WCAG Compliance Report", () => {
  230 |   test.describe.configure({ timeout: 120_000 })
  231 | 
  232 |   test("gerar relatório WCAG de todas as páginas @wcag", async ({ page }) => {
  233 |     const allViolations: Record<string, import("axe-core").AxeResults["violations"]> = {}
  234 |     const allErrors: Array<{ page: string; errors: string[] }> = []
  235 | 
  236 |     for (const { path, name } of PAGES) {
  237 |       const errors = await collectErrors(page)
  238 |       await page.goto(path)
  239 |       await page.waitForLoadState("networkidle")
  240 |       await page.waitForTimeout(1_000)
  241 | 
  242 |       if (errors.consoleErrors.length > 0 || errors.failedRequests.length > 0) {
  243 |         allErrors.push({ page: name, errors: [...errors.consoleErrors, ...errors.failedRequests] })
  244 |       }
  245 | 
  246 |       const builder = new AxeBuilder({ page })
  247 |         .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
  248 |         .disableRules(["aria-dialog-name", "svg-img-alt", "image-redundant-alt"])
  249 | 
  250 |       const raw = await builder.analyze()
  251 |       allViolations[name] = raw.violations
  252 |     }
  253 | 
  254 |     // Print a consolidated WCAG compliance report
  255 |      
  256 |     console.log(`
  257 | ╔══════════════════════════════════════════════════════════╗
  258 | ║  WCAG Compliance Report                                 ║
  259 | ╠══════════════════════════════════════════════════════════╣
  260 | ║  Generated: ${new Date().toISOString()}          ║
  261 | ╚══════════════════════════════════════════════════════════╝
  262 | `)
  263 |     for (const [pageName, violations] of Object.entries(allViolations)) {
  264 |        
  265 |       console.log(`\n── ${pageName} ──`)
  266 |       if (violations.length === 0) {
  267 |          
  268 |         console.log("  ✅ No WCAG violations found.")
  269 |       } else {
  270 |         for (const v of violations) {
  271 |            
  272 |           console.log(`  [${v.impact?.toUpperCase() ?? "N/A"}] ${v.id}: ${v.help}`)
  273 |         }
  274 |       }
  275 |     }
  276 | 
  277 |     if (allErrors.length > 0) {
  278 |        
  279 |       console.log(`\n── Console Errors / Failed Requests ──`)
  280 |       for (const { page: pageName, errors: pageErrors } of allErrors) {
  281 |          
  282 |         console.log(`  ${pageName}: ${pageErrors.join(", ")}`)
  283 |       }
  284 |     }
  285 | 
  286 |     // Fail on any critical or serious WCAG violations
  287 |     const totalCritical = Object.values(allViolations)
  288 |       .flat()
  289 |       .filter((v) => v.impact === "critical" || v.impact === "serious").length
  290 | 
  291 |     expect(totalCritical, `Found ${totalCritical} critical/serious WCAG violations across all pages`).toBe(0)
  292 | 
  293 |     // Also fail if there are unexpected console/network errors
  294 |     expect(
```