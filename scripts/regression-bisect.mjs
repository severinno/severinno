#!/usr/bin/env node

/**
 * regression-bisect.mjs — Git bisect for benchmark regressions
 *
 * Uses `git bisect` to binary-search commits between a known-good (baseline)
 * and known-bad (regression) commit, running the specified benchmark at
 * each step to identify the exact commit that introduced the regression.
 *
 * ==== How it works ====
 *
 *  1. Git-bisect starts at the midpoint between --good and --bad commits.
 *  2. At each step, the script:
 *     a. Checks out the commit (via git bisect)
 *     b. Runs the benchmark (--type)
 *     c. Compares the result against the baseline JSON using computeDiff
 *     d. Marks the commit as "good" (no regression) or "bad" (regression)
 *  3. Git bisect narrows down to the first bad commit (O(log N) steps).
 *  4. The script reports the culprit commit with its diff.
 *
 * ==== Prerequisites ====
 *
 *  - Clean working tree (stash or commit pending changes first).
 *  - The baseline benchmark JSON must exist at the baseline commit.
 *    The script saves it from git at the start.
 *  - Node.js deps must be installable at each bisect step.
 *    The script uses `bun install` at each step if node_modules is stale.
 *
 * Usage:
 *   node scripts/regression-bisect.mjs [options]
 *
 * Options:
 *   --type <geo|cache|search|pipeline>  Benchmark type
 *   --good <sha>                        Known-good commit
 *   --bad <sha>                         Known-bad (regression) commit
 *   --threshold <pct>                   Allowed deviation % (default: 5)
 *   --output <path>                     Report output file
 *   --bisect-run                        Called by git bisect internally
 *
 * Exit code:
 *   0 — culprit found or no regression
 *   1 — bisect failed
 *   2 — invalid arguments
 */

import { execSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { computeDiff } from "../src/lib/benchmark-diff.mjs"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)

// Parse flags
const typeIndex = args.indexOf("--type")
const type =
  typeIndex !== -1 && args[typeIndex + 1] && !args[typeIndex + 1].startsWith("--")
    ? args[typeIndex + 1]
    : null

const goodIndex = args.indexOf("--good")
const goodCommit =
  goodIndex !== -1 && args[goodIndex + 1] && !args[goodIndex + 1].startsWith("--")
    ? args[goodIndex + 1]
    : null

const badIndex = args.indexOf("--bad")
const badCommit =
  badIndex !== -1 && args[badIndex + 1] && !args[badIndex + 1].startsWith("--")
    ? args[badIndex + 1]
    : null

const thresholdIndex = args.indexOf("--threshold")
const THRESHOLD =
  thresholdIndex !== -1 && args[thresholdIndex + 1] && !args[thresholdIndex + 1].startsWith("--")
    ? parseFloat(args[thresholdIndex + 1])
    : 5

const outputIndex = args.indexOf("--output")
const OUTPUT_FILE =
  outputIndex !== -1 && args[outputIndex + 1] && !args[outputIndex + 1].startsWith("--")
    ? args[outputIndex + 1]
    : null

const bisectRunMode = args.includes("--bisect-run")

// Benchmark registry (subset of run-benchmark.mjs)
const BENCHMARKS = {
  geo: {
    script: "geo-benchmark.mjs",
    latest: "geo-latest.json",
    label: "Geo-Distance",
    requiresDb: false,
  },
  cache: {
    script: "cache-benchmark.mjs",
    latest: "cache-latest.json",
    label: "Redis Cache",
    requiresDb: false,
  },
  search: {
    script: "search-benchmark.mjs",
    latest: "search-latest.json",
    label: "Search-Index",
    requiresDb: false,
  },
  pipeline: {
    script: "geo-pipeline-benchmark.mjs",
    latest: "pipeline-latest.json",
    label: "Geo-Pipeline",
    requiresDb: false,
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: "inherit", ...opts })
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: "utf-8" }).toString().trim()
}

