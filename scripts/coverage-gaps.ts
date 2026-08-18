#!/usr/bin/env npx tsx
/**
 * Coverage Gaps Reporter
 *
 * Cross-references all 80 route.ts files in src/app/api/ with the 27
 * existing test files in src/app/api/__tests__/ and generates a report
 * showing which routes have test coverage and which are gaps.
 *
 * Usage:
 *   npx tsx scripts/coverage-gaps.ts
 *   npx tsx scripts/coverage-gaps.ts --json       # JSON output
 *   npx tsx scripts/coverage-gaps.ts --verbose    # Show matched routes
 *   npx tsx scripts/coverage-gaps.ts --ci         # Exit 0 if no gaps, 1 if gaps
 */

import { globSync } from "glob"
import { readFileSync } from "fs"
import { join, basename, dirname } from "path"

// ── Configuration ──────────────────────────────────────────────────────────

const API_DIR = join(__dirname, "..", "src", "app", "api")
const TEST_DIR = join(API_DIR, "__tests__")

// Routes that are intentionally excluded from testing (infra, config, etc.)
const EXCLUDED_ROUTES = new Set([
  "src/app/api/route.ts", // Root redirect handler
  "src/app/api/health/route.ts", // Health check (K8s, not business)
  "src/app/api/metrics/route.ts", // Prometheus metrics
  "src/app/api/sentry/route.ts", // Sentry tunnel
  "src/app/api/cron/reminders/route.ts", // Cron job
  "src/app/api/cron/commissions-report/route.ts", // Cron job
  "src/app/api/cron/settlements/route.ts", // Cron job
])

// Tests that don't target a specific route (infrastructure tests)
const INFRA_TESTS = new Set([
  "all-cache-routes.test.ts",
  "providers-cache-header.test.ts",
  "categories-cache-header.test.ts",
])

// ── Helpers ────────────────────────────────────────────────────────────────

/** Convert a route file path like "auth/login/route.ts" to an API path like "/api/auth/login" */
function routePathToApiPath(routeFile: string): string {
  // routeFile is relative to src/app/api/
  // e.g. "auth/login/route.ts" → "/api/auth/login"
  const withoutRoute = routeFile.replace(/\/route\.ts$/, "")
  // Handle [param] segments (Next.js dynamic routes) — keep as-is
  return "/api/" + withoutRoute
}

/** Convert a test file name to the route segments it likely covers */
function _testNameToRouteSegments(testFile: string): string[] {
  // Pattern: "auth-route.test.ts" → ["auth"]
  // Pattern: "bookings-pay-route.test.ts" → ["bookings", "pay"]
  // Pattern: "wallet-history-route.test.ts" → ["provider", "wallet", "history"]
  // Pattern: "geo-cep-route.test.ts" → ["geo", "cep"]
  // Pattern: "change-password.test.ts" → ["auth", "change-password"]
  const name = basename(testFile)
    .replace(/\.test\.ts$/, "")
    .replace(/-route$/, "")

  // Special mappings for test files that don't follow dir naming.
  // IMPORTANT: Do NOT include [param] segments here — routeMatchesTest
  // handles dynamic params by skipping them in the route path.
  const SPECIAL: Record<string, string[]> = {
    "bookings-pay": ["bookings", "pay"],
    bookings: ["bookings"],
    "wallet-history-export": ["provider", "wallet", "history", "export"],
    "wallet-history": ["provider", "wallet", "history"],
    "wallet-withdraw": ["provider", "wallet", "withdraw"],
    wallet: ["provider", "wallet"],
    "change-password": ["auth", "change-password"],
    "forgot-reset-password": ["auth", "forgot-password", "reset-password"],
    "admin-commissions-export": ["admin", "commissions", "export"],
    "admin-commissions": ["admin", "commissions"],
    "geo-cep": ["geo", "cep"],
    "geo-reverse": ["geo", "reverse"],
    providers: ["providers"],
    favorites: ["providers", "favorite"],
    notifications: ["notifications"],
    reviews: ["reviews"],
    messages: ["messages"],
    quotes: ["quotes"],
    tracking: ["tracking"],
    services: ["services"],
    categories: ["categories"],
    auth: ["auth"],
    availability: ["availability"],
    "webhooks-lytex": ["webhooks", "lytex"],
  }

  if (SPECIAL[name]) return SPECIAL[name]
  // Fallback: split by "-"
  return name.split("-")
}

