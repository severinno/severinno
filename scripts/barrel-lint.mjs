#!/usr/bin/env node

/**
 * barrel-lint.mjs
 *
 * Checks (1) that application code imports from barrels instead of reaching
 * directly into implementation modules, and (2) that every executable script
 * under scripts/ has minimum header documentation (Usage + Exit code).
 *
 * Barrels currently enforced:
 *   @/lib/geo-server     —  re-exports from distance-fallback, geo-shared
 *   @/lib/sql            —  re-exports from sql-builder, sql-booking-builder,
 *                            sql-service-builder
 *   @/lib/__tests__      —  re-exports from fuzz-utils, helpers/api-test-utils,
 *                            helpers/cache-test-utils, helpers/crlf-git-fixture
 *
 * Violations flagged:
 *   - import ... from "@/lib/distance-fallback"
 *   - import ... from "@/lib/geo-shared"
 *   - import ... from "@/lib/sql-builder"
 *   - import ... from "@/lib/sql-booking-builder"
 *   - import ... from "@/lib/sql-service-builder"
 *   - import ... from "@/lib/__tests__/fuzz-utils"
 *   - import ... from "@/lib/__tests__/helpers/api-test-utils"
 *   - import ... from "@/lib/__tests__/helpers/cache-test-utils"
 *
 * Header check:
 *   - Scans every file under scripts/ with an executable extension
 *   - Verifies the LEADING DOCUMENTATION BLOCK (the comment lines at the top,
 *     up to the first line of code) contains both "Usage:" and "Exit code"
 *
 * A regra do cabecalho mora em scripts/check-script-headers.mjs (o gate
 * bloqueante no CI) e e IMPORTADA daqui: duas copias da mesma regra divergem no
 * dia em que uma delas for ajustada, e este agregador existe para rodar na
 * maquina de quem commita, nao para ter a sua propria versao do contrato.
 *
 * Test files (.test.ts, .spec.ts) are excluded from barrel checks because
 * they often need to import implementation modules directly for white-box
 * testing.  Barrel implementation modules are also excluded to avoid
 * circular dependency warnings.
 *
 * Usage:
 *   node scripts/barrel-lint.mjs
 *   npm run barrel-lint
 *
 * Exit codes:
 *   0 — all clean
 *   1 — barrel import violations found
 *   2 — unexpected error
 *   3 — script header documentation violations found
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { scanHeaders } from "./check-script-headers.mjs"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = resolve(fileURLToPath(import.meta.url), "../..")
const SRC = join(ROOT, "src")

/** Modules that should be imported only through the barrel. */
const FORBIDDEN_IMPORTS = [
  // Geo — barrel @/lib/geo-server
  "@/lib/distance-fallback",
  "@/lib/geo-shared",
  // SQL — barrel @/lib/sql
  "@/lib/sql-builder",
  "@/lib/sql-booking-builder",
  "@/lib/sql-service-builder",
  // Test helpers — barrel @/lib/__tests__
  "@/lib/__tests__/fuzz-utils",
  "@/lib/__tests__/helpers/api-test-utils",
  "@/lib/__tests__/helpers/cache-test-utils",
  "@/lib/__tests__/helpers/crlf-git-fixture",
]

/**
 * Patterns for files/directories to exclude.
 *
 * Implementation modules are excluded because they are the source of the
 * re-exported symbols — they cannot import from the barrel that re-exports
 * them (that would be a circular dependency).
 *
 * Test files (.test.ts, .spec.ts) are excluded because they often need to
 * import implementation modules directly for white-box testing.
 */