function getHeadSha() {
  return runCapture("git rev-parse HEAD")
}

/** Sanitize a git SHA to prevent shell injection. */
function sanitizeSha(sha) {
  if (!sha) return ""
  // Allow full SHA (40 hex), short SHA (7+ hex), or ref names with alphanumeric, ., -, /
  return sha.replace(/[^a-fA-F0-9._/-]/g, "")
}

function getShortSha(sha) {
  const s = sanitizeSha(sha || "HEAD")
  return runCapture(`git rev-parse --short ${s}`)
}

function fileExists(path) {
  return existsSync(path)
}

function getBenchmarkConfig(type) {
  const cfg = BENCHMARKS[type]
  if (!cfg) {
    console.error(
      `❌ Unknown benchmark type "${type}". Available: ${Object.keys(BENCHMARKS).join(", ")}`,
    )
    process.exit(2)
  }
  return cfg
}

// ---------------------------------------------------------------------------
// Bisect-run mode — called by `git bisect run` for each commit
// ---------------------------------------------------------------------------

/**
 * Run the benchmark at the current commit and determine if it's "good" or "bad".
 *
 * Returns 0 for good (no regression), 1 for bad (regression).
 */
function bisectRun() {
  if (!type) {
    console.error("❌ --type is required in bisect-run mode")
    process.exit(2)
  }

  const cfg = getBenchmarkConfig(type)
  const scriptPath = join(SCRIPTS_DIR, cfg.script)

  // Check if the benchmark script exists at this commit
  if (!fileExists(scriptPath)) {
    console.log(`  ⏭  Script ${cfg.script} not found at this commit — treating as good (skip)`)
    return 0
  }

  // Ensure node_modules exist
  if (!fileExists(join(SCRIPTS_DIR, "..", "node_modules"))) {
    console.log("  📦 Installing dependencies...")
    try {
      run("bun install --frozen-lockfile 2>/dev/null || bun install", { stdio: "pipe" })
    } catch {
      console.log("  ⏭  Could not install deps — treating as good (skip)")
      return 0
    }
  }

  // Run the benchmark
  const tmpOut = `/tmp/bisect-${type}-current.json`
  console.log(`\n  ─── Running ${cfg.label} benchmark at ${getShortSha(getHeadSha())} ───\n`)

  try {
    run(`node "${scriptPath}" --json "${tmpOut}"`)
  } catch (e) {
    console.log(`  ❌ Benchmark failed at this commit — treating as bad`)
    return 1
  }

  // Load and compare against baseline
  const baselinePath = `/tmp/bisect-${type}-baseline.json`
  if (!fileExists(baselinePath)) {
    console.log(`  ⚠  No baseline found at ${baselinePath} — saving current as baseline`)
    copyFileSync(tmpOut, baselinePath)
    return 0
  }

  try {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf-8"))
    const current = JSON.parse(readFileSync(tmpOut, "utf-8"))

    const diff = computeDiff(baseline, current, { threshold: THRESHOLD })

    if (diff.regressions.length > 0) {
      console.log(`\n  ❌ BAD — ${diff.regressions.length} regression(s) detected:`)
      for (const r of diff.regressions) {
        console.log(
          `       ${r.name}: ${r.mean.baseline} → ${r.mean.current} µs (${r.mean.pct > 0 ? "+" : ""}${r.mean.pct}%)`,
        )
      }
      return 1
    }

    console.log(
      `\n  ✅ GOOD — all ${diff.benchmarks.length} benchmarks within ${THRESHOLD}% threshold`,
    )
    return 0
  } catch (e) {
    console.log(`  ⚠  Comparison error at this commit — treating as bad: ${e.message}`)
    return 1
  }
}

// ---------------------------------------------------------------------------
// Orchestrator mode — sets up and runs git bisect
// ---------------------------------------------------------------------------

