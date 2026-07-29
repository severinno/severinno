/**
 * GET /api/admin/benchmarks — Benchmark Monitoring Dashboard
 *
 * Reads all JSON files from docs/benchmarks/, groups by type (geo, cache,
 * gist, real_postgis), identifies baseline vs latest, and computes
 * regression analysis.
 *
 * Response shape:
 * ```json
 * {
 *   "runs": { "geo": [...], "cache": [...] },
 *   "comparisons": [
 *     { "type": "geo", "baseline": {...}, "latest": {...}, "diff": {...}, "regressions": [...] }
 *   ],
 *   "regressionCount": 0,
 *   "lastRun": "2026-07-26T21:01:48.735Z"
 * }
 * ```
 */

import { NextResponse } from "next/server"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkMeta {
  timestamp: string
  type: string
  platform: string
  nodeVersion: string
  centerLabel?: string
  spreadKm?: number
  postgisVersion?: string
  dbms?: string
}

export interface BenchmarkPoint {
  name: string
  label: string
  mean: number
  min: number
  max: number
  median?: number
  p95?: number
  opsPerSec: number
}

export interface BenchmarkFile {
  meta: BenchmarkMeta
  benchmarks: BenchmarkPoint[]
  analysis?: Record<string, unknown>
  analyses?: Array<Record<string, unknown>>
  crossover?: Array<Record<string, unknown>>
  summary?: Record<string, unknown>
}

export interface BenchmarkDiffEntry {
  name: string
  label: string
  status: "unchanged" | "changed" | "regression" | "improvement" | "new" | "removed"
  mean: { baseline: number; current: number; pct: number }
  min: { baseline: number; current: number; pct: number }
  max: { baseline: number; current: number; pct: number }
  opsPerSec: { baseline: number; current: number; pct: number }
}

export interface ComparisonResult {
  type: string
  baselineTimestamp: string
  latestTimestamp: string
  baselineFile: string
  latestFile: string
  diffs: BenchmarkDiffEntry[]
  regressions: BenchmarkDiffEntry[]
  improvements: BenchmarkDiffEntry[]
  totalBenchmarks: number
}

