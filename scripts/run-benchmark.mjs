#!/usr/bin/env node

/**
 * run-benchmark.mjs - unified benchmark runner
 *
 * Dispatches to the appropriate benchmark script based on --type.
 * Each type saves to docs/benchmarks/<type>-latest.json and has its
 * own baseline file at docs/benchmarks/<type>-baseline.json.
 *
 * Usage:
 *   node scripts/run-benchmark.mjs --type geo                # stdout only
 *   node scripts/run-benchmark.mjs --type cache --json       # save to <type>-latest.json
 *   node scripts/run-benchmark.mjs --type geo --baseline     # save directly to baseline
 *   node scripts/run-benchmark.mjs --type cache --save       # save to <type>-YYYY-MM-DD.json
 *   node scripts/run-benchmark.mjs --type geo --compare      # run + compare vs baseline
 *   node scripts/run-benchmark.mjs --type all --json         # run all types sequentially
 *
 * Flags:
 *   --type <t>     Benchmark type: geo, cache (add more as needed)
 *   --json         Save result to docs/benchmarks/<type>-latest.json
 *   --baseline     Save result directly to docs/benchmarks/<type>-baseline.json
 *   --save         Save result to docs/benchmarks/<type>-YYYY-MM-DD.json
 *   --compare      After running, compare against the baseline file
 *   --all          Run all registered benchmark types
 *
 * Exit codes:
 *   0 - success
 *   1 - benchmark or comparison failed
 *   2 - unknown type or missing --type
 */

import { execSync } from "node:child_process"
import { join, dirname } from "node:path"
import { existsSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

// ---------------------------------------------------------------------------
// Registry: each type maps to its script and file conventions
// ---------------------------------------------------------------------------

const BENCHMARKS = {
  geo: {
    script: "geo-benchmark.mjs",
    latest: "geo-latest.json",
    baseline: "geo-baseline.json",
    compareFilter: null,
    label: "Geo-Distance",
  },
  cache: {
    script: "cache-benchmark.mjs",
    latest: "cache-latest.json",
    baseline: "cache-baseline.json",
    compareFilter: "cache",
    label: "Redis Cache",
  },
  search: {
    script: "search-benchmark.mjs",
    latest: "search-latest.json",
    baseline: "search-baseline.json",
    compareFilter: "search",
    label: "Search-Index",
  },
}

const BENCHMARK_TYPES = Object.keys(BENCHMARKS)
const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
  "benchmarks",
)

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)

// Parse flags
const typeIndex = args.indexOf("--type")
let type = null
if (typeIndex !== -1 && args[typeIndex + 1] && !args[typeIndex + 1].startsWith("--")) {
  type = args[typeIndex + 1]
}

const jsonFlag = args.includes("--json")
const baselineFlag = args.includes("--baseline")
const saveFlag = args.includes("--save")
const compareFlag = args.includes("--compare")
const allFlag = args.includes("--all")

// If --all is set, override type
if (allFlag) {
  type = "all"
}

// --type geo|cache|all is required
if (!type) {
  console.error("[FAIL] Usage: node scripts/run-benchmark.mjs --type geo|cache|all [--json] [--baseline] [--save] [--compare]")
  console.error(`   Available types: ${BENCHMARK_TYPES.join(", ")}`)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))

function benchmarkPath(type, file) {
  return join(OUT_DIR, file)
}

function runSingle(type) {
  const cfg = BENCHMARKS[type]
  if (!cfg) {
    console.error(`[FAIL] Unknown benchmark type "${type}". Available: ${BENCHMARK_TYPES.join(", ")}`)
    process.exit(2)
  }

  const scriptPath = join(SCRIPTS_DIR, cfg.script)
  if (!existsSync(scriptPath)) {
    console.error(`[FAIL] Benchmark script not found: ${scriptPath}`)
    process.exit(2)
  }

  mkdirSync(OUT_DIR, { recursive: true })

  // Determine output file based on flags
  let outputFile = null

  // When --compare is used, always save to latest (required for comparison)
  if (compareFlag) {
    outputFile = benchmarkPath(type, cfg.latest)
  } else if (baselineFlag) {
    outputFile = benchmarkPath(type, cfg.baseline)
  } else if (saveFlag) {
    const tag = new Date().toISOString().slice(0, 10)
    outputFile = benchmarkPath(type, `${type}-${tag}.json`)
  }

  // Build the command
  let cmd = `node "${scriptPath}"`
  if (outputFile) {
    cmd += ` --json "${outputFile}"`
  }

  // Run the benchmark
  console.log(`\n  --- ${cfg.label} Benchmark -----------------------------------\n`)
  execSync(cmd, { stdio: "inherit" })

  // If --compare, run comparison against baseline
  if (compareFlag) {
    const baselinePath = benchmarkPath(type, cfg.baseline)
    const latestPath = benchmarkPath(type, cfg.latest)

    if (!existsSync(baselinePath)) {
      console.log(`  [WARN]  No baseline found at ${baselinePath} - skipping comparison.`)
      return 0
    }
    if (!existsSync(latestPath)) {
      console.log(`  [WARN]  No latest results at ${latestPath} - skipping comparison.`)
      return 0
    }

    console.log(`\n  --- Comparing ${type} against baseline ---------------------\n`)

    let compareCmd = `node "${join(SCRIPTS_DIR, "compare-benchmarks.mjs")}"`
    if (cfg.compareFilter) {
      compareCmd += ` --filter ${cfg.compareFilter}`
    }
    compareCmd += ` "${baselinePath}" "${latestPath}"`

    try {
      execSync(compareCmd, { stdio: "inherit" })
      return 0
    } catch {
      console.log(`\n  [WARN]  Comparison failed - regression detected in ${type} benchmarks.`)
      return 1
    }
  }

  return 0
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

if (type === "all") {
  let exitCode = 0
  for (const t of BENCHMARK_TYPES) {
    const code = runSingle(t)
    if (code !== 0) exitCode = code
  }
  process.exit(exitCode)
} else {
  const exitCode = runSingle(type)
  process.exit(exitCode)
}
