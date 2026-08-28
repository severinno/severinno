#!/usr/bin/env node

/**
 * audit-routes.mjs
 *
 * Scans all API route files and reports which ones are missing:
 *   - Authentication (requireUser / requireRole)
 *   - Rate limiting (assertRateLimit / checkRateLimit)
 *
 * Usage:
 *   node scripts/audit-routes.mjs [--json] [--fix-suggestions]
 *
 * Exit code 0 if all routes pass, 1 if any issues found.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)
const JSON_OUTPUT = args.includes("--json")
const FIX_SUGGESTIONS = args.includes("--fix-suggestions")

const SRC_DIR = join(__dirname, "..", "src", "app", "api")

// ── Route scanner ───────────────────────────────────────────────────────────

function findRouteFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      files.push(...findRouteFiles(fullPath))
    } else if (entry === "route.ts" || entry === "route.tsx") {
      files.push(fullPath)
    }
  }
  return files
}

function analyzeRoute(filePath) {
  const content = readFileSync(filePath, "utf-8")
  const relativePath = relative(join(__dirname, "..", "src"), filePath)

  const hasRequireUser = /requireUser\s*\(/.test(content)
  const hasRequireRole = /requireRole\s*\(/.test(content)
  const hasAuth = hasRequireUser || hasRequireRole

  const hasAssertRateLimit = /assertRateLimit\s*\(/.test(content)
  const hasCheckRateLimit = /checkRateLimit\s*\(/.test(content)
  const hasRateLimit = hasAssertRateLimit || hasCheckRateLimit

  const hasHandleError = /handleError\s*\(/.test(content)

  // Detect HTTP methods exported
  const methods = []
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
    if (new RegExp(`export\\s+async\\s+function\\s+${method}\\b`).test(content)) {
      methods.push(method)
    }
  }

  // Skip non-API files (e.g., __tests__, helpers)
  if (relativePath.includes("__tests__") || relativePath.includes("helpers")) {
    return null
  }

  return {
    path: relativePath,
    methods,
    hasAuth,
    hasRateLimit,
    hasHandleError,
    issues: [],
  }
}

// ── Issue classification ────────────────────────────────────────────────────

const PUBLIC_ROUTES = new Set([
  // Root
  "app/api/route.ts",
  // Auth (public by design)
  "app/api/auth/login/route.ts",
  "app/api/auth/register/route.ts",
  "app/api/auth/forgot-password/route.ts",
  "app/api/auth/reset-password/route.ts",
  "app/api/auth/me/route.ts",
  "app/api/auth/logout/route.ts",
  // Cron (CRON_SECRET via middleware)
  "app/api/cron/commissions-report/route.ts",
  "app/api/cron/geo-cache-warm/route.ts",
  "app/api/cron/geo-health-alert/route.ts",
  "app/api/cron/health-monitor/route.ts",
  "app/api/cron/push-scheduled/route.ts",
  "app/api/cron/reminders/route.ts",
  "app/api/cron/scheduled-push/route.ts",
  "app/api/cron/settlements/route.ts",
  // Health/metrics (public monitoring endpoints)
  "app/api/health/route.ts",
  "app/api/health/detailed/route.ts",
  "app/api/health/extended/route.ts",
  "app/api/metrics/route.ts",
  "app/api/metrics/prometheus/route.ts",
  // Webhooks (signature verification)
  "app/api/sentry/route.ts",
  "app/api/webhooks/lytex/route.ts",
  "app/api/webhooks/evolution/route.ts",
  "app/api/webhooks/sentry-alert/route.ts",
  // Public search/stats
  "app/api/stats/public/route.ts",
  "app/api/stats/activity/route.ts",
  "app/api/reviews/recent/route.ts",
])

const _AUTH_ONLY_ROUTES = new Set([
  "api/auth/logout/route.ts",
  "api/auth/change-password/route.ts",
])

function classifyIssues(analysis) {
  const { path, hasAuth, hasRateLimit } = analysis
  const issues = []

  // Public routes don't need auth/rate-limit
  if (PUBLIC_ROUTES.has(path)) {
    analysis.isPublic = true
    return issues
  }

  // Check auth
  if (!hasAuth) {
    issues.push({
      severity: "HIGH",
      type: "MISSING-AUTH",
      message: "Route has no authentication (requireUser/requireRole)",
    })
  }

  // Check rate limit
  if (!hasRateLimit) {
    issues.push({
      severity: "MEDIUM",
      type: "MISSING-RATE-LIMIT",
      message: "Route has no rate limiting (assertRateLimit/checkRateLimit)",
    })
  }

  return issues
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const files = findRouteFiles(SRC_DIR)
  const analyses = []

  for (const file of files) {
    const analysis = analyzeRoute(file)
    if (analysis) {
      analysis.issues = classifyIssues(analysis)
      analyses.push(analysis)
    }
  }

  // Report
  const withIssues = analyses.filter((a) => a.issues.length > 0)
  const publicRoutes = analyses.filter((a) => a.isPublic)
  const secureRoutes = analyses.filter((a) => !a.isPublic && a.issues.length === 0)

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ analyses, summary: {
      total: analyses.length,
      secure: secureRoutes.length,
      public: publicRoutes.length,
      withIssues: withIssues.length,
    }}, null, 2))
  } else {
    console.log(`\n=== Route Security Audit ===`)
    console.log(`Total routes scanned: ${analyses.length}`)
    console.log(`  Secure (auth + rate-limit): ${secureRoutes.length}`)
    console.log(`  Public (by design): ${publicRoutes.length}`)
    console.log(`  Issues found: ${withIssues.length}`)

    if (withIssues.length > 0) {
      console.log(`\n--- Routes with Issues ---`)
      for (const a of withIssues) {
        console.log(`\n  ${a.path} [${a.methods.join(", ")}]`)
        for (const issue of a.issues) {
          const icon = issue.severity === "HIGH" ? "!!" : "!"
          console.log(`    [${icon}] ${issue.type}: ${issue.message}`)
          if (FIX_SUGGESTIONS) {
            if (issue.type === "MISSING-AUTH") {
              console.log(`        Fix: Add import { requireUser } from "@/lib/auth"`)
              console.log(`              const session = await requireUser()`)
            }
            if (issue.type === "MISSING-RATE-LIMIT") {
              console.log(`        Fix: Add import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"`)
              console.log(`              await assertRateLimit(request, RATE_LIMITS.general)`)
            }
          }
        }
      }
    }

    console.log("")
  }

  process.exit(withIssues.length > 0 ? 1 : 0)
}

main()