export interface BenchmarksResponse {
  runs: Record<string, BenchmarkFile[]>
  comparisons: ComparisonResult[]
  regressionCount: number
  lastRun: string | null
  summary: {
    totalRuns: number
    totalComparisons: number
    totalRegressions: number
    lastUpdated: string
    benchmarkDir: string
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BENCHMARK_DIR = join(process.cwd(), "docs", "benchmarks")

const THRESHOLD_PCT = 5 // regression threshold in percent

/** Parse a benchmark type from the file name or meta. */
function detectType(file: BenchmarkFile, fileName: string): string {
  if (file.meta?.type) return file.meta.type
  if (fileName.includes("cache")) return "cache"
  if (fileName.includes("gist")) return "gist_index_analysis"
  if (fileName.includes("real")) return "real_postgis"
  if (fileName.includes("baseline") || fileName.includes("benchmark")) return "geo"
  return "unknown"
}

/** Load a JSON benchmark file. */
function loadBenchmark(filePath: string): BenchmarkFile | null {
  try {
    const raw = readFileSync(filePath, "utf-8")
    return JSON.parse(raw) as BenchmarkFile
  } catch {
    return null
  }
}

/**
 * Compute the percentage change between two numbers.
 * Returns a positive % for increases (regressions if mean/ latency),
 * negative % for decreases (improvements).
 */
function pct(a: number, b: number): number {
  if (a === 0) return b === 0 ? 0 : 100
  return +(((b - a) / a) * 100).toFixed(1)
}

/** Compute diff between two benchmark points. */
function diffPoint(
  baseline: BenchmarkPoint | undefined,
  current: BenchmarkPoint | undefined,
): BenchmarkDiffEntry["mean"] | null {
  if (!baseline && !current) return null
  if (!baseline) return { baseline: 0, current: current?.mean ?? 0, pct: 100 }
  if (!current) return { baseline: baseline.mean, current: 0, pct: -100 }
  return {
    baseline: baseline.mean,
    current: current.mean,
    pct: pct(baseline.mean, current.mean),
  }
}

/** Compute full diff entry for one benchmark. */
function diffBenchmark(
  baseline: BenchmarkPoint | undefined,
  current: BenchmarkPoint | undefined,
): BenchmarkDiffEntry | null {
  if (!baseline && !current) return null

  const name = (current ?? baseline)!.name
  const label = (current ?? baseline)!.label

  if (!baseline) {
    return {
      name,
      label,
      status: "new",
      mean: { baseline: 0, current: current!.mean, pct: 100 },
      min: { baseline: 0, current: current!.min, pct: 100 },
      max: { baseline: 0, current: current!.max, pct: 100 },
      opsPerSec: { baseline: 0, current: current!.opsPerSec, pct: 100 },
    }
  }
  if (!current) {
    return {
      name,
      label,
      status: "removed",
      mean: { baseline: baseline.mean, current: 0, pct: -100 },
      min: { baseline: baseline.min, current: 0, pct: -100 },
      max: { baseline: baseline.max, current: 0, pct: -100 },
      opsPerSec: { baseline: baseline.opsPerSec, current: 0, pct: -100 },
    }
  }

  const meanPct = pct(baseline.mean, current.mean)
  const minPct = pct(baseline.min, current.min)
  const maxPct = pct(baseline.max, current.max)
  const opsPct = pct(baseline.opsPerSec, current.opsPerSec)

  let status: BenchmarkDiffEntry["status"] = "unchanged"
  if (Math.abs(meanPct) <= 1) {
    status = "unchanged"
  } else if (meanPct > THRESHOLD_PCT) {
    status = "regression"
  } else if (meanPct < -THRESHOLD_PCT) {
    status = "improvement"
  } else {
    status = "changed"
  }

  return {
    name,
    label,
    status,
    mean: { baseline: baseline.mean, current: current.mean, pct: meanPct },
    min: { baseline: baseline.min, current: current.min, pct: minPct },
    max: { baseline: baseline.max, current: current.max, pct: maxPct },
    opsPerSec: { baseline: baseline.opsPerSec, current: current.opsPerSec, pct: opsPct },
  }
}

/** Compare two benchmark files, matching by label. */
function compareBaselineLatest(
  type: string,
  baseline: BenchmarkFile,
  latest: BenchmarkFile,
  baselineFile: string,
  latestFile: string,
): ComparisonResult {
  const baselineMap = new Map(baseline.benchmarks.map((b) => [b.label, b]))
  const currentMap = new Map(latest.benchmarks.map((b) => [b.label, b]))

  const allLabels = new Set([...baselineMap.keys(), ...currentMap.keys()])

  const diffs: BenchmarkDiffEntry[] = []
  const regressions: BenchmarkDiffEntry[] = []
  const improvements: BenchmarkDiffEntry[] = []

  for (const label of allLabels) {
    const diff = diffBenchmark(baselineMap.get(label), currentMap.get(label))
    if (diff) {
      diffs.push(diff)
      if (diff.status === "regression") regressions.push(diff)
      if (diff.status === "improvement") improvements.push(diff)
    }
  }

  return {
    type,
    baselineTimestamp: baseline.meta?.timestamp ?? "?",
    latestTimestamp: latest.meta?.timestamp ?? "?",
    baselineFile,
    latestFile,
    diffs,
    regressions,
    improvements,
    totalBenchmarks: diffs.length,
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    await requireRole("ADMIN")

    // Read all JSON files from benchmark dir
    let files: string[] = []
    try {
      files = readdirSync(BENCHMARK_DIR).filter((f) => f.endsWith(".json"))
    } catch {
      // Directory may not exist yet
    }

    // Group by type
    const byType: Record<string, BenchmarkFile[]> = {}
    const filePaths: string[] = []

    for (const file of files) {
      const filePath = join(BENCHMARK_DIR, file)
      const data = loadBenchmark(filePath)
      if (!data) continue

      const type = detectType(data, file)
      if (!byType[type]) byType[type] = []
      byType[type].push(data)
      filePaths.push(file)
    }

    // Sort each group by timestamp (oldest first)
    for (const type of Object.keys(byType)) {
      byType[type].sort(
        (a, b) =>
          new Date(a.meta?.timestamp ?? 0).getTime() - new Date(b.meta?.timestamp ?? 0).getTime(),
      )
    }

    // Compute comparisons: first = baseline, last = latest
    const comparisons: ComparisonResult[] = []
    for (const [type, runs] of Object.entries(byType)) {
      if (runs.length < 2) continue

      const baseline = runs[0]
      const latest = runs[runs.length - 1]

      // Find corresponding file names
      const fileNames = files.filter(
        (f) =>
          !f.endsWith("-latest.json") ||
          type ===
            detectType(
              loadBenchmark(join(BENCHMARK_DIR, f)) ?? ({ meta: { type: "" } } as BenchmarkFile),
              f,
            ),
      )
      const baselineFile =
        fileNames.find((f) => f.includes("baseline") || f === "geo-benchmark.json") ?? "?"
      const latestFile =
        fileNames.find(
          (f) => f.includes("latest") || (!f.includes("baseline") && f !== "geo-benchmark.json"),
        ) ?? "?"

      comparisons.push(compareBaselineLatest(type, baseline, latest, baselineFile, latestFile))
    }

    // Find last run timestamp across all files
    let lastRun: string | null = null
    for (const runs of Object.values(byType)) {
      for (const run of runs) {
        const ts = run.meta?.timestamp
        if (ts && (!lastRun || ts > lastRun)) {
          lastRun = ts
        }
      }
    }

    const regressionCount = comparisons.reduce((a, c) => a + c.regressions.length, 0)

    const response: BenchmarksResponse = {
      runs: byType,
      comparisons,
      regressionCount,
      lastRun,
      summary: {
        totalRuns: Object.values(byType).reduce((a, r) => a + r.length, 0),
        totalComparisons: comparisons.length,
        totalRegressions: regressionCount,
        lastUpdated: new Date().toISOString(),
        benchmarkDir: BENCHMARK_DIR,
      },
    }

    return NextResponse.json(response)
  } catch (e) {
    return handleError(e)
  }
}
