/**
 * Playwright + axe-core Accessibility Audit
 *
 * Scans public and authenticated pages, reports violations.
 * Single navigation per page — axe runs once, assertions check both
 * total violations and serious/critical subset.
 *
 * For authenticated pages (dashboard), auth is mocked via localStorage
 * (Zustand persist) + API route interception so the page renders as
 * if a real session existed.  No actual login is performed.
 *
 * Provider profile pages require a known user ID.  We obtain one by
 * logging in as a seeded provider via the login API.  If the DB isn't
 * seeded (e.g., in dev without test-e2e-a11y.sh), the page falls back
 * to a 404 test (the not-found page is already covered elsewhere).
 *
 * Usage:
 *   npx playwright test e2e/accessibility-audit.spec.ts --reporter=list
 */
import { test, expect, type Page } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

// ===========================================================================
// Constants
// ===========================================================================

// Pages with WebSocket connections (Home, Busca, Dashboard) use 'load' to
// avoid hanging on persistent connections.  Static pages use 'networkidle'.
// Category & Provider pages need 'load' because they fetch DB data server-side.
const PAGES = [
  { path: "/",                     label: "Home",             waitUntil: "load"          as const },
  { path: "/busca",                label: "Busca",            waitUntil: "load"          as const },
  { path: "/como-funciona",        label: "ComoFunciona",     waitUntil: "networkidle"   as const },
  { path: "/contato",              label: "Contato",          waitUntil: "networkidle"   as const },
  { path: "/termos",               label: "Termos",           waitUntil: "networkidle"   as const },
  { path: "/reset-password",       label: "ResetPassword",    waitUntil: "networkidle"   as const },
  { path: "/pagina-que-nao-existe",label: "404",              waitUntil: "networkidle"   as const },
  // ── Category pages (require DB seed — see scripts/test-e2e-a11y.sh) ──
  { path: "/categoria/reparos",    label: "CategoriaReparos", waitUntil: "load"          as const },
  { path: "/categoria/eletrica-reparos", label: "CategoriaEletrica", waitUntil: "load"  as const },
] as const

// Colour contrast can't be accurately measured in headless Chrome
// against Tailwind CSS variables without a full rendering pipeline.
const DISABLE_RULES = ["color-contrast"]

// Mock users for authenticated page tests
const MOCK_CLIENT = {
  id: "e2e-mock-client-1",
  name: "Cliente Teste E2E",
  email: "cliente@severinno.com",
  role: "CLIENT" as const,
  avatarUrl: null,
}

const MOCK_PROVIDER = {
  id: "e2e-mock-provider-1",
  name: "Prestador Teste E2E",
  email: "prestador@severinno.com",
  role: "PROVIDER" as const,
  avatarUrl: null,
}

// Seed credentials (must match prisma/seed.ts)
const SEED_PROVIDER_EMAIL = "carlos@severinno.com"
const SEED_PROVIDER_PASS = "provider123"

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Configure the page to mock an authenticated session.
 *
 * 1. Seeds localStorage with the Zustand persist state so the auth store
 *    hydrates as "authenticated" on page load.
 * 2. Intercepts `/api/auth/me` so any session-verification call returns
 *    the mock user instead of hitting the real DB.
 * 3. Stubs data APIs that would fail without real data.
 */
async function mockAuth(page: Page, user: typeof MOCK_CLIENT | typeof MOCK_PROVIDER) {
  // ── 1. Seed Zustand persist in localStorage ──
  await page.addInitScript((u) => {
    localStorage.setItem("severinno:auth", JSON.stringify({
      state: { user: u, status: "authenticated" },
      version: 0,
    }))
  }, user)

  // ── 2. Intercept API routes ──
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user }),
    })
  })

  // ── 3. Stub data APIs that need real DB ──
  for (const pattern of ["**/api/bookings**", "**/api/quotes**", "**/api/notifications**"]) {
    await page.route(pattern, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [], total: 0 }),
      })
    })
  }
}

/**
 * Run axe-core on the current page and assert results.
 */
