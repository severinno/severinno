#!/usr/bin/env node
// Usage: node scripts/run-benchmark.mjs --type <type> [options]
// Exit code: 0 = success, 1 = failure/regression, 2 = bad args

/**
 * run-benchmark.mjs — unified benchmark runner
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
 *   --no-cache     Force re-run even if a fresh cached result exists
 *   --skip-db      Skip benchmarks that require a database (real, gist)
 *   --force        Shorthand for --no-cache --skip-db combined (clean run
 *                  without external dependencies)
 *
 * Environment:
 *   BENCHMARK_CACHE_TTL_HOURS   Cache TTL in hours (default: 24).
 *                               A cached result is reused if its
 *                               meta.timestamp is newer than now - TTL.
 *                               Set to 0 to disable cache entirely.
 *
 * Cache manifest (docs/benchmarks/.benchmark-cache.json):
 *   In addition to the TTL check, the runner records the current HEAD
 *   commit hash in a cache manifest file after each successful benchmark.
 *   On subsequent runs, if the HEAD commit has changed since the cached
 *   result was generated, the cache is automatically invalidated and the
 *   benchmark re-runs.  This ensures that code changes always produce
 *   fresh benchmark data, even within the same TTL window.
 *
 *   The commit check is skipped when git is not available (e.g., running
 *   outside a repository) to avoid unnecessary cache invalidations.
 *
 * Cache:
 *   When running --type all, each type checks if <type>-latest.json exists
 *   and its meta.timestamp is within BENCHMARK_CACHE_TTL_HOURS. If so,
 *   the benchmark is SKIPPED (status: cached) and the existing result is
 *   reused.  This avoids re-running all 6 benchmarks on every CI retry
 *   when only 1-2 failed.  Use --no-cache to force a full re-run of all
 *   types.
 *
 * Exit codes:
 *   0 — success
 *   1 — benchmark or comparison failed
 *   2 — unknown type or missing --type
 */

import { execSync } from "node:child_process"
import { join, dirname } from "node:path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
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
    requiresDb: false,
  },
  cache: {
    script: "cache-benchmark.mjs",
    latest: "cache-latest.json",
    baseline: "cache-baseline.json",
    compareFilter: "cache",
    label: "Redis Cache",
    requiresDb: false,
  },
  search: {
    script: "search-benchmark.mjs",
    latest: "search-latest.json",
    baseline: "search-baseline.json",
    compareFilter: "search",
    label: "Search-Index",
    requiresDb: false,
  },
  real: {
    script: "geo-benchmark-real.mjs",
    latest: "geo-real-latest.json",
    baseline: "geo-real-baseline.json",
    compareFilter: null,
    label: "PostGIS Real (DB)",
    requiresDb: true,
  },
  gist: {
    script: "geo-benchmark-gist.mjs",
    latest: "geo-gist-latest.json",
    baseline: "geo-gist-baseline.json",
    compareFilter: null,
    label: "GiST Index",
    requiresDb: true,
  },
  pipeline: {
    script: "geo-pipeline-benchmark.mjs",
    latest: "pipeline-latest.json",
    baseline: "pipeline-baseline.json",
    compareFilter: null,
    label: "Geo-Pipeline",
    requiresDb: false,
  },
}

const BENCHMARK_TYPES = Object.keys(BENCHMARKS)
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "benchmarks")

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

// --type is required
if (!type) {
  console.error(
    "❌ Usage: node scripts/run-benchmark.mjs --type geo|cache|search|real|gist|pipeline|all [--json] [--baseline] [--save] [--compare] [--no-cache] [--skip-db] [--force]",
  )
  console.error(`   Available types: ${BENCHMARK_TYPES.join(", ")}`)
  console.error(`   Flags:`)
  console.error(`     --no-cache   ignore cached results and force re-run`)
  console.error(`     --skip-db    skip benchmarks that require a database (real, gist)`)
  console.error(`     --force      shorthand for --no-cache --skip-db`)
  process.exit(2)
}

// --force: shorthand for --no-cache --skip-db (clean run, no deps)
const forceFlag = args.includes("--force")

// --skip-db: skip benchmarks that require a real database
const skipDb = forceFlag || args.includes("--skip-db")

// --no-cache: force re-run even if a fresh cached result exists
const noCache = forceFlag || args.includes("--no-cache")

// ── Cache TTL from env (default: 24h, set to 0 to disable) ────────────────
const CACHE_TTL_HOURS = (() => {
  const raw = process.env.BENCHMARK_CACHE_TTL_HOURS?.trim()
  if (raw === undefined || raw === "") return 24
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`  ⚠  Invalid BENCHMARK_CACHE_TTL_HOURS=${raw}, falling back to 24h`)
    return 24
  }
  return n
})()
const CACHE_TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000

