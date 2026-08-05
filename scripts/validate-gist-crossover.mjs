#!/usr/bin/env node

/**
 * validate-gist-crossover.mjs — GiST crossover radius comparison
 *
 * Compares the crossover radii between a baseline and a current GiST
 * benchmark run.  The crossover radius is the smallest search radius at
 * which a GiST DWithin query becomes faster than a full table scan.
 *
 * A "significant" change means the crossover moved by more than 2 steps
 * in the radius list for any density, OR the best GiST/full ratio
 * changed by more than 25 percentage points.
 *
 * Usage:
 *   node scripts/validate-gist-crossover.mjs <baseline.json> <current.json>
 *   node scripts/validate-gist-crossover.mjs --json baseline.json current.json
 *   node scripts/validate-gist-crossover.mjs --threshold 3 baseline.json current.json
 *
 * Flags:
 *   --json          Write structured result as JSON to stdout
 *   --threshold <n> Max allowed radius-step drift (default: 2)
 *   --ratio-drift   Max allowed percentage-point drift for best ratio (default: 25)
 *
 * Exit codes:
 *   0 — crossover stable (no significant changes)
 *   1 — crossover changed significantly (regression)
 *   2 — file read or parse error
 */

import { readFileSync } from "node:fs"

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)

const jsonOutput = args.includes("--json")

const thresholdIndex = args.indexOf("--threshold")
let MAX_STEP_DRIFT = 2
if (
  thresholdIndex !== -1 &&
  args[thresholdIndex + 1] &&
  !args[thresholdIndex + 1].startsWith("--")
) {
  MAX_STEP_DRIFT = parseInt(args[thresholdIndex + 1], 10) || 2
}

const ratioDriftIndex = args.indexOf("--ratio-drift")
let MAX_RATIO_DRIFT = 25
if (
  ratioDriftIndex !== -1 &&
  args[ratioDriftIndex + 1] &&
  !args[ratioDriftIndex + 1].startsWith("--")
) {
  MAX_RATIO_DRIFT = parseInt(args[ratioDriftIndex + 1], 10) || 25
}

// Collect positional args
const positional = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--json" || args[i] === "--threshold" || args[i] === "--ratio-drift") {
    if (args[i] !== "--json") i++ // skip value
    continue
  }
  positional.push(args[i])
}

if (positional.length !== 2) {
  console.error(
    "Usage: node scripts/validate-gist-crossover.mjs [--json] [--threshold <n>] [--ratio-drift <n>] <baseline.json> <current.json>",
  )
  process.exit(2)
}

const [baselinePath, currentPath] = positional

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

function load(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch (err) {
    console.error(`❌ Error loading ${label} (${path}): ${err.message}`)
    process.exit(2)
  }
}

const baseline = load(baselinePath, "baseline")
const current = load(currentPath, "current")

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

if (baseline.meta?.type !== "gist_index_analysis") {
  console.error(
    `❌ Baseline file is not a GiST benchmark result (type: ${baseline.meta?.type ?? "unknown"})`,
  )
  process.exit(2)
}
if (current.meta?.type !== "gist_index_analysis") {
  console.error(
    `❌ Current file is not a GiST benchmark result (type: ${current.meta?.type ?? "unknown"})`,
  )
  process.exit(2)
}

// Extract crossover data
const baselineCrossover = baseline.crossover ?? []
const currentCrossover = current.crossover ?? []

// Ensure radii list is stable across runs
const baselineRadii = baseline.meta?.radiiKm ?? []
const currentRadii = current.meta?.radiiKm ?? []
const densities = baseline.meta?.densities ?? []

if (JSON.stringify(baselineRadii) !== JSON.stringify(currentRadii)) {
  console.warn(
    "⚠  Warning: baseline and current use different radius lists — comparison may be imprecise.",
  )
}

// Build a radius-to-index map for step calculation
function radiusIndexMap(radii) {
  const map = {}
  for (let i = 0; i < radii.length; i++) {
    map[radii[i]] = i
  }
  return map
}

