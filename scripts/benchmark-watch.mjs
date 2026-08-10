#!/usr/bin/env node
/**
 * benchmark-watch.mjs - one-shot benchmark + watch mode
 *
 * Runs the specified benchmark with --json output, then enters
 * --watch mode on compare-benchmarks.mjs so that every subsequent
 * re-run of the benchmark automatically re-compares against the
 * baseline in real time.
 *
 * This is useful for iterative development: keep this script running
 * in one terminal, tweak code in another, then re-run the benchmark
 * to see the performance diff update live.
 *
 * Usage:
 *   node scripts/benchmark-watch.mjs --type geo
 *   node scripts/benchmark-watch.mjs --type cache
 *   node scripts/benchmark-watch.mjs --type geo --baseline my-baseline.json
 *   node scripts/benchmark-watch.mjs --type cache --filter cache  --threshold 10
 *
 * Flags:
 *   --type <t>       Benchmark type: geo or cache (required).
 *   --baseline <f>   Custom baseline file (default: docs/benchmarks/<t>-baseline.json).
 *   --filter <str>   Passed through to compare-benchmarks.mjs --filter.
 *   --threshold <n>  Passed through to compare-benchmarks.mjs --threshold.
 *
 * Exit code:
 *   0 - no regressions
 *   1 - at least one benchmark regressed (from last comparison)
 *   2 - unknown type, missing --type, or file read error
 */

import { execSync, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const BENCHMARKS = {
  geo:   { script: "geo-benchmark.mjs",   latest: "geo-latest.json",   baseline: "geo-baseline.json"   },
  cache: { script: "cache-benchmark.mjs", latest: "cache-latest.json", baseline: "cache-baseline.json" },
}

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(SCRIPTS_DIR, "..", "docs", "benchmarks")

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)

const typeIndex = args.indexOf("--type")
const type = (typeIndex !== -1 && args[typeIndex + 1] && !args[typeIndex + 1].startsWith("--"))
  ? args[typeIndex + 1]
  : null

const baselineIndex = args.indexOf("--baseline")
let customBaseline = null
if (baselineIndex !== -1 && args[baselineIndex + 1] && !args[baselineIndex + 1].startsWith("--")) {
  customBaseline = args[baselineIndex + 1]
}

const filterIndex = args.indexOf("--filter")
let filterPrefix = null
if (filterIndex !== -1 && args[filterIndex + 1] && !args[filterIndex + 1].startsWith("--")) {
  filterPrefix = args[filterIndex + 1]
}

const thresholdIndex = args.indexOf("--threshold")
let thresholdArg = null
if (thresholdIndex !== -1 && args[thresholdIndex + 1] && !args[thresholdIndex + 1].startsWith("--")) {
  thresholdArg = args[thresholdIndex + 1]
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

if (!type || !BENCHMARKS[type]) {
  console.error("[FAIL] Usage: node scripts/benchmark-watch.mjs --type geo|cache [--baseline <f>] [--filter <str>] [--threshold <n>]")
  console.error(`   Available types: ${Object.keys(BENCHMARKS).join(", ")}`)
  process.exit(2)
}

const cfg = BENCHMARKS[type]
const scriptPath = join(SCRIPTS_DIR, cfg.script)
const latestPath = join(OUT_DIR, cfg.latest)
const baselinePath = customBaseline || join(OUT_DIR, cfg.baseline)

if (!existsSync(scriptPath)) {
  console.error(`[FAIL] Benchmark script not found: ${scriptPath}`)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Step 1 - run benchmark once with --json
// ---------------------------------------------------------------------------

console.log("")
console.log(`  ===  ${type.toUpperCase()} Benchmark - initial run  ===`)
console.log("")

const runCmd = `node "${scriptPath}" --json "${latestPath}"`

try {
  execSync(runCmd, { stdio: "inherit" })
} catch (err) {
  console.error(`[FAIL] Benchmark failed: ${err.message}`)
  process.exit(1)
}

if (!existsSync(latestPath)) {
  console.error(`[FAIL] Benchmark did not produce output at ${latestPath}`)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Step 2 - validate baseline
// ---------------------------------------------------------------------------

if (!existsSync(baselinePath)) {
  console.log(`  [WARN]  No baseline found at ${baselinePath}`)
  console.log(`  [INFO]  Run the benchmark once and save the result as baseline:`)
  console.log(`       cp "${latestPath}" "${baselinePath}"`)
  console.log("")
  console.log("   Watch mode: waiting for baseline to appear...\n")

  // Poll for baseline to be created, then enter watch mode
  const pollInterval = setInterval(() => {
    if (existsSync(baselinePath)) {
      clearInterval(pollInterval)
      console.log(`  [OK] Baseline detected at ${baselinePath}`)
      console.log("")
      enterWatchMode()
    }
  }, 1000)

  // Keep alive
  process.on("SIGINT", () => {
    clearInterval(pollInterval)
    console.log("\n   Watch mode stopped.\n")
    process.exit(0)
  })
} else {
  enterWatchMode()
}

// ---------------------------------------------------------------------------
// Step 3 - enter compare-benchmarks --watch
// ---------------------------------------------------------------------------

function enterWatchMode() {
  let compareArgs = [
    `"${join(SCRIPTS_DIR, "compare-benchmarks.mjs")}"`,
    "--watch",
  ]

  if (filterPrefix)  compareArgs.push(`--filter "${filterPrefix}"`)
  if (thresholdArg)  compareArgs.push(`--threshold ${thresholdArg}`)

  compareArgs.push(`"${baselinePath}"`, `"${latestPath}"`)

  const fullCmd = compareArgs.join(" ")
  console.log(`  --- Entering watch mode -----------------------------------`)
  console.log(`  Baseline:  ${baselinePath}`)
  console.log(`  Current:   ${latestPath}`)
  if (filterPrefix) console.log(`  Filter:    ${filterPrefix}`)
  if (thresholdArg) console.log(`  Threshold: ${thresholdArg}%`)
  console.log(`    Watching for changes... (Ctrl+C to stop)`)
  console.log("")

  try {
    execSync(fullCmd, { stdio: "inherit" })
  } catch (err) {
    // exit code 1 = regression detected, still a valid exit
    if (err.status === 1) {
      process.exit(1)
    }
    console.error(`[FAIL] compare-benchmarks exited with code ${err.status}`)
    process.exit(err.status || 1)
  }
}