const EXCLUDE_PATTERNS = [
  ".test.ts",
  ".spec.ts",
  // Geo — implementation modules (circular if they import from the barrel)
  "src/lib/distance-fallback.ts",
  "src/lib/geo-shared.ts",
  // SQL — implementation modules
  "src/lib/sql-builder.ts",
  "src/lib/sql-booking-builder.ts",
  "src/lib/sql-service-builder.ts",
  // Test helpers — implementation modules (circular if they import from the barrel)
  "src/lib/__tests__/fuzz-utils.ts",
  "src/lib/__tests__/helpers/api-test-utils.ts",
  "src/lib/__tests__/helpers/cache-test-utils.ts",
  "src/lib/__tests__/helpers/crlf-git-fixture.ts",
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a file path should be excluded from linting. */
function isExcluded(filePath) {
  return EXCLUDE_PATTERNS.some((p) => filePath.replace(/\\/g, "/").includes(p))
}

/** Check if a line contains a direct import from a forbidden module. */
function hasViolation(line) {
  return FORBIDDEN_IMPORTS.some((mod) => {
    // Match patterns like:
    //   import ... from "@/lib/distance-fallback"
    //   export ... from "@/lib/distance-fallback"
    //   import(".../distance-fallback")
    const pattern = `from "${mod}"`
    const importPattern = `import("${mod}")`
    return (
      (line.includes(pattern) || line.includes(importPattern)) && !line.trimStart().startsWith("//")
    )
  })
}

/** Recursively collect .ts and .tsx files in a directory. */
function collectFiles(dir) {
  const results = []
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath))
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      results.push(fullPath)
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

try {
  const srcStat = statSync(SRC)
  if (!srcStat.isDirectory()) {
    console.error(`❌ Source directory not found: ${SRC}`)
    process.exit(2)
  }

  const files = collectFiles(SRC)
  const violations = []

  for (const file of files) {
    const relPath = relative(ROOT, file)
    if (isExcluded(relPath)) continue

    const content = readFileSync(file, "utf-8")
    const lines = content.split("\n")

    for (let i = 0; i < lines.length; i++) {
      if (hasViolation(lines[i])) {
        violations.push({
          file: relPath,
          line: i + 1,
          text: lines[i].trim(),
        })
      }
    }
  }

  // ── Report barrel violations ────────────────────────────────────────
  if (violations.length > 0) {
    console.log("")
    console.log("╔══════════════════════════════════════════════════════════════════════╗")
    console.log("║              Barrel Lint — Direct Import Violations                ║")
    console.log("╚══════════════════════════════════════════════════════════════════════╝")
    console.log("")
    console.log(`  The following files import directly from modules that should be`)
    console.log(`  accessed through a barrel (@/lib/geo-server or @/lib/sql):`)
    console.log("")

    for (const v of violations) {
      console.log(`  ❌ ${v.file}:${v.line}`)
      console.log(`     → ${v.text}`)
      console.log("")
    }

    console.log(`  ─── ${violations.length} violation(s) found ───`)
    console.log("")
    console.log("  Fix: replace imports with the appropriate barrel:")
    console.log('    import { ... } from "@/lib/geo-server"')
    console.log('    import { ... } from "@/lib/sql"')
    console.log('    import { ... } from "@/lib/__tests__"')
  }

  // ═════════════════════════════════════════════════════════════════════
  // Check 2 — Script header documentation
  // ═════════════════════════════════════════════════════════════════════

  // A varredura (e a regra) vêm do guard que é gate no CI — ver
  // scripts/check-script-headers.mjs. Aqui só o resumo entra no relatório.
  const headers = scanHeaders({ dir: "scripts", root: ROOT })
  const headerViolations = headers.violations.map((v) => ({ name: v.name, missing: v.missing }))

  // ── Report header violations ────────────────────────────────────────
  if (headerViolations.length > 0) {
    console.log("")
    console.log("╔══════════════════════════════════════════════════════════════════════╗")
    console.log("║         Script Header — Missing Documentation Violations           ║")
    console.log("╚══════════════════════════════════════════════════════════════════════╝")
    console.log("")
    console.log(`  These scripts are missing a header comment with both "Usage:"`)
    console.log(`  and "Exit code:" documentation:`)
    console.log("")

    for (const v of headerViolations) {
      console.log(`  ❌ scripts/${v.name} — falta ${v.missing.join(" e ")}`)
    }

    console.log("")
    console.log(`  ─── ${headerViolations.length} violation(s) found ───`)
    console.log("")
    console.log("  Fix: add a JSDoc/comment block at the top with at least:")
    console.log("    // Usage:\n    //   node scripts/<name>")
    console.log("    //\n    // Exit codes:\n    //   0 — success\n    //   1 — failure")
  }

  // ── Final exit code ─────────────────────────────────────────────────
  if (violations.length > 0) {
    process.exit(1)
  }
  if (headerViolations.length > 0) {
    process.exit(3)
  }

  console.log("✅ Barrel lint passed — no violations.")
  process.exit(0)
} catch (err) {
  console.error("❌ barrel-lint error:", err.message)
  process.exit(2)
}