/** Check if a route's directory segments match the test's target segments */
function _routeMatchesTest(routeSegments: string[], testSegments: string[]): boolean {
  // Test covers routes that START with the test segments
  // e.g. test "bookings" covers "bookings", "bookings/[id]", "bookings/[id]/pay"
  // e.g. test "auth" covers "auth/login", "auth/register", etc.
  // e.g. test "bookings/pay" covers "bookings/[id]/pay" (skipping [id] param)

  let routeIdx = 0
  let testIdx = 0

  while (routeIdx < routeSegments.length && testIdx < testSegments.length) {
    if (testSegments[testIdx] === "*") {
      // Wildcard matches any single segment
      routeIdx++
      testIdx++
      continue
    }

    // Skip [param] segments in route path when matching
    if (routeSegments[routeIdx].startsWith("[") && routeSegments[routeIdx].endsWith("]")) {
      routeIdx++
      continue
    }

    if (routeSegments[routeIdx] !== testSegments[testIdx]) {
      // If test has more specific segments that don't match, try skipping route's optional [param]
      // e.g. test "bookings/pay" vs route "bookings/[id]/pay"
      if (
        routeIdx + 1 < routeSegments.length &&
        routeSegments[routeIdx + 1] === testSegments[testIdx]
      ) {
        routeIdx++
        continue
      }
      return false
    }

    routeIdx++
    testIdx++
  }

  // Test segments exhausted = match (route may have deeper paths)
  return testIdx >= testSegments.length
}