/**
 * Find the nearest radius value in a sorted list.
 * Returns { radius, index } or null if the list is empty.
 */
function nearestRadius(target, radii) {
  if (radii.length === 0) return null
  let best = radii[0],
    bestIdx = 0
  let bestDist = Math.abs(target - best)
  for (let i = 1; i < radii.length; i++) {
    const dist = Math.abs(target - radii[i])
    if (dist < bestDist) {
      bestDist = dist
      best = radii[i]
      bestIdx = i
    }
  }
  return { radius: best, index: bestIdx }
}

const baselineRadiusIndex = radiusIndexMap(baselineRadii)
const currentRadiusIndex = radiusIndexMap(currentRadii)

// ---------------------------------------------------------------------------
// Per-density crossover analysis
// ---------------------------------------------------------------------------

const comparisons = []

for (const density of densities) {
  // Crossover from baseline
  const baselineRows = baselineCrossover.filter((p) => p.providerCount === density)
  const baselineCrossoverRow = baselineRows.find((r) => r.gistFaster)
  const baselineNotFaster = baselineRows.filter((r) => !r.gistFaster)
  const baselineLastNotFaster = baselineNotFaster[baselineNotFaster.length - 1]
  const baselineCrossoverRadius = baselineCrossoverRow?.radiusKm ?? null
  const baselineBestRatio =
    baselineRows.length > 0
      ? baselineRows.reduce((best, r) =>
          r.dWithinUs / r.fullScanUs < best.dWithinUs / best.fullScanUs ? r : best,
        )
      : null

  // Crossover from current
  const currentRows = currentCrossover.filter((p) => p.providerCount === density)
  const currentCrossoverRow = currentRows.find((r) => r.gistFaster)
  const currentNotFaster = currentRows.filter((r) => !r.gistFaster)
  const currentLastNotFaster = currentNotFaster[currentNotFaster.length - 1]
  const currentCrossoverRadius = currentCrossoverRow?.radiusKm ?? null
  const currentBestRatio =
    currentRows.length > 0
      ? currentRows.reduce((best, r) =>
          r.dWithinUs / r.fullScanUs < best.dWithinUs / best.fullScanUs ? r : best,
        )
      : null

  // Compute step drift — with intelligent fallback for divergent radius lists
  let stepDrift = null
  let stepDriftNote = null
  if (baselineCrossoverRadius != null && currentCrossoverRadius != null) {
    const baseIdx = baselineRadiusIndex[baselineCrossoverRadius]
    const currIdx = currentRadiusIndex[currentCrossoverRadius]
    if (baseIdx != null && currIdx != null) {
      stepDrift = Math.abs(currIdx - baseIdx)
    } else {
      // Radii lists diverged — find nearest radius in the other list
      const baseNearest =
        baseIdx == null && baselineRadii.length > 0
          ? nearestRadius(baselineCrossoverRadius, baselineRadii)
          : null
      const currNearest =
        currIdx == null && currentRadii.length > 0
          ? nearestRadius(currentCrossoverRadius, currentRadii)
          : null

      const resolvedBaseIdx = baseIdx ?? baseNearest?.index ?? null
      const resolvedCurrIdx = currIdx ?? currNearest?.index ?? null

      if (resolvedBaseIdx != null && resolvedCurrIdx != null) {
        stepDrift = Math.abs(resolvedCurrIdx - resolvedBaseIdx)
        stepDriftNote = `aproximado (baseline ${baselineCrossoverRadius}km ≈ ${baseNearest?.radius ?? "?"}km, current ${currentCrossoverRadius}km ≈ ${currNearest?.radius ?? "?"}km)`
      }
      // else: both unresolvable — keep stepDrift as null
    }
  }

  // Compute ratio drift (percentage points)
  let ratioDrift = 0
  if (baselineBestRatio && currentBestRatio) {
    const basePct = (baselineBestRatio.dWithinUs / baselineBestRatio.fullScanUs) * 100
    const currPct = (currentBestRatio.dWithinUs / currentBestRatio.fullScanUs) * 100
    ratioDrift = Math.abs(currPct - basePct)
  }

  const significant =
    (stepDrift != null && stepDrift > MAX_STEP_DRIFT) || ratioDrift > MAX_RATIO_DRIFT

  comparisons.push({
    density,
    baseline: {
      crossoverRadius: baselineCrossoverRadius,
      lastNonCrossoverRadius: baselineLastNotFaster?.radiusKm ?? null,
      bestRatioKm: baselineBestRatio?.radiusKm ?? null,
      bestRatioPct: baselineBestRatio
        ? +((baselineBestRatio.dWithinUs / baselineBestRatio.fullScanUs) * 100).toFixed(1)
        : null,
      gistFasterAtAll: baselineCrossoverRow != null,
    },
    current: {
      crossoverRadius: currentCrossoverRadius,
      lastNonCrossoverRadius: currentLastNotFaster?.radiusKm ?? null,
      bestRatioKm: currentBestRatio?.radiusKm ?? null,
      bestRatioPct: currentBestRatio
        ? +((currentBestRatio.dWithinUs / currentBestRatio.fullScanUs) * 100).toFixed(1)
        : null,
      gistFasterAtAll: currentCrossoverRow != null,
    },
    diff: {
      stepDrift,
      stepDriftNote,
      ratioDriftPct: +ratioDrift.toFixed(1),
      crossoverRadiusChanged: baselineCrossoverRadius !== currentCrossoverRadius,
      gistFasterStateChanged: (baselineCrossoverRow != null) !== (currentCrossoverRow != null),
    },
    significant,
  })
}