const CACHE_MANIFEST_PATH = join(OUT_DIR, ".benchmark-cache.json")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))

// ── Git commit hash ──────────────────────────────────────────────────────

/**
 * Get the current HEAD commit hash (short form, 7 chars).
 * Returns null when git is not available or not a git repository.
 */
function getCurrentCommitHash() {
  try {
    return execSync("git rev-parse --short HEAD", {
      encoding: "utf-8",
      timeout: 3000,
    })
      .trim()
      .slice(0, 7)
  } catch {
    return null
  }
}

// ── Cache manifest helpers ───────────────────────────────────────────────

/**
 * Read the benchmark cache manifest.
 * Returns an empty record when the file is missing, corrupt, or invalid.
 *
 * Format:
 *   {
 *     "version": 1,
 *     "entries": {
 *       "geo": { "commitHash": "abc1234", "timestamp": "2026-..." },
 *       ...
 *     }
 *   }
 */
function readCacheManifest() {
  try {
    if (!existsSync(CACHE_MANIFEST_PATH)) return { version: 1, entries: {} }
    const raw = readFileSync(CACHE_MANIFEST_PATH, "utf-8")
    const data = JSON.parse(raw)
    if (data?.version === 1 && data?.entries && typeof data.entries === "object") {
      return data
    }
    return { version: 1, entries: {} }
  } catch {
    return { version: 1, entries: {} }
  }
}

/**
 * Write the cache manifest to disk.
 * Creates the output directory if needed.
 */
