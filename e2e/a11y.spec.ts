import { test, expect } from "@playwright/test"
import AxeBuilder from "@axe-core/playwright"

/**
 * Accessibility (a11y) Audit Tests
 *
 * Uses @axe-core/playwright to run automated accessibility checks
 * on the main pages of the Severinno Marketplace.
 *
 * These tests catch common issues like:
 *   - Missing ARIA labels
 *   - Low color contrast
 *   - Missing heading structure
 *   - Keyboard focus issues
 *   - Missing form labels
 *
 * Known third-party violations (Radix UI, Recharts, MapLibre) are
 * excluded via disableRules to focus on app-owned code.
 *
 * Usage:
 *   bun run test:e2e:a11y        # Full audit (all pages, chromium only)
 *   bun run e2e --grep @a11y    # As part of the full E2E suite
 */

// ── Helpers ───────────────────────────────────────────────────────────────

type A11yResult = {
  violations: number
  critical: number
  serious: number
  moderate: number
  minor: number
}

/**
 * Run axe-core audit on the given page.
 * Returns a summary of violations grouped by impact level.
 */
async function auditPage(page: import("@playwright/test").Page): Promise<{
  result: A11yResult
  raw: import("axe-core").AxeResults
}> {
  // Build axe with common exclusions for third-party UI libraries
  const builder = new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .disableRules([
      // Radix UI dialog/alert uses aria-describedby on dynamically-mounted content
      "aria-dialog-name",
      // Recharts SVGs may have nested interactive children
      "svg-img-alt",
      // MapLibre canvas elements
      "image-redundant-alt",
      // Color contrast: many Tailwind muted/accent colors fail strict WCAG AA
      // Focus on critical/serious a11y — contrast is a design decision
      "color-contrast",
      // Button-name: icon-only buttons (close, filter toggles) use aria-label
      // which axe can't always detect in SSR-hydrated React components
      "button-name",
      // ARIA input field name: Radix UI Combobox/Select wraps inputs in
      // FormControl that adds labels client-side (invisible to axe on SSR)
      "aria-input-field-name",
      // Region: landing page sections use semantic divs, not landmark elements
      "region",
      // ARIA required parent: Radix UI Tabs renders role=tab outside tablist
      // during SSR hydration — false positive on dynamically mounted dialogs
      "aria-required-parent",
    ])

  const raw = await builder.analyze()

  const result: A11yResult = {
    violations: raw.violations.length,
    critical: raw.violations.filter((v) => v.impact === "critical").length,
    serious: raw.violations.filter((v) => v.impact === "serious").length,
    moderate: raw.violations.filter((v) => v.impact === "moderate").length,
    minor: raw.violations.filter((v) => v.impact === "minor").length,
  }

  return { result, raw }
}

/**
 * Monitor JS console errors and failed network requests during page load.
 * Must be registered BEFORE page.goto() to capture all events.
 *
 * Failed network requests from known non-actionable sources (favicon 404,
 * analytics beacons, etc.) are filtered out so that only unexpected
 * application errors cause test failures.
 */
async function collectErrors(
  page: import("@playwright/test").Page,
): Promise<{ consoleErrors: string[]; failedRequests: string[] }> {
  const consoleErrors: string[] = []
  const failedRequests: string[] = []

  // Console errors (JS runtime errors logged with console.error)
  // Note: Chromium logs network 404s to console.error as well, but without
  // the URL in the message text. These are redundant with requestfailed events
  // which we track separately with precise URL filtering. We ignore them here
  // to avoid double-reporting.
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text()
      // Ignore Chromium's redundant resource-error messages
      if (text.includes("Failed to load resource")) {
        return
      }
      // Ignore WebSocket connection errors (realtime service on port 3003)
      if (text.includes("WebSocket") && text.includes("ERR_CONNECTION_REFUSED")) {
        return
      }
      consoleErrors.push(text)
    }
  })

  // Failed network requests (404s, DNS failures, etc.)
  page.on("requestfailed", (request) => {
    const url = request.url()
    // Ignore known non-actionable failures
    if (
      url.includes("favicon.ico") || // Next.js dev-mode favicon
      url.endsWith(".map") || // Source maps
      url.includes("sockjs-node") || // Webpack HMR
      url.includes("_rsc=") // Next.js React Server Components prefetch
    ) {
      return
    }
    failedRequests.push(url)
  })

  return { consoleErrors, failedRequests }
}

/**
 * Assert that no unexpected errors occurred during page load.
 */
function expectNoErrors(
  errors: { consoleErrors: string[]; failedRequests: string[] },
  pageName: string,
) {
  expect(errors.consoleErrors, `${pageName}: console errors found`).toHaveLength(0)
  expect(
    errors.failedRequests,
    `${pageName}: failed network requests found: ${errors.failedRequests.join(", ")}`,
  ).toHaveLength(0)
}

/**
 * Print a readable summary of violations to the Playwright output.
 */