function runBisect() {
  if (!type) {
    console.error("❌ --type is required")
    process.exit(2)
  }

  if (!goodCommit || !badCommit) {
    console.error("❌ Both --good <sha> and --bad <sha> are required")
    process.exit(2)
  }

  // Sanitize SHAs to prevent shell injection
  const good = sanitizeSha(goodCommit)
  const bad = sanitizeSha(badCommit)

  if (!good || !bad) {
    console.error("❌ Invalid git SHA provided")
    process.exit(2)
  }

  const cfg = getBenchmarkConfig(type)

  // ── 1. Record starting state ──────────────────────────────────────

  const startBranch = runCapture("git rev-parse --abbrev-ref HEAD")
  const startSha = getHeadSha()
  const hasStash = runCapture("git status --porcelain").length > 0

  console.log("")
  console.log("╔══════════════════════════════════════════════════════════════════════╗")
  console.log("║          Severinno — Regression Bisect Benchmark                    ║")
  console.log("╚══════════════════════════════════════════════════════════════════════╝")
  console.log("")
  console.log(`  Type:        ${cfg.label} (${type})`)
  console.log(`  Good commit: ${good}  (${getShortSha(good)})`)
  console.log(`  Bad commit:  ${bad}   (${getShortSha(bad)})`)
  console.log(`  Threshold:   ${THRESHOLD}%`)
  console.log(`  Start:       ${startBranch} @ ${getShortSha(startSha)}`)
  console.log("")

  if (hasStash) {
    console.log("  ⚠  Working tree has uncommitted changes. Stashing...")
    run("git stash push -m 'bisect-auto-stash'")
  }

  try {
    // ── 2. Jump to the good commit to capture the baseline benchmark ──

    console.log(`\n  ─── Saving baseline benchmark at ${getShortSha(good)} ───\n`)
    run(`git checkout "${good}" --quiet 2>/dev/null`)

    // Ensure deps
    if (!fileExists(join(SCRIPTS_DIR, "..", "node_modules"))) {
      console.log("  📦 Installing dependencies...")
      run("bun install --frozen-lockfile 2>/dev/null || bun install")
    }

    // Run baseline benchmark
    const baselinePath = `/tmp/bisect-${type}-baseline.json`
    const scriptPath = join(SCRIPTS_DIR, cfg.script)

    if (!fileExists(scriptPath)) {
      console.error(
        `❌ Benchmark script ${cfg.script} not found at good commit ${getShortSha(good)}`,
      )
      run(`git checkout "${startSha}" --quiet 2>/dev/null`)
      if (hasStash) run("git stash pop --quiet 2>/dev/null || true")
      process.exit(1)
    }

    console.log(`  Running baseline ${cfg.label} benchmark...`)
    try {
      run(`node "${scriptPath}" --json "${baselinePath}"`)
      console.log(`  ✅ Baseline saved to ${baselinePath}`)
    } catch (e) {
      console.error(`❌ Baseline benchmark failed at good commit ${getShortSha(good)}`)
      run(`git checkout "${startSha}" --quiet 2>/dev/null`)
      if (hasStash) run("git stash pop --quiet 2>/dev/null || true")
      process.exit(1)
    }

    // ── 3. Run git bisect ────────────────────────────────────────────

    console.log(`\n  ─── Starting git bisect (${cfg.label}) ───\n`)

    // Reset any existing bisect
    run("git bisect reset --quiet 2>/dev/null || true")

    // Start bisect
    runCapture(`git bisect start "${bad}" "${good}" --quiet 2>/dev/null`)

    // Run bisect with this script in --bisect-run mode
    const thisScript = fileURLToPath(import.meta.url)
    let bisectOutput = ""
    try {
      bisectOutput = execSync(
        `git bisect run node "${thisScript}" --type "${type}" --bisect-run`,
        { encoding: "utf-8", timeout: 1_800_000 }, // 30 min max
      ).toString()
    } catch (e) {
      bisectOutput = e.stdout?.toString() ?? e.message
    }

    // ── 4. Parse bisect results ──────────────────────────────────────

    console.log("\n  ─── Bisect output ───\n")
    console.log(bisectOutput)

    // Extract the first bad commit from output
    const firstBadMatch = bisectOutput.match(/([a-f0-9]+)\s+is the first bad commit/i)
    const firstBadSha = firstBadMatch ? firstBadMatch[1] : null

    // Get commit details
    let culpritDetails = ""
    if (firstBadSha) {
      try {
        culpritDetails = execSync(`git log --oneline -1 --stat "${firstBadSha}"`, {
          encoding: "utf-8",
        }).toString()
      } catch {
        /* ignore */
      }
    }

    // ── 5. Build report ──────────────────────────────────────────────

    const result = {
      meta: {
        benchmarkType: type,
        benchmarkLabel: cfg.label,
        goodCommit,
        badCommit,
        firstBadCommit: firstBadSha,
        threshold: THRESHOLD,
        startedAt: startSha,
        startedBranch: startBranch,
        timestamp: new Date().toISOString(),
      },
      summary: firstBadSha
        ? `✅ First bad commit: ${getShortSha(firstBadSha)} (${firstBadSha})`
        : "❌ Could not determine the first bad commit from bisect output",
      culpritDetails: culpritDetails.trim(),
      rawOutput: bisectOutput,
    }

    // Save report
    if (OUTPUT_FILE) {
      mkdirSync(dirname(OUTPUT_FILE), { recursive: true })
      writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2), "utf-8")
      console.log(`\n  📁 Bisect report saved to ${OUTPUT_FILE}`)
    }

    // ── 6. Print summary ─────────────────────────────────────────────

    console.log("")
    console.log("╔══════════════════════════════════════════════════════════════════════╗")
    console.log("║                    Regression Bisect — Results                      ║")
    console.log("╚══════════════════════════════════════════════════════════════════════╝")
    console.log("")

    if (firstBadSha) {
      const short = getShortSha(firstBadSha)
      console.log(`  First bad commit:  ${short}  (${firstBadSha})`)
      console.log("")
      console.log(`  ─── git log -1 ${short} ───`)
      console.log(culpritDetails || "  (no details)")
      console.log("")
      console.log("  Commands to inspect:")
      console.log(`    git show ${short}`)
      console.log(`    git diff ${good}..${short}`)
      console.log(`    git bisect log`)
      console.log("")
    } else {
      console.log("  ❌ Could not determine the first bad commit.")
      console.log("  The bisect may have failed or no regression was detected.")
      console.log("")
      console.log("  Run `git bisect log` to inspect the bisect state.")
      console.log("")
    }

    console.log(`  To return to the starting branch:`)
    console.log(`    git checkout ${startBranch}`)
    if (hasStash) console.log(`    git stash pop`)
    console.log("")

    return firstBadSha ? 0 : 1
  } finally {
    // ── Cleanup: git bisect reset restores original HEAD, then pop stash ──
    try {
      run("git bisect reset --quiet 2>/dev/null || true")
    } catch {
      /* ignore */
    }

    // After bisect reset, verify we're back at the starting commit
    try {
      const actualSha = getHeadSha()
      if (actualSha !== startSha) {
        run(`git checkout "${startSha}" --quiet 2>/dev/null || true`)
      }
    } catch {
      /* ignore */
    }

    if (hasStash) {
      try {
        run("git stash pop --quiet 2>/dev/null || true")
      } catch {
        /* ignore */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

if (bisectRunMode) {
  // Called by `git bisect run` — must use synchronous exit
  const exitCode = bisectRun()
  process.exit(exitCode)
} else {
  // Orchestrator mode
  const exitCode = runBisect()
  process.exit(exitCode ?? 0)
}
