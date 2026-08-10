#!/usr/bin/env node

/**
 * format-fuzz-results.mjs
 *
 * Reads one or more vitest JSON output files and prints a formatted
 * fuzz test summary table.
 *
 * Used by scripts/run-fuzz.sh - avoids /dev/stdin pipe issues on
 * Windows Git Bash by reading files directly.
 *
 * Usage:
 *   node scripts/format-fuzz-results.mjs <file1.json> [file2.json ...]
 *   node scripts/format-fuzz-results.mjs --json <file1.json> [...]
 */

import { readFileSync } from "node:fs"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDuration(us) {
  if (!us || us === 0) return "-"
  if (us < 1000) return `${Math.round(us)} us`
  return `${(us / 1000).toFixed(1)} ms`
}

function fmtWallClock(ms) {
  if (!ms || ms === 0) return "-"
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function parseResults(jsonPath) {
  const raw = readFileSync(jsonPath, "utf-8")
  const data = JSON.parse(raw)

  // Read sidecar .iters file written by run-fuzz.sh
  const itersPath = jsonPath.replace(/\.json$/, ".iters")
  let iterations = 0
  try {
    iterations = Number.parseInt(readFileSync(itersPath, "utf-8").trim(), 10)
    if (!Number.isFinite(iterations) || iterations < 0) iterations = 0
  } catch {
    // .iters file not found - fall back to total test count
    iterations = data.numTotalTests ?? 0
  }

  const stats = {
    file: jsonPath.replace(/^.*[/\\]/, "").replace(/\.json$/, ""),
    numTotalTests: data.numTotalTests ?? 0,
    numPassedTests: data.numPassedTests ?? 0,
    numFailedTests: data.numFailedTests ?? 0,
    durationMs: data.duration ?? 0,
    slowestMicro: 0,
    fastestMicro: Infinity,
    iterations,
    tests: [],
  }

  const testResults = data.testResults ?? []
  for (const suite of testResults) {
    const assertionResults = suite.assertionResults ?? []
    for (const t of assertionResults) {
      const d = t.duration ?? 0
      if (d > stats.slowestMicro) stats.slowestMicro = d
      if (d < stats.fastestMicro && d > 0) stats.fastestMicro = d
      stats.tests.push({
        name: t.fullName ?? t.title ?? "?",
        status: t.status ?? "unknown",
        durationMicro: d,
      })
    }
  }

  if (stats.fastestMicro === Infinity) stats.fastestMicro = 0

  return stats
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const jsonMode = args.includes("--json")
const files = args.filter((a) => a !== "--json" && !a.startsWith("--"))

if (files.length === 0) {
  console.error("Usage: node scripts/format-fuzz-results.mjs [--json] <vitest-output.json> ...")
  process.exit(2)
}

const results = []
for (const f of files) {
  try {
    results.push(parseResults(f))
  } catch (err) {
    console.error(`[WARN] Error reading ${f}: ${err.message}`)
    results.push({
      file: f.replace(/^.*[/\\]/, "").replace(/\.json$/, ""),
      numTotalTests: 0,
      numPassedTests: 0,
      numFailedTests: -1,
      durationMs: 0,
      slowestMicro: 0,
      fastestMicro: 0,
      tests: [],
      error: err.message,
    })
  }
}

const allPassed = results.every((r) => r.numFailedTests === 0)

if (jsonMode) {
  console.log(JSON.stringify(results, null, 2))
} else {
  console.log("")
  const pad = (s, n) => String(s).padEnd(n)
  const padL = (s, n) => String(s).padStart(n)

  console.log(
    `  ${pad("File", 44)} ${padL("Iter", 5)} ${padL("Slowest", 7)} ${padL("Fastest", 7)} ${padL("Duration", 8)}   Result`,
  )
  console.log(
    `  ${pad("-", 44).replace(/ /g, "-")} ${padL("-", 5).replace(/ /g, "-")} ${padL("-", 7).replace(/ /g, "-")} ${padL("-", 7).replace(/ /g, "-")} ${padL("-", 8).replace(/ /g, "-")}   ${padL("-", 6).replace(/ /g, "-")}`,
  )

  for (const r of results) {
    const status =
      r.numFailedTests === -1
        ? "[WARN] ERR"
        : r.numFailedTests === 0
          ? "[OK] PASS"
          : `[FAIL] FAIL (${r.numFailedTests}/${r.numTotalTests})`

    const iterLabel = r.iterations && r.iterations > 0 ? String(r.iterations) : "-"

    console.log(
      `  ${pad(r.file, 44)} ${padL(iterLabel, 5)} ${padL(fmtDuration(r.slowestMicro), 7)} ${padL(fmtDuration(r.fastestMicro), 7)} ${padL(fmtWallClock(r.durationMs), 8)}   ${status}`,
    )
  }

  console.log("")

  if (results.some((r) => r.numFailedTests === -1)) {
    console.log("  [WARN] Some results had errors (see above).")
  } else if (allPassed) {
    console.log("  [OK] All fuzz tests passed.")
  } else {
    console.log("  [FAIL] Some fuzz tests failed.")
    for (const r of results) {
      if (r.numFailedTests > 0) {
        console.log(`     [FAIL] ${r.file}`)
      }
    }
  }

  console.log("")
}

process.exit(allPassed ? 0 : 1)
