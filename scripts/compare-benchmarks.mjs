#!/usr/bin/env node
/**
 * compare-benchmarks.mjs
 *
 * Compares two geo-benchmark JSON files and prints a colour-coded diff
 * showing which metrics improved, regressed, or stayed the same.
 *
 * Usage:
 *   node scripts/compare-benchmarks.mjs <baseline.json> <current.json>
 *   node scripts/compare-benchmarks.mjs docs/benchmarks/geo-benchmark.json /tmp/geo-current.json
 *   node scripts/compare-benchmarks.mjs --json baseline.json current.json
 *   node scripts/compare-benchmarks.mjs --filter haversine baseline.json current.json
 *   node scripts/compare-benchmarks.mjs --filter postgis_model --json baseline.json current.json
 *   node scripts/compare-benchmarks.mjs --threshold 10 baseline.json current.json
 *   BENCHMARK_THRESHOLD=10 node scripts/compare-benchmarks.mjs baseline.json current.json
 *   node scripts/compare-benchmarks.mjs --watch --on-change 'say "regression"' baseline.json current.json
 *
 * Flags:
 *   --json           Write diff to stdout as JSON (for CI consumption).
 *   --filter <str>   Only compare benchmarks whose label starts with <str>.
 *                    Useful when the JSON contains multiple benchmark types
 *                    (geo, cache, search, etc.) and you want only one.
 *   --threshold <n>  Regression threshold in percent (default: 5).
 *                    Can also be set via BENCHMARK_THRESHOLD env var.
 *                    The env var is overridden by --threshold if both are set.
 *   --on-change <s>  Shell command to run after each comparison in
 *                    --watch mode, e.g. --on-change 'say "regression"'.
 *                    Always runs, regardless of whether a regression was
 *                    detected.  The command is executed via execSync.
 *
 * Exit code:
 *   0 - no regressions (or only improvements / unchanged)
 *   1 - at least one benchmark regressed >threshold % in mean (among filtered set)
 *   2 - file read or parse error
 */

import { readFileSync, watchFile } from "node:fs"
import { execSync } from "node:child_process"
import { pct, arrow, computeDiff } from "../src/lib/benchmark-diff.mjs"

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)

// Parse flags
const jsonOutput = args.includes("--json")
const watchMode = args.includes("--watch")

const filterIndex = args.indexOf("--filter")
let filterPrefix = null
if (filterIndex !== -1 && args[filterIndex + 1] && !args[filterIndex + 1].startsWith("--")) {
  filterPrefix = args[filterIndex + 1]
}

const thresholdIndex = args.indexOf("--threshold")
let threshold = 5  // default
if (process.env.BENCHMARK_THRESHOLD) {
  const parsed = parseFloat(process.env.BENCHMARK_THRESHOLD)
  if (!isNaN(parsed) && parsed > 0) threshold = parsed
}
if (thresholdIndex !== -1 && args[thresholdIndex + 1] && !args[thresholdIndex + 1].startsWith("--")) {
  const parsed = parseFloat(args[thresholdIndex + 1])
  if (!isNaN(parsed) && parsed > 0) {
    threshold = parsed
  } else {
    console.error("[FAIL] --threshold must be a positive number")
    process.exit(2)
  }
}

const onChangeIndex = args.indexOf("--on-change")
let onChangeCommand = null
if (onChangeIndex !== -1 && args[onChangeIndex + 1] && !args[onChangeIndex + 1].startsWith("--")) {
  onChangeCommand = args[onChangeIndex + 1]
}

// Collect positional args (skip --json, --watch, --filter, --threshold, --on-change + their values)
const positional = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--json" || args[i] === "--watch") continue
  if (args[i] === "--filter" || args[i] === "--threshold" || args[i] === "--on-change") { i++; continue }
  positional.push(args[i])
}

if (positional.length !== 2) {
  console.error("Usage: node scripts/compare-benchmarks.mjs [--json] [--watch] [--filter <str>] [--threshold <n>] [--on-change <cmd>] <baseline.json> <current.json>")
  process.exit(2)
}

const [baselinePath, currentPath] = positional

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

function load(path, label) {
  try {
    const raw = readFileSync(path, "utf-8")
    return JSON.parse(raw)
  } catch (err) {
    console.error(`[FAIL] Error loading ${label} (${path}): ${err.message}`)
    process.exit(2)
  }
}

const baseline = load(baselinePath, "baseline")