// ---------------------------------------------------------------------------
// Overall assessment
// ---------------------------------------------------------------------------  const significantChanges = comparisons.filter(c => c.significant)
const alerts = []

for (const comp of comparisons) {
  if (comp.significant) {
    const reasons = []
    if (comp.diff.stepDrift != null && comp.diff.stepDrift > MAX_STEP_DRIFT) {
      let msg = `crossover radius moved ${comp.diff.stepDrift} steps (max: ${MAX_STEP_DRIFT})`
      if (comp.diff.stepDriftNote) msg += ` — ${comp.diff.stepDriftNote}`
      reasons.push(msg)
    } else if (
      comp.diff.stepDrift == null &&
      comp.baseline.crossoverRadius !== comp.current.crossoverRadius
    ) {
      let msg = "crossover radius indeterminate — radius lists diverged between runs"
      if (comp.diff.stepDriftNote) msg += ` (${comp.diff.stepDriftNote})`
      reasons.push(msg)
    }
    if (comp.diff.ratioDriftPct > MAX_RATIO_DRIFT) {
      reasons.push(`best ratio drifted ${comp.diff.ratioDriftPct}pp (max: ${MAX_RATIO_DRIFT}pp)`)
    }
    alerts.push({
      density: comp.density,
      reasons,
      baselineCrossoverRadius: comp.baseline.crossoverRadius,
      currentCrossoverRadius: comp.current.crossoverRadius,
      baselineBestRatio: comp.baseline.bestRatioPct,
      currentBestRatio: comp.current.bestRatioPct,
    })
  }
}

let exitCode = 0
const regressions = significantChanges.length > 0

if (regressions) {
  exitCode = 1
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const result = {
  meta: {
    baselineTimestamp: baseline.meta?.timestamp ?? "?",
    currentTimestamp: current.meta?.timestamp ?? "?",
    baselineRadii: baselineRadii,
    currentRadii: currentRadii,
    densities,
    maxStepDrift: MAX_STEP_DRIFT,
    maxRatioDrift: MAX_RATIO_DRIFT,
  },
  comparisons,
  alerts,
  regressions: regressions,
  exitCode,
}

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2))
  process.exit(exitCode)
}

// ── Pretty print ─────────────────────────────────────────────────────────