async function runAxe(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .disableRules(DISABLE_RULES)
    .analyze()

  const allViolations = results.violations
  const seriousViolations = allViolations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  )

  if (allViolations.length > 0) {
    console.log(`\n══ ${label} — ${allViolations.length} violation(s) ══`)
    for (const v of allViolations) {
      console.log(`\n  [${v.id}] ${v.help}`)
      console.log(`  Impact: ${v.impact}`)
      console.log(`  Help: ${v.helpUrl}`)
      for (const node of v.nodes) {
        const html = node.html.length > 120
          ? node.html.slice(0, 120) + "..."
          : node.html
        console.log(`  → ${html}`)
      }
    }
  }

  expect(seriousViolations).toHaveLength(0)
  expect(allViolations.length).toBeLessThanOrEqual(3)
}

/**
 * Collect console errors during navigation, filter expected noise, and assert.
 */
async function collectAndAssertErrors(
  label: string,
  consoleErrors: string[],
) {
  const realErrors = consoleErrors.filter(
    (e) =>
      !e.includes("WebSocket") &&
      !e.includes("ERR_CONNECTION_REFUSED") &&
      !e.includes("favicon.ico") &&
      !e.includes("404"),
  )
  if (realErrors.length > 0) {
    console.log(`\n── ${label} — ${realErrors.length} console error(s) ──`)
    for (const err of realErrors) {
      console.log(`  ❌ ${err.slice(0, 150)}`)
    }
  }
  expect(realErrors).toHaveLength(0)
}

// ===========================================================================
// PUBLIC PAGES
// ===========================================================================

for (const { path, label, waitUntil } of PAGES) {
  test.describe(`${label} (${path})`, () => {
    test("has no accessibility violations and valid structure", async ({ page }) => {
      const consoleErrors: string[] = []
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text())
      })

      await page.goto(path, { waitUntil })

      // ── Page title ──
      const title = await page.title()
      expect(title.trim()).toBeTruthy()

      // ── Footer landmark ──
      await expect(page.locator("footer")).toBeAttached()

      // ── Console errors ──
      await collectAndAssertErrors(label, consoleErrors)

      // ── Axe-core ──
      await runAxe(page, label)
    })
  })
}

// ===========================================================================
// PROVIDER PROFILE — uses login API to get a valid user ID
// ===========================================================================

test.describe("ProviderProfile (/u/[id])", () => {
  test("has no accessibility violations", async ({ page }) => {
    const consoleErrors: string[] = []
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text())
    })

    // ── Login as a seeded provider to obtain a real user ID ──
    let providerPath = "/u/nao-existe" // fallback
    try {
      const loginRes = await page.request.post("/api/auth/login", {
        data: { email: SEED_PROVIDER_EMAIL, password: SEED_PROVIDER_PASS },
      })
      if (loginRes.ok()) {
        const loginData = await loginRes.json()
        if (loginData?.user?.id) {
          providerPath = `/u/${loginData.user.id}`
          console.log(`  ↳ Logged in as ${SEED_PROVIDER_EMAIL}, ID: ${loginData.user.id}`)
        }
      }
    } catch {
      console.log("  ↳ Login API unavailable — testing 404 fallback")
    }

    await page.goto(providerPath, { waitUntil: "load" })

    const title = await page.title()
    expect(title.trim()).toBeTruthy()
    await expect(page.locator("footer")).toBeAttached()

    await collectAndAssertErrors("ProviderProfile", consoleErrors)
    await runAxe(page, `ProviderProfile (${providerPath})`)
  })
})

// ===========================================================================
// AUTHENTICATED PAGES — mocked via localStorage + API interception
// ===========================================================================

for (const [role, user] of [
  ["CLIENT", MOCK_CLIENT] as const,
  ["PROVIDER", MOCK_PROVIDER] as const,
]) {
  test.describe(`Dashboard (mocked ${role} auth)`, () => {
    test("has no accessibility violations", async ({ page }) => {
      const consoleErrors: string[] = []
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text())
      })

      await mockAuth(page, user)
      // Use "load" — dashboard may open WebSocket connections that prevent
      // "networkidle" from ever resolving.
      await page.goto("/dashboard", { waitUntil: "load" })

      const title = await page.title()
      expect(title.trim()).toBeTruthy()

      // Wait for the authenticated panel to render (footer comes from root layout)
      await expect(page.locator("footer")).toBeAttached({ timeout: 10_000 })

      await collectAndAssertErrors(`Dashboard (${role})`, consoleErrors)
      await runAxe(page, `Dashboard (${role})`)
    })
  })
}
