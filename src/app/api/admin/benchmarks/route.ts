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
import { execSync } from "node:child_process"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { notifyGeoAlert } from "@/lib/geo-alert-notify"
import { queueEmail } from "@/lib/email-queue"
import { db } from "@/lib/db"
import logger from "@/lib/logger"

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

/**
 * Generic entry extracted from git history — any benchmark JSON file
 * that was committed over time can be tracked.
 */
export interface BenchmarkHistoryEntry {
  /** Commit timestamp from the benchmark file's meta. */
  timestamp: string
  /** Short commit hash where this version was found. */
  commitHash: string
  /** The full benchmark file content at this commit. */
  data: BenchmarkFile
}

export interface GistCrossoverPoint {
  timestamp: string
  commitHash: string
  density: number
  crossoverRadiusKm: number | null
  bestRatioPct: number | null
  gistFaster: boolean
  selectivityPct: number | null
}

export interface CrossoverDriftAlert {
  /** Provider density where drift was detected. */
  density: number
  /** Previous crossover radius in km. */
  previousRadiusKm: number | null
  /** Current crossover radius in km. */
  currentRadiusKm: number | null
  /** Number of radius steps drifted (null if incomparable). */
  stepDrift: number | null
  /** Whether the "gistFaster" state flipped. */
  gistFasterStateChanged: boolean
  /** Commit hash from the previous snapshot. */
  previousCommitHash: string
  /** Commit hash from the current snapshot. */
  currentCommitHash: string
}

