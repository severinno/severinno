# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: address-autocomplete-visual.spec.ts >> AddressAutocomplete — Visual Regression >> reverse geocode error @visual
- Location: e2e\address-autocomplete-visual.spec.ts:256:7

# Error details

```
TypeError: page.setGeolocation is not a function
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - heading "AddressAutocomplete — Visual Test" [level=1] [ref=e4]
    - generic [ref=e5]:
      - img
      - combobox "Localização" [ref=e6]
      - button "Usar localização atual" [ref=e8]:
        - img [ref=e10]
  - region "Notifications alt+T"
  - button "Open Next.js Dev Tools" [ref=e18] [cursor=pointer]:
    - img [ref=e19]
  - alert [ref=e22]
```

# Test source

```ts
  163 | 
  164 |     // Seed the Zustand persist store with a city before the page hydrates
  165 |     await page.addInitScript(() => {
  166 |       localStorage.setItem(
  167 |         "severinno:geo",
  168 |         JSON.stringify({
  169 |           state: {
  170 |             lat: -23.5505,
  171 |             lng: -46.6333,
  172 |             address: null,
  173 |             cep: null,
  174 |             district: null,
  175 |             city: "São Paulo",
  176 |             state: "SP",
  177 |             status: "ready",
  178 |             updatedAt: new Date().toISOString(),
  179 |           },
  180 |           version: 0,
  181 |         }),
  182 |       )
  183 |     })
  184 | 
  185 |     await page.goto(TEST_PAGE, { waitUntil: "domcontentloaded" })
  186 | 
  187 |     await expect(page.getByRole("combobox")).toBeAttached()
  188 |     await expect(page.getByRole("combobox")).toHaveAttribute("placeholder", "São Paulo")
  189 | 
  190 |     await screenshot(page, "geo-placeholder")
  191 |     await context.close()
  192 |   })
  193 | 
  194 |   // -----------------------------------------------------------------------
  195 |   // 3. Results dropdown
  196 |   // -----------------------------------------------------------------------
  197 |   test("results dropdown @visual", async ({ page }) => {
  198 |     await mockGeoSearchOk(page)
  199 |     await page.goto(TEST_PAGE, { waitUntil: "domcontentloaded" })
  200 | 
  201 |     await typeAndWait(page, "Av. Paulista")
  202 | 
  203 |     await expect(page.getByRole("listbox")).toBeAttached()
  204 |     await expect(page.getByRole("option")).toHaveCount(2)
  205 | 
  206 |     await screenshot(page, "results-dropdown")
  207 |   })
  208 | 
  209 |   // -----------------------------------------------------------------------
  210 |   // 4. Dropdown hover (first item highlighted)
  211 |   // -----------------------------------------------------------------------
  212 |   test("dropdown hover @visual", async ({ page }) => {
  213 |     await mockGeoSearchOk(page)
  214 |     await page.goto(TEST_PAGE, { waitUntil: "domcontentloaded" })
  215 | 
  216 |     await typeAndWait(page, "Av. Paulista")
  217 | 
  218 |     const options = page.getByRole("option")
  219 |     await expect(options).toHaveCount(2)
  220 | 
  221 |     // Hover the first option
  222 |     await options.first().hover()
  223 |     await expect(options.first()).toHaveAttribute("aria-selected", "true")
  224 |     await expect(options.nth(1)).toHaveAttribute("aria-selected", "false")
  225 | 
  226 |     await screenshot(page, "dropdown-hover")
  227 |   })
  228 | 
  229 |   // -----------------------------------------------------------------------
  230 |   // 5. GPS spinner
  231 |   // -----------------------------------------------------------------------
  232 |   test("GPS spinner @visual", async ({ page }) => {
  233 |     await page.goto(TEST_PAGE, { waitUntil: "domcontentloaded" })
  234 | 
  235 |     // Override geolocation to NEVER resolve — the component's setFromGPS
  236 |     // calls navigator.geolocation.getCurrentPosition.  If it never calls
  237 |     // the callback, the component stays in "locating" state with spinner.
  238 |     await page.evaluate(() => {
  239 |       navigator.geolocation.getCurrentPosition = () => {
  240 |         // Never resolve or reject — keep spinner visible
  241 |       }
  242 |     })
  243 | 
  244 |     const gpsBtn = page.getByLabel("Usar localização atual")
  245 |     await gpsBtn.click()
  246 | 
  247 |     // The spinner should appear immediately
  248 |     await expect(page.getByTestId("icon-loading")).toBeAttached()
  249 | 
  250 |     await screenshot(page, "gps-spinner")
  251 |   })
  252 | 
  253 |   // -----------------------------------------------------------------------
  254 |   // 6. Reverse geocode error (GPS succeeds, reverse fails)
  255 |   // -----------------------------------------------------------------------
  256 |   test("reverse geocode error @visual", async ({ page }) => {
  257 |     await mockReverseGeoError(page)
  258 |     await page.goto(TEST_PAGE, { waitUntil: "domcontentloaded" })
  259 | 
  260 |     // Grant geolocation permission and set a fixed position
  261 |     const context = page.context()
  262 |     await context.grantPermissions(["geolocation"])
> 263 |     await page.setGeolocation({ latitude: -23.5505, longitude: -46.6333 })
      |                ^ TypeError: page.setGeolocation is not a function
  264 | 
  265 |     const gpsBtn = page.getByLabel("Usar localização atual")
  266 |     await gpsBtn.click()
  267 | 
  268 |     // Wait for async GPS + reverse geocode to complete
  269 |     await page.waitForTimeout(1000)
  270 | 
  271 |     const input = page.getByRole("combobox")
  272 |     // Input should show raw coordinates as fallback
  273 |     await expect(input).toHaveValue("-23.5505, -46.6333")
  274 | 
  275 |     await screenshot(page, "reverse-geocode-error")
  276 |   })
  277 | 
  278 |   // -----------------------------------------------------------------------
  279 |   // 7. Fetch error
  280 |   // -----------------------------------------------------------------------
  281 |   test("fetch error @visual", async ({ page }) => {
  282 |     await mockGeoSearchError(page)
  283 |     await page.goto(TEST_PAGE, { waitUntil: "domcontentloaded" })
  284 | 
  285 |     await typeAndWait(page, "Av. Paulista")
  286 | 
  287 |     const input = page.getByRole("combobox")
  288 |     await expect(input).toHaveValue("Av. Paulista")
  289 |     await expect(page.getByRole("listbox")).not.toBeAttached()
  290 | 
  291 |     await screenshot(page, "fetch-error")
  292 |   })
  293 | 
  294 |   // -----------------------------------------------------------------------
  295 |   // 8. Input filled after selection
  296 |   // -----------------------------------------------------------------------
  297 |   test("input filled @visual", async ({ page }) => {
  298 |     await mockGeoSearchOk(page)
  299 |     await page.goto(TEST_PAGE, { waitUntil: "domcontentloaded" })
  300 | 
  301 |     await typeAndWait(page, "Av. Paulista")
  302 | 
  303 |     // Click the first result
  304 |     const firstOption = page.getByRole("option").first()
  305 |     await firstOption.click()
  306 | 
  307 |     const input = page.getByRole("combobox")
  308 |     await expect(input).toHaveValue(
  309 |       "Avenida Paulista, Bela Vista, São Paulo - SP, Brasil",
  310 |     )
  311 |     await expect(page.getByRole("listbox")).not.toBeAttached()
  312 | 
  313 |     await screenshot(page, "input-filled")
  314 |   })
  315 | })
  316 | 
```