function writeCacheManifest(manifest) {
  try {
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(CACHE_MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8")
  } catch {
    // Best-effort — manifest loss only reduces cache efficiency
  }
}

/**
 * Check if the commit hash in the cache manifest matches the current HEAD.
 * Returns true only when both are available and equal.
 * When git is unavailable (null), returns true to avoid false invalidations.
 */
function isCommitCacheValid(manifestEntry, currentCommitHash) {
  // No git available — skip commit check (optimistic)
  if (currentCommitHash == null) return true
  // No manifest entry for this type — not cached before
  if (!manifestEntry?.commitHash) return false
  return manifestEntry.commitHash === currentCommitHash
}

function benchmarkPath(type, file) {
  return join(OUT_DIR, file)
}

function runSingle(type) {
  const cfg = BENCHMARKS[type]
  if (!cfg) {
    console.error(`❌ Unknown benchmark type "${type}". Available: ${BENCHMARK_TYPES.join(", ")}`)
    process.exit(2)
  }

  const scriptPath = join(SCRIPTS_DIR, cfg.script)
  if (!existsSync(scriptPath)) {
    console.error(`❌ Benchmark script not found: ${scriptPath}`)
    process.exit(2)
  }

  mkdirSync(OUT_DIR, { recursive: true })

  // Skip DB-requiring benchmarks when --skip-db is set
  if (skipDb && cfg.requiresDb) {
    console.log(`  ⏭  ${cfg.label} — skipped (requires database)`)
    return { status: "skipped", exitCode: 0, elapsedMs: 0 }
  }

  // ── Cache check: skip if latest JSON exists and is within TTL ─────────
  // Cache is bypassed when:
  //   - --no-cache is set (explicit force)
  //   - CACHE_TTL_HOURS is 0 (disabled via env var)
  //   - --baseline  is set (user wants a fresh baseline capture)
  //   - --save      is set (user wants a fresh dated snapshot)
  const cacheEnabled = CACHE_TTL_HOURS > 0
  const latestPath = benchmarkPath(type, cfg.latest)
  const cacheValid =
    !noCache && cacheEnabled && !baselineFlag && !saveFlag && existsSync(latestPath)

  if (cacheValid) {
    try {
      const raw = readFileSync(latestPath, "utf-8")
      const data = JSON.parse(raw)
      const fileTs = data.meta?.timestamp

      if (fileTs) {
        const fileTime = new Date(fileTs).getTime()
        const ageMs = Date.now() - fileTime
        const ageHours = ageMs / (60 * 60 * 1000)

        if (ageMs < CACHE_TTL_MS) {
          // ── Commit hash check ────────────────────────────────────────
          // If the code has changed since the cached result was generated,
          // invalidate the cache even if TTL is still valid.
          const manifest = readCacheManifest()
          const currentCommit = getCurrentCommitHash()
          const manifestEntry = manifest.entries[type]
          const commitOk = isCommitCacheValid(manifestEntry, currentCommit)

          if (!commitOk) {
            const manifestHash = manifestEntry?.commitHash ?? "none"
            const currentLabel = currentCommit ?? "?"
            console.log(
              `  ℹ  ${cfg.label} — cache invalidado (commit mudou: ${manifestHash} → ${currentLabel})`,
            )
            // Remove the stale entry and fall through to re-run
            delete manifest.entries[type]
            writeCacheManifest(manifest)
          } else {
            const remainingHours = ((CACHE_TTL_MS - ageMs) / (60 * 60 * 1000)).toFixed(1)
            const commitLabel = currentCommit ? ` @ ${currentCommit}` : ""
            console.log(
              `  📦 ${cfg.label} — cached (${ageHours.toFixed(1)}h atrás, expira em ${remainingHours}h${commitLabel})`,
            )

            // If --compare is set, still run comparison against baseline
            if (compareFlag) {
              const baselinePath = benchmarkPath(type, cfg.baseline)
              if (existsSync(baselinePath)) {
                console.log(`\n  ─── Comparing ${type} against baseline (cached result) ─────\n`)
                let compareCmd = `node "${join(SCRIPTS_DIR, "compare-benchmarks.mjs")}"`
                if (cfg.compareFilter) compareCmd += ` --filter ${cfg.compareFilter}`
                compareCmd += ` "${baselinePath}" "${latestPath}"`
                try {
                  execSync(compareCmd, { stdio: "inherit" })
                  return { status: "cached", exitCode: 0, elapsedMs: 0 }
                } catch {
                  console.log(`\n  ⚠  Regression detected in cached ${type} benchmarks.`)
                  return { status: "regression", exitCode: 1, elapsedMs: 0 }
                }
              }
            }

            return { status: "cached", exitCode: 0, elapsedMs: 0 }
          }
        } else {
          console.log(
            `  ℹ  ${cfg.label} — cache expirado (${ageHours.toFixed(1)}h atrás, TTL: ${CACHE_TTL_HOURS}h)`,
          )
        }
      }
    } catch {
      // Invalid/corrupt JSON — re-run anyway
      console.log(`  ℹ  ${cfg.label} — cache inválido, re-executando…`)
    }
  }

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
  } else if (jsonFlag) {
    // Explicit --json without path override → save to latest
    outputFile = benchmarkPath(type, cfg.latest)
  }

  // Build the command
  let cmd = `node "${scriptPath}"`
  if (outputFile) {
    cmd += ` --json "${outputFile}"`
  }

  const startMs = performance.now()

  // Run the benchmark
  console.log(`\n  ─── ${cfg.label} Benchmark ───────────────────────────────────\n`)
  try {
    execSync(cmd, { stdio: "inherit" })
  } catch (_e) {
    return { status: "failed", exitCode: 1, elapsedMs: Math.round(performance.now() - startMs) }
  }

  const elapsedMs = Math.round(performance.now() - startMs)

  // ── Update cache manifest with current commit hash ─────────────────
  // Records which code version generated this result, so future runs
  // can skip the benchmark when neither code nor TTL changed.
  const currentCommit = getCurrentCommitHash()
  if (currentCommit) {
    const manifest = readCacheManifest()
    manifest.entries[type] = {
      commitHash: currentCommit,
      timestamp: new Date().toISOString(),
    }
    writeCacheManifest(manifest)
  }

  // If --compare, run comparison against baseline
  if (compareFlag) {
    const baselinePath = benchmarkPath(type, cfg.baseline)
    const latestPath = benchmarkPath(type, cfg.latest)

    if (!existsSync(baselinePath)) {
      console.log(`  ⚠  No baseline found at ${baselinePath} — skipping comparison.`)
      return { status: "success", exitCode: 0, elapsedMs }
    }
    if (!existsSync(latestPath)) {
      console.log(`  ⚠  No latest results at ${latestPath} — skipping comparison.`)
      return { status: "success", exitCode: 0, elapsedMs }
    }

    console.log(`\n  ─── Comparing ${type} against baseline ─────────────────────\n`)

    let compareCmd = `node "${join(SCRIPTS_DIR, "compare-benchmarks.mjs")}"`
    if (cfg.compareFilter) {
      compareCmd += ` --filter ${cfg.compareFilter}`
    }
    compareCmd += ` "${baselinePath}" "${latestPath}"`

    try {
      execSync(compareCmd, { stdio: "inherit" })
      return { status: "success", exitCode: 0, elapsedMs }
    } catch {
      console.log(`\n  ⚠  Comparison failed — regression detected in ${type} benchmarks.`)
      return { status: "regression", exitCode: 1, elapsedMs }
    }
  }

  return { status: "success", exitCode: 0, elapsedMs }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Summary table printer
// ---------------------------------------------------------------------------

function printSummaryTable(results, isAllMode) {
  const { bgGreen, bgRed, bgYellow, bgBlue, reset } = getTermColors()

  console.log("")
  console.log(`╔══════════════════════════════════════════════════════════════════════╗`)
  console.log(`║               ${bgBlue}Severinno — Benchmarks Summary${reset}               ║`)
  console.log(`╚══════════════════════════════════════════════════════════════════════╝`)
  console.log("")

  console.log(`  ┌─ Type ─────────────┬─ Status ─────┬─ Time ─────┬─ Saved File ────────────┐`)

  let totalPassed = 0
  let totalFailed = 0
  let totalSkipped = 0
  let totalMs = 0

  for (const r of results) {
    const cfg = BENCHMARKS[r.type]
    const label = (cfg?.label ?? r.type).padEnd(18)

    let statusStr, statusColor
    switch (r.status) {
      case "success":
        statusStr = "✅".padEnd(10)
        statusColor = bgGreen
        totalPassed++
        break
      case "cached":
        statusStr = "📦".padEnd(10)
        statusColor = bgBlue
        totalPassed++
        break
      case "skipped":
        statusStr = "⏭".padEnd(10)
        statusColor = bgYellow
        totalSkipped++
        break
      case "regression":
        statusStr = "⚠".padEnd(10)
        statusColor = bgRed
        totalFailed++
        break
      case "failed":
        statusStr = "❌".padEnd(10)
        statusColor = bgRed
        totalFailed++
        break
      default:
        statusStr = "?".padEnd(10)
        statusColor = bgYellow
    }

    const timeStr = r.elapsedMs > 0 ? `${(r.elapsedMs / 1000).toFixed(1)}s`.padStart(8) : "   -"
    totalMs += r.elapsedMs

    // Only show saved file column if any output-saving flag is active
    const showSavedColumn = isAllMode && (jsonFlag || compareFlag || baselineFlag || saveFlag)
    const savedFile = showSavedColumn ? (cfg?.latest ?? "").padEnd(24) : "".padEnd(24)

    console.log(`  │ ${label} │ ${statusColor}${statusStr}${reset} │ ${timeStr} │ ${savedFile} │`)
  }

  console.log(`  ├─${`─`.repeat(20)}┼${`─`.repeat(13)}┼${`─`.repeat(11)}┼${`─`.repeat(26)}┤`)

  const totalLabel = `Total: ${results.length}`.padEnd(18)
  const passedLabel = `${totalPassed} passed`
  const skippedLabel = totalSkipped > 0 ? `, ${totalSkipped} skipped` : ""
  const failedLabel = totalFailed > 0 ? `, ${totalFailed} failed` : ""
  const statusSummary = `${passedLabel}${skippedLabel}${failedLabel}`.padEnd(11)
  const timeSummary = `${(totalMs / 1000).toFixed(1)}s`.padStart(8)

  console.log(`  │ ${totalLabel} │ ${statusSummary} │ ${timeSummary} │${`─`.repeat(26)}│`)
  console.log(`  └${`─`.repeat(20)}┴${`─`.repeat(13)}┴${`─`.repeat(11)}┴${`─`.repeat(26)}┘`)
  console.log("")

  if (totalFailed > 0) {
    console.log(`  ⚠  ${totalFailed} benchmark(s) had regressions or failures.`)
    console.log("")
  }
}

/** Get terminal color codes (no-op if not supported). */
function getTermColors() {
  const noColor = !process.stdout.isTTY || process.env.NO_COLOR
  return {
    bgGreen: noColor ? "" : "\x1b[42m",
    bgRed: noColor ? "" : "\x1b[41m",
    bgYellow: noColor ? "" : "\x1b[43m",
    bgBlue: noColor ? "" : "\x1b[44m",
    reset: noColor ? "" : "\x1b[0m",
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

if (type === "all") {
  const results = []

  for (const t of BENCHMARK_TYPES) {
    const result = runSingle(t)
    results.push({ type: t, ...result })
  }

  // Unified summary table
  printSummaryTable(results, true)

  // Determine exit
  const anyFailure = results.some((r) => r.exitCode !== 0 && r.status !== "skipped")
  process.exit(anyFailure ? 1 : 0)
} else {
  const result = runSingle(type)
  process.exit(result.exitCode ?? 0)
}
