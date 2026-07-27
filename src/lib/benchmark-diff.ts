/**
 * benchmark-diff.ts
 *
 * TypeScript barrel for benchmark diff computation functions.
 * Re-exports the pure JS implementation from benchmark-diff.mjs with types.
 *
 * Import via:
 *   import { pct, arrow, computeDiff } from "@/lib/benchmark-diff"
 */

// ---------------------------------------------------------------------------
// Raw benchmark entry from the JSON files
// ---------------------------------------------------------------------------

export interface BenchmarkEntry {
  name: string
  label: string
  mean: number
  min: number
  max: number
  opsPerSec: number
}

export interface BenchmarkMeta {
  cpuItersPerMs?: number
  platform?: string
  arch?: string
  nodeVersion?: string
  timestamp?: string
  [key: string]: unknown
}

export interface BenchmarkAnalysis {
  haversineUnitCosts?: {
    at100?: number
    at1000?: number
    at10000?: number
  }
  avgHaversinePerProvider?: number
  [key: string]: unknown
}

export interface BenchmarkJson {
  meta: BenchmarkMeta
  benchmarks: BenchmarkEntry[]
  analysis?: BenchmarkAnalysis
}

// ---------------------------------------------------------------------------
// Diff result types
// ---------------------------------------------------------------------------

export type DiffStatus = "regression" | "unchanged" | "changed" | "new" | "removed"

export interface MetricDiff {
  baseline: number
  current: number
  pct: number
}

export interface BenchmarkDiffEntry {
  label: string
  name: string
  status: DiffStatus
  mean: MetricDiff
  min: MetricDiff
  max: MetricDiff
  opsPerSec: MetricDiff
}

export interface AnalysisDiff {
  haversineUnitCosts?: {
    at100: MetricDiff
    at1000: MetricDiff
    at10000: MetricDiff
  }
  avgHaversinePerProvider?: MetricDiff
}

export interface DiffResult {
  meta: {
    baseline: BenchmarkMeta
    current: BenchmarkMeta
    elapsedMs: number
  }
  benchmarks: (BenchmarkDiffEntry | { label: string; name: string; status: "new" | "removed" })[]
  regressions: BenchmarkDiffEntry[]
  analysis: AnalysisDiff | null
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DiffOptions {
  threshold?: number
  filterPrefix?: string | null
}

// ---------------------------------------------------------------------------
// Import from .mjs implementation
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-var-requires
const impl = require("./benchmark-diff.mjs") as {
  pct: (a: number, b: number) => number
  arrow: (pctChange: number) => string
  computeDiff: (baseline: BenchmarkJson, current: BenchmarkJson, options?: DiffOptions) => DiffResult
}

export const pct: (a: number, b: number) => number = impl.pct
export const arrow: (pctChange: number) => string = impl.arrow
export const computeDiff: (
  baseline: BenchmarkJson,
  current: BenchmarkJson,
  options?: DiffOptions,
) => DiffResult = impl.computeDiff

export default impl
