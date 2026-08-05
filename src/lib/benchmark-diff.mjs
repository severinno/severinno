/**
 * benchmark-diff.mjs
 *
 * Pure diff-computation functions extracted from compare-benchmarks.mjs
 * so that unit tests can verify the logic without full JSON input files.
 *
 * Usage (Node ESM):
 *   import { pct, arrow, computeDiff } from "./benchmark-diff.mjs"
 *
 * Re-exported as TypeScript barrel @/lib/benchmark-diff (see benchmark-diff.ts).
 */

// ---------------------------------------------------------------------------
// pct(a, b) — percentage change
// ---------------------------------------------------------------------------

/**
 * Compute the percentage change from `a` to `b`.
 *
 *   pct(100, 110)  →  10    (10 % increase)
 *   pct(100, 90)   → -10    (10 % decrease)
 *   pct(0, 0)      →   0
 *   pct(0, 5)      → Infinity
 */
export function pct(a, b) {
  if (a === 0) return b === 0 ? 0 : Infinity
  return ((b - a) / Math.abs(a)) * 100
}

// ---------------------------------------------------------------------------
// arrow(pctChange) — direction indicator
// ---------------------------------------------------------------------------

/**
 * Return a Unicode arrow character indicating direction of change.
 *
 *   arrow(-5)  → " ↓"   (improvement for latency)
 *   arrow(5)   → " ↑"   (regression for latency)
 *   arrow(0.3) → " →"   (unchanged — below 0.5 % threshold)
 */
export function arrow(pctChange) {
  if (Math.abs(pctChange) < 0.5) return " →"
  return pctChange < 0 ? " ↓" : " ↑"
}

// ---------------------------------------------------------------------------
// computeDiff(baseline, current, options)
// ---------------------------------------------------------------------------

/**
 * `computeDiff(baseline, current, options?)`
 *
 * Pure function: compares two benchmark JSON objects and returns a DiffResult
 * with the computed fields.  Does NOT read from disk, does NOT print anything.
 *
 * @param {object} baseline   — parsed baseline benchmark JSON
 * @param {object} current    — parsed current benchmark JSON
 * @param {object} [options]
 * @param {number} [options.threshold=5]   — regression threshold in percent
 * @param {string} [options.filterPrefix]  — only compare labels starting with this
 * @returns {DiffResult}  { meta, benchmarks, regressions, analysis }
 */
export function computeDiff(baseline, current, options = {}) {
  const { threshold = 5, filterPrefix = null } = options

  const diff = {
    meta: {
      baseline: baseline.meta,
      current: current.meta,
      elapsedMs: 0,
    },
    benchmarks: [],
    analysis: null,
    regressions: [],
  }

  if (current.meta?.timestamp && baseline.meta?.timestamp) {
    diff.meta.elapsedMs =
      new Date(current.meta.timestamp).getTime() - new Date(baseline.meta.timestamp).getTime()
  }

  // Build lookup by label
  const baseMap = new Map(baseline.benchmarks.map((b) => [b.label, b]))
  const currMap = new Map(current.benchmarks.map((b) => [b.label, b]))

  let allLabels = [...new Set([...baseMap.keys(), ...currMap.keys()])].sort()

  // Apply filter prefix match
  if (filterPrefix) {
    allLabels = allLabels.filter((l) => l.startsWith(filterPrefix))
  }

  for (const label of allLabels) {
    const base = baseMap.get(label)
    const curr = currMap.get(label)

    if (!base) {
      diff.benchmarks.push({ label, name: curr?.name ?? label, status: "new" })
      continue
    }
    if (!curr) {
      diff.benchmarks.push({ label, name: base.name ?? label, status: "removed" })
      continue
    }

    const meanPct = pct(base.mean, curr.mean)
    const minPct = pct(base.min, curr.min)
    const maxPct = pct(base.max, curr.max)
    const opsPct = pct(base.opsPerSec, curr.opsPerSec)

    const isRegression = meanPct > threshold

    const entry = {
      label,
      name: curr.name,
      status: isRegression ? "regression" : Math.abs(meanPct) < 1 ? "unchanged" : "changed",
      mean: { baseline: base.mean, current: curr.mean, pct: +meanPct.toFixed(1) },
      min: { baseline: base.min, current: curr.min, pct: +minPct.toFixed(1) },
      max: { baseline: base.max, current: curr.max, pct: +maxPct.toFixed(1) },
      opsPerSec: { baseline: base.opsPerSec, current: curr.opsPerSec, pct: +opsPct.toFixed(1) },
    }

    if (isRegression) diff.regressions.push(entry)
    diff.benchmarks.push(entry)
  }

  // Compare analysis
  if (baseline.analysis && current.analysis) {
    diff.analysis = {
      haversineUnitCosts: {
        at100: {
          baseline: baseline.analysis.haversineUnitCosts?.at100,
          current: current.analysis.haversineUnitCosts?.at100,
          pct: +pct(
            baseline.analysis.haversineUnitCosts?.at100 ?? 0,
            current.analysis.haversineUnitCosts?.at100 ?? 0,
          ).toFixed(1),
        },
        at1000: {
          baseline: baseline.analysis.haversineUnitCosts?.at1000,
          current: current.analysis.haversineUnitCosts?.at1000,
          pct: +pct(
            baseline.analysis.haversineUnitCosts?.at1000 ?? 0,
            current.analysis.haversineUnitCosts?.at1000 ?? 0,
          ).toFixed(1),
        },
        at10000: {
          baseline: baseline.analysis.haversineUnitCosts?.at10000,
          current: current.analysis.haversineUnitCosts?.at10000,
          pct: +pct(
            baseline.analysis.haversineUnitCosts?.at10000 ?? 0,
            current.analysis.haversineUnitCosts?.at10000 ?? 0,
          ).toFixed(1),
        },
      },
      avgHaversinePerProvider: {
        baseline: baseline.analysis.avgHaversinePerProvider,
        current: current.analysis.avgHaversinePerProvider,
        pct: +pct(
          baseline.analysis.avgHaversinePerProvider ?? 0,
          current.analysis.avgHaversinePerProvider ?? 0,
        ).toFixed(1),
      },
    }
  }

  return diff
}

/**
 * @typedef {object} DiffResult
 * @property {object}   meta
 * @property {Array}    benchmarks
 * @property {Array}    regressions
 * @property {object|null} analysis
 */
