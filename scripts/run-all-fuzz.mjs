#!/usr/bin/env node

/**
 * run-all-fuzz.mjs
 *
 * Pure Node.js fuzz test runner — no bash/sed dependency.
 * Portável para Windows e CI multiplataforma.
 *
 * Auto-descobre todos os arquivos *-fuzz*.test.{ts,tsx} em src/,
 * extrai FUZZ_ITERATIONS de cada um via regex, executa vitest
 * com --reporter=json, e formata os resultados.
 *
 * Usage:
 *   node scripts/run-all-fuzz.mjs                   # table output
 *   node scripts/run-all-fuzz.mjs --json            # JSON output for CI
 *   node scripts/run-all-fuzz.mjs --only radius     # filter by filename
 *   node scripts/run-all-fuzz.mjs --verbose         # raw vitest output
 *
 * Exit codes:
 *   0 — all fuzz tests passed
 *   1 — one or more fuzz tests failed
 *   2 — unexpected error
 */

import { execSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT = resolve(fileURLToPath(import.meta.url), "../..")
const SRC = join(ROOT, "src")

/** Name of the formatter script used for output. */
const FORMATTER = join(ROOT, "scripts", "format-fuzz-results.mjs")

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const VERBOSE = args.includes("--verbose")
const JSON_MODE = args.includes("--json")

let ONLY_FILTER = ""
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg.startsWith("--only=")) {
    ONLY_FILTER = arg.slice("--only=".length)
  } else if (arg === "--only" && i + 1 < args.length && !args[i + 1].startsWith("--")) {
    ONLY_FILTER = args[++i]
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function walkDir(dir) {
  const files = []
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkDir(full))
    } else if (entry.isFile() && /\.test\.[jt]sx?$/.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

/**
 * Check if a file is a fuzz test.
 *
 * Matches files like:
 *   radius-expansion-fuzz.test.ts
 *   address-autocomplete-fuzz.test.tsx
 *   cache-key-fuzz.test.ts
 *
 * Requires `fuzz` to be preceded by a separator (`-`, `_`, `.`)
 * or be at the start of the filename, to avoid false positives
 * like `refuzz.test.ts`.
 */
function isFuzzFile(filePath) {
  const name = filePath.replace(/\\/g, "/").split("/").pop() ?? ""
  return /(?:^|[-._])fuzz[^/]*\.test\.[jt]sx?$/i.test(name)
}

/** Extract FUZZ_ITERATIONS value from a source file. */
function extractIterations(filePath) {
  try {
    const content = readFileSync(filePath, "utf-8")
    const match = content.match(
      /FUZZ_ITERATIONS\s*[:=]\s*(\d+)/,
    )
    return match ? Number.parseInt(match[1], 10) : 0
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  // ---- Discover fuzz files ----
  const allFiles = walkDir(SRC).filter(isFuzzFile)

  // Apply --only filter
  let fuzzFiles = allFiles
  if (ONLY_FILTER) {
    fuzzFiles = allFiles.filter((f) =>
      f.replace(/\\/g, "/").includes(ONLY_FILTER),
    )
  }

  if (fuzzFiles.length === 0) {
    console.error(`❌ No fuzz files matched pattern '${ONLY_FILTER || "*"}' in ${SRC}`)
    process.exit(2)
  }

  // ---- Header ----
  // In JSON mode, header goes to stderr so stdout is pure JSON (for > file redirects).
  const log = JSON_MODE ? console.error : console.log
  log("")
  log("╔══════════════════════════════════════════════════════════════════════╗")
  log("║                   Severinno — Fuzz Test Runner                     ║")
  log("╚══════════════════════════════════════════════════════════════════════╝")
  log("")

  if (ONLY_FILTER) {
    log(`  Filter: --only=${ONLY_FILTER}`)
  }
  log("  Seed:   42 (hardcoded in each test suite)")
  log("")

  // ---- --verbose mode: run vitest inline ----
  if (VERBOSE) {
    const fileArgs = fuzzFiles.map((f) => relative(ROOT, f)).join(" ")
    log(`  Running: npx vitest run ${fileArgs} --reporter=verbose\n`)
    try {
      execSync(`npx vitest run ${fuzzFiles.map((f) => `"${f}"`).join(" ")} --reporter=verbose`, {
        cwd: ROOT,
        stdio: "inherit",
        shell: true,
      })
    } catch {
      process.exit(1)
    }
    return
  }

  // ---- Normal mode: run each file, collect JSON ----
  const tmpDir = mkdtempSync(join(tmpdir(), "fuzz-"))
  const jsonFiles = []

  for (const file of fuzzFiles) {
    const label = file.replace(/\\/g, "/").split("/").pop()?.replace(/\.[jt]sx?$/, "") ?? "unknown"
    const jsonOut = join(tmpDir, `${label}.json`)
    const iters = extractIterations(file)

    try {
      execSync(`npx vitest run "${file}" --reporter=json > "${jsonOut}" 2> "${tmpDir}/${label}.stderr"`, {
        cwd: ROOT,
        stdio: "pipe",
        shell: true,
        timeout: 120_000,
      })
    } catch {
      // vitest exits non-zero on failure; that's OK — the JSON is still valid
    }

    // Write sidecar .iters file for the formatter
    writeFileSync(join(tmpDir, `${label}.iters`), String(iters), "utf-8")

    jsonFiles.push(jsonOut)
  }

  // ---- Format output ----
  const formatterArgs = JSON_MODE ? ["--json", ...jsonFiles] : jsonFiles

  try {
    execSync(
      `node "${FORMATTER}" ${formatterArgs.map((a) => `"${a}"`).join(" ")}`,
      {
        cwd: ROOT,
        stdio: "inherit",
        shell: true,
      },
    )
  } catch {
    // formatter exits non-zero on failures; propagate
    rmSync(tmpDir, { recursive: true, force: true })
    process.exit(1)
  }

  // Cleanup
  rmSync(tmpDir, { recursive: true, force: true })
}

main()