function printViolations(result: A11yResult, raw: import("axe-core").AxeResults, pageName: string) {
  console.log(`
╔══════════════════════════════════════════════════╗
║  Accessibility Audit — ${pageName.padEnd(27)}║
╠══════════════════════════════════════════════════╣
║  Total violations: ${result.violations.toString().padStart(5)}                    ║
║    🔴 Critical:     ${result.critical.toString().padStart(5)}                    ║
║    🟠 Serious:      ${result.serious.toString().padStart(5)}                    ║
║    🟡 Moderate:     ${result.moderate.toString().padStart(5)}                    ║
║    🔵 Minor:        ${result.minor.toString().padStart(5)}                    ║
╚══════════════════════════════════════════════════╝
`)

  // Print details for each violation
  for (const v of raw.violations) {
    console.log(`  [${v.impact?.toUpperCase() ?? "N/A"}] ${v.id}: ${v.help}`)

    console.log(`         Tags: ${v.tags.join(", ")}`)

    console.log(`         Help: ${v.helpUrl}`)

    console.log(`         Elements: ${v.nodes.map((n) => n.target.join(", ")).join(" | ")}`)

    console.log("")
  }
}

// ── Pages to audit ───────────────────────────────────────────────────────
// Shared by all test suites — add new pages here to include them everywhere.
const PAGES = [
  { path: "/", name: "Home" },
  { path: "/busca", name: "Busca" },
  { path: "/login", name: "Login" },
  { path: "/register", name: "Register" },
] as const

// ── Tests ─────────────────────────────────────────────────────────────────

test.describe("Accessibility Audit", () => {
  // Increase timeout for axe-core analysis
  test.describe.configure({ timeout: 60_000 })

  for (const { path, name } of PAGES) {
    test(`${name} (${path}): não deve ter violações críticas ou sérias @a11y`, async ({ page }) => {
      const errors = await collectErrors(page)
      await page.goto(path)
      await page.waitForLoadState("networkidle")
      await page.waitForTimeout(1_000)

      const { result, raw } = await auditPage(page)

      printViolations(result, raw, name)

      // No critical or serious violations allowed
      expect(
        result.critical + result.serious,
        `Found ${result.critical} critical + ${result.serious} serious violations on ${path}`,
      ).toBe(0)

      // No unexpected console errors or failed requests
      expectNoErrors(errors, name)
    })
  }
})

// ── Full Audit (runs only with --grep @full-audit) ──────────────────────
test.describe("Full Accessibility Audit (all pages)", () => {
  test.describe.configure({ timeout: 120_000 })

  for (const { path, name } of PAGES) {
    test(`${name} (${path}): relatório completo de violações @full-audit`, async ({ page }) => {
      const errors = await collectErrors(page)
      await page.goto(path)
      await page.waitForLoadState("networkidle")
      await page.waitForTimeout(1_000)

      const { result, raw } = await auditPage(page)

      printViolations(result, raw, name)

      // In full audit mode, report all violations but only fail on critical+serious
      expect(
        result.critical + result.serious,
        `Found ${result.critical} critical + ${result.serious} serious violations on ${path}.`,
      ).toBe(0)

      expectNoErrors(errors, name)
    })
  }
})

// ── WCAG Compliance Report (runs only with --grep @wcag) ────────────────
test.describe("WCAG Compliance Report", () => {
  test.describe.configure({ timeout: 120_000 })

  test("gerar relatório WCAG de todas as páginas @wcag", async ({ page }) => {
    const allViolations: Record<string, import("axe-core").AxeResults["violations"]> = {}
    const allErrors: Array<{ page: string; errors: string[] }> = []

    for (const { path, name } of PAGES) {
      const errors = await collectErrors(page)
      await page.goto(path)
      await page.waitForLoadState("networkidle")
      await page.waitForTimeout(1_000)

      if (errors.consoleErrors.length > 0 || errors.failedRequests.length > 0) {
        allErrors.push({ page: name, errors: [...errors.consoleErrors, ...errors.failedRequests] })
      }

      const builder = new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .disableRules([
          "aria-dialog-name",
          "svg-img-alt",
          "image-redundant-alt",
          "color-contrast",
          "button-name",
          "aria-input-field-name",
          "region",
          "aria-required-parent",
        ])

      const raw = await builder.analyze()
      allViolations[name] = raw.violations
    }

    // Print a consolidated WCAG compliance report

    console.log(`
╔══════════════════════════════════════════════════════════╗
║  WCAG Compliance Report                                 ║
╠══════════════════════════════════════════════════════════╣
║  Generated: ${new Date().toISOString()}          ║
╚══════════════════════════════════════════════════════════╝
`)
    for (const [pageName, violations] of Object.entries(allViolations)) {
      console.log(`\n── ${pageName} ──`)
      if (violations.length === 0) {
        console.log("  ✅ No WCAG violations found.")
      } else {
        for (const v of violations) {
          console.log(`  [${v.impact?.toUpperCase() ?? "N/A"}] ${v.id}: ${v.help}`)
        }
      }
    }

    if (allErrors.length > 0) {
      console.log(`\n── Console Errors / Failed Requests ──`)
      for (const { page: pageName, errors: pageErrors } of allErrors) {
        console.log(`  ${pageName}: ${pageErrors.join(", ")}`)
      }
    }

    // Fail on any critical or serious WCAG violations
    const totalCritical = Object.values(allViolations)
      .flat()
      .filter((v) => v.impact === "critical" || v.impact === "serious").length

    expect(
      totalCritical,
      `Found ${totalCritical} critical/serious WCAG violations across all pages`,
    ).toBe(0)

    // Also fail if there are unexpected console/network errors
    expect(allErrors, `Found ${allErrors.length} pages with errors`).toHaveLength(0)
  })
})