// ---------------------------------------------------------------------------
// Soft loader - returns null on error instead of exiting (for watch mode)
// ---------------------------------------------------------------------------

function safeLoad(path) {
  try {
    const raw = readFileSync(path, "utf-8")
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// main comparison - extracted so it can be reused in watch mode
// ---------------------------------------------------------------------------

function runComparison() {
  const current = safeLoad(currentPath)
  if (!current) {
    if (watchMode) {
      console.error(`  [WARN]  Could not parse current file (still being written?)`)
      return 2
    }
    console.error(`[FAIL] Error loading current (${currentPath})`)
    process.exit(2)
  }

// ---------------------------------------------------------------------------
// Environment check - warn if platforms differ
// ---------------------------------------------------------------------------

if (baseline.meta && current.meta) {
  if (baseline.meta.platform !== current.meta.platform ||
      baseline.meta.nodeVersion !== current.meta.nodeVersion ||
      baseline.meta.arch !== current.meta.arch) {
    console.warn(
      "[WARN]  Warning: baseline and current were run on different environments.\n" +
      `     Baseline: ${baseline.meta.platform} ${baseline.meta.arch} Node ${baseline.meta.nodeVersion}\n` +
      `     Current:  ${current.meta.platform} ${current.meta.arch} Node ${current.meta.nodeVersion}\n` +
      "     Comparison may be misleading due to CPU/OS differences.\n",
    )
  }
}

// ---------------------------------------------------------------------------
// Diff computation (extracted to src/lib/benchmark-diff.mjs)
// ---------------------------------------------------------------------------

const diff = computeDiff(baseline, current, { threshold, filterPrefix })

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

if (jsonOutput) {
  console.log(JSON.stringify({ diff, exitCode: diff.regressions.length > 0 ? 1 : 0 }, null, 2))
  return diff.regressions.length > 0 ? 1 : 0
}

// ---------------------------------------------------------------------------
// Pretty-printed table
// ---------------------------------------------------------------------------

function pad(s, w) {
  return String(s ?? "").padStart(w)
}

// -- Header ----------------------------------------------------------------

console.log("")
console.log("+======================================================================+")
console.log("|          Severinno - Geo-Benchmark Comparison (diff)               |")
console.log("+======================================================================+")
console.log("")

console.log(`  Baseline:  ${baselinePath}`)
console.log(`             ${baseline.meta?.timestamp ?? "?"}  -  ${baseline.meta?.platform ?? "?"} ${baseline.meta?.arch ?? "?"}  Node ${baseline.meta?.nodeVersion ?? "?"}`)
console.log(`  Current:   ${currentPath}`)
console.log(`             ${current.meta?.timestamp ?? "?"}  -  ${current.meta?.platform ?? "?"} ${current.meta?.arch ?? "?"}  Node ${current.meta?.nodeVersion ?? "?"}`)

if (diff.meta.elapsedMs > 0) {
  const hours = Math.floor(diff.meta.elapsedMs / 3600000)
  const mins = Math.floor((diff.meta.elapsedMs % 3600000) / 60000)
  console.log(`  Gap:       ${hours}h ${mins}m between runs`)
}
if (filterPrefix) {
  console.log(`  Filter:    label prefix "${filterPrefix}"`)
}
console.log("")

// -- Table -----------------------------------------------------------------

if (diff.benchmarks.length === 0) {
  const hint = filterPrefix
    ? `No benchmarks match label prefix "${filterPrefix}".`
    : "No benchmarks to compare."
  console.log(`  ${hint}`)
  console.log("")
  return 0
}

console.log("  +----------------------+------------------+------------------+------------------+------------------+")
console.log("  | Benchmark            |  Mean (us)       |  Min (us)        |  Max (us)        |  ops/sec         |")
console.log("  +----------------------+------------------+------------------+------------------+------------------+")

for (const b of diff.benchmarks) {
  if (b.status === "new") {
    console.log(`  | ${b.name.padEnd(20)} | ${"new (no baseline)".padStart(34)} |`)
    continue
  }
  if (b.status === "removed") {
    console.log(`  | ${b.name.padEnd(20)} | ${"removed (no current)".padStart(34)} |`)
    continue
  }

  const meanStr = `${b.mean.current} ${arrow(b.mean.pct)} ${b.mean.pct.toFixed(1)}%`
  const minStr  = `${b.min.current} ${arrow(b.min.pct)} ${b.min.pct.toFixed(1)}%`
  const maxStr  = `${b.max.current} ${arrow(b.max.pct)} ${b.max.pct.toFixed(1)}%`
  const opsStr  = `${b.opsPerSec.current} ${arrow(b.opsPerSec.pct)} ${b.opsPerSec.pct.toFixed(1)}%`

  const marker = b.status === "regression" ? "[WARN]" : " "

  console.log(
    `  |${marker} ${b.name.padEnd(19)} | ${pad(meanStr, 16)} | ${pad(minStr, 16)} | ${pad(maxStr, 16)} | ${pad(opsStr, 16)} |`,
  )
}

console.log("  +----------------------+------------------+------------------+------------------+------------------+")
console.log("")

// -- Analysis diff ---------------------------------------------------------

if (diff.analysis) {
  console.log("  --- Haversine unit cost ----------------------------------------")
  console.log("")

  const a = diff.analysis
  console.log(`    @ 100:     ${a.haversineUnitCosts.at100.current} us/provider  (${arrow(a.haversineUnitCosts.at100.pct)} ${a.haversineUnitCosts.at100.pct}%)`)
  console.log(`    @ 1 000:   ${a.haversineUnitCosts.at1000.current} us/provider  (${arrow(a.haversineUnitCosts.at1000.pct)} ${a.haversineUnitCosts.at1000.pct}%)`)
  console.log(`    @ 10 000:  ${a.haversineUnitCosts.at10000.current} us/provider  (${arrow(a.haversineUnitCosts.at10000.pct)} ${a.haversineUnitCosts.at10000.pct}%)`)
  console.log(`    Average:   ${a.avgHaversinePerProvider.current} us/provider  (${arrow(a.avgHaversinePerProvider.pct)} ${a.avgHaversinePerProvider.pct}%)`)
  console.log("")
}

// -- Summary ----------------------------------------------------------------

const total = diff.benchmarks.length
const regressions = diff.regressions.length
const changes = diff.benchmarks.filter((b) => b.status === "changed").length
const unchanged = diff.benchmarks.filter((b) => b.status === "unchanged").length

console.log("  --- Summary ---------------------------------------------------")
console.log(`    Total benchmarks:  ${total}`)
console.log(`    Regressions (o):   ${regressions}`)
console.log(`    Changed:           ${changes}`)
console.log(`    Unchanged:         ${unchanged}`)
console.log("")

if (regressions > 0) {
  console.log(`  [WARN]  ${regressions} benchmark(s) regressed >${threshold} %:`)
  for (const r of diff.regressions) {
    console.log(`       - ${r.name}  -  mean ${r.mean.baseline} -> ${r.mean.current} us  (${r.mean.pct}%)`)
  }
  console.log("")
  return 1
} else {
  console.log(`  [OK] All benchmarks within threshold (${threshold}%).  No regressions detected.`)
  console.log("")
  return 0
}
}

// =====================================================================
// Dispatch: single run or --watch loop
// =====================================================================

if (watchMode) {
  console.log(`    Watching ${currentPath} for changes... (Ctrl+C to stop)`)
  console.log("")

  // Run once immediately
  runComparison()

  // Debounce: skip rapid writes (benchmark may still be writing)
  let pending = false

  watchFile(currentPath, { interval: 500 }, (currStat) => {
    if (pending) return
    if (!currStat || currStat.size === 0) return
    pending = true

    // Small delay to let the write finish
    setTimeout(() => {
      // Clear the screen for each re-run (keep the header visible)
      console.clear()

      try {
        const code = runComparison()

        // Run the --on-change callback (if provided)
        if (onChangeCommand) {
          try {
            execSync(onChangeCommand, { stdio: "ignore", timeout: 5000 })
          } catch (hookErr) {
            console.error(`  [WARN]  --on-change command failed: ${hookErr.message}`)
          }
        }

        if (code === 1) {
          console.log(`  [WARN]  Regression detected.`)
          console.log("")
        }
      } catch (err) {
        console.error(`  [WARN]  Error re-comparing: ${err.message}`)
      }

      console.log(`    Watching ${currentPath} for changes... (Ctrl+C to stop)`)
      console.log("")
      pending = false
    }, 200)
  })

  // Keep the process alive
  process.on("SIGINT", () => {
    console.log("")
    console.log("   Watch mode stopped.")
    process.exit(0)
  })
} else {
  // Single run
  const exitCode = runComparison()
  process.exit(exitCode)
}