/** Get the content of a test file to extract which handlers it imports */
function getImportedHandlersFromTest(testFile: string): string[] {
  try {
    const content = readFileSync(testFile, "utf-8")
    const imports: string[] = []
    // Match "import { GET, POST, ... } from \"../path/route\""
    const importRegex = /import\s*\{[^}]+\}\s*from\s*["']\.\.\/([^"']+\/route)["']/g
    let match
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1])
    }
    return imports
  } catch {
    return []
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const outputJson = args.includes("--json")
  const verbose = args.includes("--verbose")
  const ciMode = args.includes("--ci")

  // Discover all route files
  const routeFiles = globSync("**/route.ts", { cwd: API_DIR }).filter(
    (f) => !f.includes("__tests__"),
  )
  const totalRoutes = routeFiles.length

  // Discover all test files
  const testFiles = globSync("*.test.ts", { cwd: TEST_DIR })

  // Build test coverage map
  type CoverageEntry = {
    routeFile: string
    apiPath: string
    coveredBy: string[] // test file names
    excluded: boolean
    infraOnly: boolean
  }

  const coverage: CoverageEntry[] = []

  for (const routeFile of routeFiles) {
    const _fullRoutePath = join(API_DIR, routeFile)
    const apiPath = routePathToApiPath(routeFile)
    const _routeSegments = routeFile
      .replace(/\/route\.ts$/, "")
      .replace(/\\/g, "/")
      .split("/")
    // globSync returns OS-native separators on Windows (\) — normalize so the
    // EXCLUDED_ROUTES set (always "/") matches on every platform.
    const excluded = EXCLUDED_ROUTES.has(`src/app/api/${routeFile.replace(/\\/g, "/")}`)

    const coveredBy: string[] = []
    let infraOnly = false

    for (const testFile of testFiles) {
      // Direct import check (most reliable)
      const importedHandlers = getImportedHandlersFromTest(join(TEST_DIR, testFile))
      const _expectedImportPath = `../${routeFile.replace(/\\/g, "/").replace(/\.ts$/, "")}`
      const normalizedRoute = routeFile.replace(/\\/g, "/")

      // Check if the test file imports this route's handler
      const directlyImported = importedHandlers.some((h) => {
        return h === normalizedRoute.replace(/\.ts$/, "")
      })

      if (directlyImported) {
        coveredBy.push(testFile)
        continue
      }
    }

    // Mark as infraOnly if the only matching tests are infra-only (cache header) tests
    const coveringInfra = coveredBy.filter((t) => INFRA_TESTS.has(t))
    const coveringReal = coveredBy.filter((t) => !INFRA_TESTS.has(t))
    if (coveringReal.length === 0 && coveringInfra.length > 0) {
      infraOnly = true
    }

    coverage.push({ routeFile, apiPath, coveredBy, excluded, infraOnly })
  }

  // ── Report ──────────────────────────────────────────────────────────────

  const covered = coverage.filter((c) => c.coveredBy.length > 0 && !c.infraOnly && !c.excluded)
  const coveredInfra = coverage.filter((c) => c.infraOnly && !c.excluded)
  const gaps = coverage.filter((c) => c.coveredBy.length === 0 && !c.excluded && !c.infraOnly)
  const excluded = coverage.filter((c) => c.excluded)

  if (outputJson) {
    console.log(
      JSON.stringify(
        {
          totalRoutes,
          totalTests: testFiles.length,
          covered: covered.length,
          coveredInfra: coveredInfra.length,
          gaps: gaps.length,
          excluded: excluded.length,
          coveragePct: Math.round((covered.length / (totalRoutes - excluded.length)) * 100),
          gapRoutes: gaps.map((g) => ({
            path: g.apiPath,
            file: g.routeFile,
          })),
          coveredRoutes: covered.map((c) => ({
            path: c.apiPath,
            tests: c.coveredBy,
          })),
        },
        null,
        2,
      ),
    )
    return
  }

  // ── Console Report ──────────────────────────────────────────────────────

  const divider = "─".repeat(72)

  console.log(`\n  📊 Coverage Gaps Report`)
  console.log(`  ${divider}`)
  console.log(`  Total API routes:   ${String(totalRoutes).padStart(3)}`)
  console.log(`  Test files:          ${String(testFiles.length).padStart(3)}`)
  console.log(`  Excluded (infra):    ${String(excluded.length).padStart(3)}`)
  console.log(`  Covered (real):      ${String(covered.length).padStart(3)}`)
  console.log(`  Covered (infra only):${String(coveredInfra.length).padStart(3)}`)
  console.log(`  Gaps:                ${String(gaps.length).padStart(3)}`)
  console.log(
    `  Coverage:            ${Math.round((covered.length / (totalRoutes - excluded.length)) * 100)}%`,
  )
  console.log()

  if (gaps.length > 0) {
    console.log(`  🔴 ROUTES WITHOUT TESTS (${gaps.length})\n`)

    // Group gaps by directory
    const byDir = new Map<string, CoverageEntry[]>()
    for (const g of gaps) {
      const dir = dirname(g.routeFile)
      if (!byDir.has(dir)) byDir.set(dir, [])
      byDir.get(dir)!.push(g)
    }

    for (const [dir, entries] of [...byDir.entries()].sort()) {
      console.log(`    ${dir}/`)
      for (const e of entries) {
        console.log(`      • ${basename(e.routeFile)}  →  ${e.apiPath}`)
      }
      console.log()
    }
  }

  if (coveredInfra.length > 0) {
    console.log(`  🟡 ROUTES WITH INFRA-ONLY COVERAGE (cache headers only)\n`)
    for (const c of coveredInfra) {
      console.log(`      • ${c.apiPath}`)
    }
    console.log()
  }

  if (verbose && covered.length > 0) {
    console.log(`  🟢 COVERED ROUTES\n`)
    for (const c of [...covered].sort((a, b) => a.apiPath.localeCompare(b.apiPath))) {
      const testNames = [...new Set(c.coveredBy)].join(", ")
      console.log(`      ✅ ${c.apiPath}`)
      console.log(`         tests: ${testNames}`)
    }
    console.log()
  }

  // Summary stats
  const byDir = new Map<string, { total: number; covered: number }>()
  for (const c of coverage) {
    const dir = dirname(c.routeFile)
    if (!byDir.has(dir)) byDir.set(dir, { total: 0, covered: 0 })
    byDir.get(dir)!.total++
    if (c.coveredBy.length > 0 && !c.infraOnly && !c.excluded) {
      byDir.get(dir)!.covered++
    }
  }

  console.log(`  ${divider}`)
  console.log(`  Coverage by directory:`)
  console.log()
  for (const [dir, stats] of [...byDir.entries()].sort()) {
    const pct = stats.total > 0 ? Math.round((stats.covered / stats.total) * 100) : 0
    const bar = "▓".repeat(Math.floor(pct / 10)) + "░".repeat(10 - Math.floor(pct / 10))
    console.log(
      `    ${bar} ${String(pct).padStart(3)}%  ${dir}/  (${stats.covered}/${stats.total})`,
    )
  }
  console.log()

  // Quick-win recommendations
  if (gaps.length > 0) {
    console.log(`  💡 Quick wins (routes with highest risk):\n`)
    const priorityGaps = gaps.filter((g) => {
      const p = g.apiPath.toLowerCase()
      return (
        p.includes("pay") ||
        p.includes("wallet") ||
        p.includes("finance") ||
        p.includes("withdraw") ||
        p.includes("refund") ||
        p.includes("settlement")
      )
    })
    for (const g of priorityGaps) {
      console.log(`      🔴 HIGH PRIORITY: ${g.apiPath}`)
    }
    if (priorityGaps.length === 0) {
      console.log(`      (No high-priority finance routes in gaps)`)
    }
    console.log()
  }

  if (ciMode && gaps.length > 0) {
    console.log(`  ❌ CI check failed: ${gaps.length} route(s) without tests.\n`)
    process.exit(1)
  }

  console.log(`  ${divider}\n`)
}

main().catch((e) => {
  console.error("Fatal error:", e)
  process.exit(1)
})