export interface BenchmarksResponse {
  runs: Record<string, BenchmarkFile[]>
  comparisons: ComparisonResult[]
  regressionCount: number
  lastRun: string | null
  /** Historical GiST crossover data extracted from git history */
  gistCrossoverHistory: GistCrossoverPoint[]
  /** Alerts when crossover radius drifted >1 step in any density. */
  crossoverDriftAlerts: CrossoverDriftAlert[]
  /** Historical benchmark data for all tracked file types (geo, cache, …). */
  benchmarkHistory: Record<string, BenchmarkHistoryEntry[]>
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

// ── Generic git history extraction ────────────────────────────────────────

interface GitHistoryEntry {
  hash: string
  data: BenchmarkFile
}

/**
 * Extract historical snapshots of a benchmark JSON file from git history.
 *
 * Uses `git log` to find commits that touched `relativePath`, then `git show`
 * to retrieve each version's content.
 *
 * Returns up to `maxSnapshots` entries, sorted chronologically by the
 * benchmark file's own `meta.timestamp` (not the commit timestamp).
 * Returns an empty array when git is not available or the file has no history.
 */
function extractGitHistory(relativePath: string, maxSnapshots = 50): GitHistoryEntry[] {
  try {
    // Get all commit hashes that modified the file
    const logOutput = execSync(`git log --format="%H %ct" -- "${relativePath}"`, {
      encoding: "utf-8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    })
      .trim()
      .split("\n")
      .filter(Boolean)

    const recentCommits = logOutput.slice(0, maxSnapshots)
    const entries: GitHistoryEntry[] = []

    for (const line of recentCommits) {
      const [hash] = line.split(" ")
      if (!hash) continue

      try {
        const content = execSync(`git show "${hash}:${relativePath}"`, {
          encoding: "utf-8",
          timeout: 5000,
          maxBuffer: 1024 * 1024,
        })
        const data = JSON.parse(content) as BenchmarkFile
        entries.push({ hash, data })
      } catch {
        // File may not exist in that commit yet, skip
        continue
      }
    }

    // Sort chronologically by the benchmark file's own timestamp
    entries.sort(
      (a, b) =>
        new Date(a.data.meta?.timestamp ?? 0).getTime() -
        new Date(b.data.meta?.timestamp ?? 0).getTime(),
    )

    return entries
  } catch {
    // git not available or not a git repository
    return []
  }
}

/**
 * Convert git history entries into a flat history array.
 */
function buildBenchmarkHistory(entries: GitHistoryEntry[]): BenchmarkHistoryEntry[] {
  return entries
    .filter((e) => e.data.meta?.timestamp)
    .map(({ hash, data }) => ({
      timestamp: data.meta!.timestamp!,
      commitHash: hash.slice(0, 7),
      data,
    }))
}

// ── File paths to track in git history ───────────────────────────────────

/** Map of benchmark type → file path(s) to extract from git history. */
const HISTORY_FILES: Record<string, string[]> = {
  geo: ["docs/benchmarks/geo-benchmark.json", "docs/benchmarks/geo-baseline.json"],
  cache: ["docs/benchmarks/cache-latest.json"],
}

/**
 * Extract history for all configured benchmark types.
 * Merges history from multiple file paths per type (dedup by commit hash).
 */
function extractAllBenchmarkHistory(): Record<string, BenchmarkHistoryEntry[]> {
  const result: Record<string, BenchmarkHistoryEntry[]> = {}

  for (const [type, paths] of Object.entries(HISTORY_FILES)) {
    const seenHashes = new Set<string>()
    const entries: BenchmarkHistoryEntry[] = []

    for (const filePath of paths) {
      const gitEntries = extractGitHistory(filePath)
      for (const e of gitEntries) {
        if (seenHashes.has(e.hash)) continue
        seenHashes.add(e.hash)
        const history = buildBenchmarkHistory([e])
        entries.push(...history)
      }
    }

    // Sort by timestamp
    entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    if (entries.length > 0) result[type] = entries
  }

  return result
}

// ── Constants for crossover drift detection ──────────────────────────────

/** Max allowed step drift before firing an alert.  User request: >1 step. */
const MAX_CROSSOVER_STEP_DRIFT = 1

/** Debounce tag for crossover drift notifications (15 min cooldown). */
const CROSSOVER_DRIFT_TAG = "crossover-drift"

// ---------------------------------------------------------------------------
// Crossover drift detection
// ---------------------------------------------------------------------------

/**
 * Detect significant changes in the GiST crossover radius between the
 * last two historical snapshots, grouped by density.
 *
 * Returns an alert per density where the crossover moved by more than
 * `MAX_CROSSOVER_STEP_DRIFT` radius steps, or where the gistFaster state
 * flipped (e.g., GiST was faster and no longer is).
 *
 * Requires at least 2 timestamp groups in `history` to compare.
 */
function detectCrossoverDrift(points: GistCrossoverPoint[]): CrossoverDriftAlert[] {
  if (points.length < 2) return []

  // Group points by density
  const byDensity = new Map<number, GistCrossoverPoint[]>()
  for (const p of points) {
    if (!byDensity.has(p.density)) byDensity.set(p.density, [])
    byDensity.get(p.density)!.push(p)
  }

  // Also collect all unique radius values to build an index map
  const allRadii = new Set<number>()
  for (const p of points) {
    if (p.crossoverRadiusKm != null) allRadii.add(p.crossoverRadiusKm)
  }
  const sortedRadii = [...allRadii].sort((a, b) => a - b)
  const radiusIndex = new Map(sortedRadii.map((r, i) => [r, i]))

  const alerts: CrossoverDriftAlert[] = []

  for (const [density, dps] of byDensity) {
    // Sort by timestamp, get last two non-null-radius points
    const sorted = dps.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    )
    if (sorted.length < 2) continue

    const prev = sorted[sorted.length - 2]
    const curr = sorted[sorted.length - 1]

    // If both have null radius, nothing to compare
    if (prev.crossoverRadiusKm == null && curr.crossoverRadiusKm == null) continue

    // Compute step drift
    let stepDrift: number | null = null
    if (prev.crossoverRadiusKm != null && curr.crossoverRadiusKm != null) {
      const prevIdx = radiusIndex.get(prev.crossoverRadiusKm)
      const currIdx = radiusIndex.get(curr.crossoverRadiusKm)
      if (prevIdx != null && currIdx != null) {
        stepDrift = Math.abs(currIdx - prevIdx)
      }
    }

    const gistFasterStateChanged = prev.gistFaster !== curr.gistFaster

    // Alert if drift > threshold OR gistFaster state flipped
    const isDrifted = stepDrift != null && stepDrift > MAX_CROSSOVER_STEP_DRIFT
    if (isDrifted || gistFasterStateChanged) {
      alerts.push({
        density,
        previousRadiusKm: prev.crossoverRadiusKm,
        currentRadiusKm: curr.crossoverRadiusKm,
        stepDrift,
        gistFasterStateChanged,
        previousCommitHash: prev.commitHash,
        currentCommitHash: curr.commitHash,
      })
    }
  }

  return alerts
}

/**
 * Convert git history entries into flat crossover data points.
 */
function buildCrossoverHistory(entries: GitHistoryEntry[]): GistCrossoverPoint[] {
  const points: GistCrossoverPoint[] = []

  for (const { hash, data } of entries) {
    const ts = data.meta?.timestamp
    if (!ts) continue

    const crossover = data.crossover
    if (!Array.isArray(crossover)) continue

    for (const row of crossover) {
      const r = row as Record<string, unknown>
      // Each crossover row has: providerCount, radiusKm, selectivity, gistFaster,
      // dWithinUs, fullScanUs, etc.
      const density = Number(r.providerCount ?? r.density)
      const radiusKm = r.radiusKm != null ? Number(r.radiusKm) : null
      const selectivity = r.selectivity != null ? Number(r.selectivity) * 100 : null
      const gistFaster = r.gistFaster === true

      // Best ratio: find the best GiST/full ratio from this run's analyses
      let bestRatioPct: number | null = null
      if (Array.isArray(data.analyses)) {
        const densityAnalyses = data.analyses.filter(
          (a) =>
            (a as Record<string, unknown>).providerCount === density ||
            (a as Record<string, unknown>).density === density,
        ) as Array<Record<string, unknown>>
        for (const a of densityAnalyses) {
          const dw = Number(a.dWithinUs ?? 0)
          const fs = Number(a.fullScanUs ?? 0)
          if (dw > 0 && fs > 0) {
            const ratio = (dw / fs) * 100
            if (bestRatioPct == null || ratio < bestRatioPct) {
              bestRatioPct = +ratio.toFixed(1)
            }
          }
        }
      }

      points.push({
        timestamp: ts,
        commitHash: hash.slice(0, 7),
        density: isFinite(density) ? density : 0,
        crossoverRadiusKm: radiusKm,
        bestRatioPct,
        gistFaster,
        selectivityPct:
          selectivity != null && isFinite(selectivity) ? +selectivity.toFixed(1) : null,
      })
    }
  }

  return points
}

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
function _diffPoint(
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

    // ── Send push notification to admins on new regressions ───────────
    if (regressionCount > 0) {
      const worstRegressions = comparisons
        .flatMap((c) => c.regressions)
        .sort((a, b) => Math.abs(b.mean.pct) - Math.abs(a.mean.pct))
        .slice(0, 3)

      const summaryLines = worstRegressions.map(
        (r) =>
          `• ${r.name}: +${r.mean.pct.toFixed(1)}% (${r.mean.baseline.toFixed(0)} → ${r.mean.current.toFixed(0)}µs)`,
      )

      // Debounce via tag — only sends once per 15 min when regression count is stable
      notifyGeoAlert({
        title: `${regressionCount} regressão(ões) detectada(s) nos benchmarks`,
        body: [
          `${regressionCount} benchmark(s) acima do limiar de 5% nas últimas comparações.`,
          ...summaryLines,
          "",
          "Revise as alterações recentes na camada de geolocalização.",
        ].join("\n"),
        severity: regressionCount > 5 ? "error" : "warning",
        url: "/admin/benchmarks",
        tag: `benchmark-regression:${comparisons
          .map((c) => c.type)
          .sort()
          .join(":")}`,
        source: "benchmarks-api",
        context: {
          regressionCount,
          affectedTypes: comparisons.filter((c) => c.regressions.length > 0).map((c) => c.type),
          worstRegressions: worstRegressions.map((r) => ({
            name: r.name,
            type: r.label,
            pct: r.mean.pct,
            baseline: r.mean.baseline,
            current: r.mean.current,
          })),
          totalComparisons: comparisons.length,
        },
      }).catch(() => {})
    }

    // ── Extract GiST crossover history from git ──────────────────────
    const gistHistoryEntries = extractGitHistory("docs/benchmarks/geo-gist-baseline.json")
    const gistCrossoverHistory = buildCrossoverHistory(gistHistoryEntries)

    // ── Extract generic benchmark history (geo, cache, …) ────────────
    const benchmarkHistory = extractAllBenchmarkHistory()

    // ── Detect crossover drift ──────────────────────────────────────
    const crossoverDriftAlerts = detectCrossoverDrift(gistCrossoverHistory)

    // ── Dispatch alerts on significant drift ─────────────────────────
    if (crossoverDriftAlerts.length > 0) {
      const details = crossoverDriftAlerts
        .map(
          (a) =>
            `• ${a.density.toLocaleString()} prov: ` +
            `${a.previousRadiusKm ?? "?"} km → ${a.currentRadiusKm ?? "?"} km` +
            (a.stepDrift != null ? ` (${a.stepDrift} step(s))` : "") +
            (a.gistFasterStateChanged ? " [gistFaster mudou!]" : ""),
        )
        .join("\n")

      const title = `${crossoverDriftAlerts.length} alteração(ões) no crossover GiST`
      const body = [
        `O raio de crossover GiST mudou em ${crossoverDriftAlerts.length} densidade(s):`,
        "",
        details,
        "",
        "Isso pode indicar mudança no índice GiST, versão do PostGIS ou hardware.",
        "Revise o dashboard de benchmarks para mais detalhes.",
      ].join("\n")

      // Sentry + Push + Slack via notifyGeoAlert
      notifyGeoAlert({
        title,
        body,
        severity: "warning",
        url: "/admin/benchmarks",
        tag: CROSSOVER_DRIFT_TAG,
        source: "benchmarks-api",
        context: {
          driftCount: crossoverDriftAlerts.length,
          drifts: crossoverDriftAlerts.map((a) => ({
            density: a.density,
            previousRadiusKm: a.previousRadiusKm,
            currentRadiusKm: a.currentRadiusKm,
            stepDrift: a.stepDrift,
            gistFasterStateChanged: a.gistFasterStateChanged,
            previousCommit: a.previousCommitHash,
            currentCommit: a.currentCommitHash,
          })),
        },
      }).catch(() => {})

      // Email to admins via queue — fetch ALL admin emails from DB
      const adminEmails = await db.user
        .findMany({ where: { role: "ADMIN" }, select: { email: true } })
        .then((users) => users.map((u) => u.email))
        .catch(() => ["admin@severinno.com.br"])
      const emailTo =
        adminEmails.length > 0 ? [...new Set(adminEmails)].join(",") : "admin@severinno.com.br"

      queueEmail({
        to: emailTo,
        subject: `[Severinno] ${title}`,
        html: [
          `<h2>⚠️ ${title}</h2>`,
          `<p>O raio de crossover GiST mudou significativamente nas últimas execuções de benchmark.</p>`,
          `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px">`,
          `<tr style="background:#f5f5f5"><th>Densidade</th><th>Anterior</th><th>Atual</th><th>Steps</th><th>Estado GiST</th></tr>`,
          ...crossoverDriftAlerts.map(
            (a) =>
              `<tr>` +
              `<td>${a.density.toLocaleString()} prov</td>` +
              `<td>${a.previousRadiusKm ?? "?"} km</td>` +
              `<td>${a.currentRadiusKm ?? "?"} km</td>` +
              `<td>${a.stepDrift != null ? String(a.stepDrift) : "—"}</td>` +
              `<td>${a.gistFasterStateChanged ? "⚠️ Mudou" : "Estável"}</td>` +
              `</tr>`,
          ),
          `</table>`,
          `<p><a href="${process.env.NEXT_PUBLIC_APP_URL || "https://severinno.com.br"}/admin/benchmarks">Ver dashboard</a></p>`,
          `<hr><p style="color:#888;font-size:12px">Gerado automaticamente pelo sistema de monitoramento de benchmarks.</p>`,
        ].join("\n"),
      }).catch((err) => {
        logger.error({ err }, "Failed to queue crossover drift email")
      })
    }

    const response: BenchmarksResponse = {
      runs: byType,
      comparisons,
      regressionCount,
      lastRun,
      gistCrossoverHistory,
      crossoverDriftAlerts,
      benchmarkHistory,
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