console.log("")
console.log("╔══════════════════════════════════════════════════════════════════════╗")
console.log("║           GiST Crossover Validation — Baseline vs Current           ║")
console.log("╚══════════════════════════════════════════════════════════════════════╝")
console.log("")
console.log(`  Baseline:     ${baselinePath}`)
console.log(
  `                ${baseline.meta?.timestamp ?? "?"}  ·  ${baseline.meta?.postgisVersion ?? "?"}`,
)
console.log(`  Current:      ${currentPath}`)
console.log(
  `                ${current.meta?.timestamp ?? "?"}  ·  ${current.meta?.postgisVersion ?? "?"}`,
)
console.log(
  `  Thresholds:   max ${MAX_STEP_DRIFT} step drift  ·  max ${MAX_RATIO_DRIFT}pp ratio drift`,
)
console.log("")

if (comparisons.length === 0) {
  console.log("  ℹ  No density data to compare.")
  console.log("")
  process.exit(0)
}

console.log(
  "  ┌───────────┬───────────────────────┬───────────────────────┬────────────┬────────────┐",
)
console.log(
  "  │ Density   │ Baseline              │ Current               │ Step Drift │ Ratio Drift│",
)
console.log(
  "  │           │ crossover / best %    │ crossover / best %    │            │      pp    │",
)
console.log(
  "  ├───────────┼───────────────────────┼───────────────────────┼────────────┼────────────┤",
)

for (const comp of comparisons) {
  const bCrossover =
    comp.baseline.crossoverRadius != null ? `${comp.baseline.crossoverRadius} km` : "never"
  const bBest = comp.baseline.bestRatioPct != null ? `${comp.baseline.bestRatioPct}%` : "—"
  const cCrossover =
    comp.current.crossoverRadius != null ? `${comp.current.crossoverRadius} km` : "never"
  const cBest = comp.current.bestRatioPct != null ? `${comp.current.bestRatioPct}%` : "—"

  const marker = comp.significant ? "⚠" : " "

  console.log(
    `  │${marker} ${String(comp.density).padStart(7)}   │ ${bCrossover.padStart(7)} / ${String(bBest).padStart(6)} │ ${cCrossover.padStart(7)} / ${String(cBest).padStart(6)} │ ${String(comp.diff.stepDrift).padStart(10)} │ ${String(comp.diff.ratioDriftPct).padStart(10)} │`,
  )
}

console.log(
  "  └───────────┴───────────────────────┴───────────────────────┴────────────┴────────────┘",
)
console.log("")

if (alerts.length > 0) {
  console.log("  ⚠  Significant crossover changes detected:")
  console.log("")
  for (const alert of alerts) {
    console.log(`    ${alert.density.toLocaleString()} providers:`)
    for (const reason of alert.reasons) {
      console.log(`      · ${reason}`)
    }
    console.log(
      `      Baseline: crossover at ${alert.baselineCrossoverRadius ?? "never"} km` +
        `, best ratio ${alert.baselineBestRatio ?? "—"}%`,
    )
    console.log(
      `      Current:  crossover at ${alert.currentCrossoverRadius ?? "never"} km` +
        `, best ratio ${alert.currentBestRatio ?? "—"}%`,
    )
    console.log("")
  }

  console.log("  ─── Recommended actions ────────────────────────────────────")
  console.log("")
  console.log("  The GiST index behaviour changed significantly. Possible causes:")
  console.log("  · PostgreSQL version or configuration changed")
  console.log("  · PostGIS version changed")
  console.log("  · Hardware / CPU differences between CI runs")
  console.log("  · Data distribution changed (spread or density)")
  console.log("")
  console.log("  If the change is expected (e.g., PostGIS update), update the")
  console.log("  baseline by running: node scripts/run-benchmark.mjs --type gist --baseline")
  console.log("")

  if (jsonOutput) {
    process.exit(exitCode)
  }
} else {
  console.log(`  ✅ All ${comparisons.length} densities stable within threshold.`)
  console.log("")
}

process.exit(exitCode)
