/**
 * benchmark-data.ts
 *
 * Pure data transformation functions for the Benchmark comparison charts
 * (BenchmarkSection in admin-geo-metrics-dashboard.tsx).
 *
 * Extracted from the BenchmarkSection component to make the data pipeline
 * independently testable, following the same pattern as geo-benchmark-model.ts.
 *
 * Covers:
 *   - buildBenchmarkBarData  → transforms benchmark comparisons into chart data
 *   - getMaxPostgisLatency   → computes the max PostGIS latency for axis scaling
 *   - ratioColor             → maps PostGIS/Haversine ratio to a color threshold
 *   - CSV / PDF report generation
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkComparison {
  label: string
  scale: number
  haversine: { mean: number; opsPerSec: number }
  postgis: { mean: number; opsPerSec: number }
  ratio: number
}

export interface BenchmarkBarItem {
  label: string
  scale: number
  haversine: number
  postgis: number
  haversine_ops: number
  postgis_ops: number
  ratio: number
}

export interface BenchmarkMeta {
  platform: string
  nodeVersion: string
  centerLabel: string
  timestamp: string
}

export interface BenchmarkAnalysis {
  note: string
  avgHaversinePerProvider: number
}

export interface BenchmarkData {
  comparisons: BenchmarkComparison[]
  analysis: BenchmarkAnalysis
  meta: BenchmarkMeta
}

// ---------------------------------------------------------------------------
// Color palette constants (mirrors the component's COLOR_P50/P95/P99)
// ---------------------------------------------------------------------------

export const RATIO_COLOR_FAST = "hsl(160, 84%, 39%)" // PostGIS is ~same speed
export const RATIO_COLOR_WARN = "hsl(38, 92%, 50%)" // ratio between 10–50×
export const RATIO_COLOR_SLOW = "hsl(0, 72%, 51%)" // ratio > 50× (PostGIS much slower)

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Transform raw benchmark comparisons into chart-ready bar data.
 *
 * Each comparison becomes a BenchmarkBarItem with:
 *   - haversine / postgis: mean latency in µs
 *   - haversine_ops / postgis_ops: throughput in ops/sec
 *   - ratio: PostGIS mean ÷ Haversine mean
 */
export function buildBenchmarkBarData(benchmark: BenchmarkData): BenchmarkBarItem[] {
  return benchmark.comparisons.map((c) => ({
    label: c.label,
    scale: c.scale,
    haversine: c.haversine.mean,
    postgis: c.postgis.mean,
    haversine_ops: c.haversine.opsPerSec,
    postgis_ops: c.postgis.opsPerSec,
    ratio: c.ratio,
  }))
}

/**
 * Compute the maximum PostGIS mean latency across all comparisons.
 * Used to set the X-axis domain for the latency chart.
 * Returns 0 when data is empty.
 */
export function getMaxPostgisLatency(barData: BenchmarkBarItem[]): number {
  if (barData.length === 0) return 0
  return Math.max(...barData.map((d) => d.postgis))
}

/**
 * Map the PostGIS/Haversine ratio to a color for the ratio bar chart cells.
 *
 * Thresholds:
 *   - ≤ 10×   → green  (PostGIS competitive)
 *   - 10–50×  → amber (PostGIS noticeably slower)
 *   - > 50×   → red    (PostGIS dramatically slower — full-scan regime)
 */
export function ratioColor(ratio: number): string {
  if (ratio > 50) return RATIO_COLOR_SLOW
  if (ratio > 10) return RATIO_COLOR_WARN
  return RATIO_COLOR_FAST
}

// ── Benchmark Dashboard types (extracted from admin-benchmark-dashboard.tsx) ──

export type BenchmarkRun = {
  meta?: {
    timestamp?: string
    platform?: string
    nodeVersion?: string
  }
  benchmarks: Array<{ label: string; mean: number; opsPerSec: number; p95?: number }>
}

export type RunsMap = Record<string, BenchmarkRun[]>

// ── Benchmark type labels (shared between dashboard and data functions) ────

export const BENCHMARK_TYPE_LABELS: Record<string, string> = {
  geo: "Modelo CPU (Haversine + PostGIS)",
  cache: "Cache Performance",
  gist_index_analysis: "GiST Index Analysis",
  real_postgis: "PostGIS Real (DB)",
}

// ---------------------------------------------------------------------------
// Trend data builder (per-type aggregated)
// ---------------------------------------------------------------------------

/**
 * buildTrendData — Aggregate benchmark runs by date, using the first
 * benchmark"s mean/ops/p95 as the representative value per type.
 *
 * Returns sorted chart-ready rows usable by Recharts LineChart.
 */
export function buildTrendData(runs: RunsMap): Array<Record<string, number | string>> {
  interface TrendEntry {
    date: string
    timestamp: number
    type: string
    mean: number
    ops: number
    p95: number
  }

  const allEntries: TrendEntry[] = []

  for (const [type, typeRuns] of Object.entries(runs)) {
    for (const run of typeRuns) {
      const ts = run.meta?.timestamp
      if (!ts) continue

      const firstBench = run.benchmarks[0]
      if (!firstBench) continue

      const d = new Date(ts)
      allEntries.push({
        date: d.toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }),
        timestamp: d.getTime(),
        type,
        mean: firstBench.mean,
        ops: firstBench.opsPerSec,
        p95: firstBench.p95 ?? firstBench.mean,
      })
    }
  }

  allEntries.sort((a, b) => a.timestamp - b.timestamp)

  const grouped = new Map<
    string,
    { types: Record<string, { mean: number; ops: number; p95: number }>; ts: number }
  >()
  for (const entry of allEntries) {
    if (!grouped.has(entry.date)) {
      grouped.set(entry.date, { types: {}, ts: entry.timestamp })
    }
    const group = grouped.get(entry.date)!
    group.types[entry.type] = { mean: entry.mean, ops: entry.ops, p95: entry.p95 }
  }

  return [...grouped.entries()]
    .sort(([, a], [, b]) => a.ts - b.ts)
    .map(([date, { types }]) => {
      const row: Record<string, number | string> = { date }
      for (const [type, vals] of Object.entries(types)) {
        row[type] = vals.mean
        row[`${type}_ops`] = vals.ops
        row[`${type}_p95`] = vals.p95
      }
      return row
    })
}

// ---------------------------------------------------------------------------
// Per-benchmark temporal trend builder
// ---------------------------------------------------------------------------

/**
 * buildPerBenchTrend — Group individual benchmarks by date, preserving
 * per-benchmark granularity (type::label as key). Respects date filter
 * and selected type filter.
 */
export function buildPerBenchTrend(
  allRuns: RunsMap,
  filterFn: (ts: string | undefined) => boolean,
  selectedTypes: Set<string>,
): Array<Record<string, number | string>> {
  const dateMap = new Map<
    string,
    { ts: number; vals: Record<string, { mean: number; ops: number; p95: number }> }
  >()

  for (const [type, typeRuns] of Object.entries(allRuns)) {
    if (!selectedTypes.has(type)) continue

    for (const run of typeRuns) {
      const ts = run.meta?.timestamp
      if (!ts || !filterFn(ts)) continue

      const d = new Date(ts)
      const dateKey = d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })

      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, { ts: d.getTime(), vals: {} })
      }
      const group = dateMap.get(dateKey)!

      for (const bench of run.benchmarks) {
        const key = `${type}::${bench.label}`
        if (!group.vals[key] || group.vals[key].mean === 0) {
          group.vals[key] = {
            mean: bench.mean,
            ops: bench.opsPerSec,
            p95: bench.p95 ?? bench.mean,
          }
        }
      }
    }
  }

  return [...dateMap.entries()]
    .sort(([, a], [, b]) => a.ts - b.ts)
    .map(([date, { vals }]) => {
      const row: Record<string, number | string> = { date }
      for (const [key, v] of Object.entries(vals)) {
        row[`${key}_mean`] = v.mean
        row[`${key}_ops`] = v.ops
        row[`${key}_p95`] = v.p95
      }
      return row
    })
}

/**
 * perBenchLines — Build line configs (dataKey, name, color) for the
 * per-benchmark chart from the trend data. Returns up to 15 lines.
 */
export function perBenchLines(
  data: Array<Record<string, number | string>>,
  metric: "mean" | "ops" | "p95",
): Array<{ dataKey: string; name: string; color: string }> {
  if (data.length === 0) return []

  const suffix = metric === "mean" ? "_mean" : metric === "ops" ? "_ops" : "_p95"
  const keys = Object.keys(data[0]).filter((k) => k.endsWith(suffix) && k !== "date")

  const TYPE_PALETTE = [
    "hsl(201, 90%, 48%)",
    "hsl(38, 92%, 50%)",
    "hsl(160, 84%, 39%)",
    "hsl(0, 72%, 51%)",
    "hsl(270, 76%, 53%)",
    "hsl(340, 82%, 52%)",
    "hsl(180, 80%, 40%)",
    "hsl(30, 90%, 55%)",
  ]

  return keys.map((dataKey, idx) => {
    const [type, label] = dataKey.replace(suffix, "").split("::")
    const prettyName = label
      ? `${BENCHMARK_TYPE_LABELS[type] ?? type}: ${label.replace(/_/g, " ")}`
      : (BENCHMARK_TYPE_LABELS[type] ?? type)

    return {
      dataKey,
      name: prettyName,
      color: TYPE_PALETTE[idx % TYPE_PALETTE.length],
    }
  })
}

// ---------------------------------------------------------------------------
// CSV / PDF Report Generation (for BenchmarkSection export)
// ---------------------------------------------------------------------------

/** Escape a CSV field — wraps in double quotes and escapes internal quotes. */
function escapeCsvField(value: string | number): string {
  const str = String(value)
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Generate a CSV string from benchmark data.
 * Each row: label, Haversine mean, PostGIS mean, ratio, ops/sec.
 */
export function generateBenchmarkCsv(benchmark: BenchmarkData): string {
  const headers = [
    "Benchmark",
    "Haversine (us)",
    "PostGIS (us)",
    "Razao (PG/Hav)",
    "Haversine (ops/s)",
    "PostGIS (ops/s)",
  ]
  const rows = benchmark.comparisons.map((c) => [
    c.label,
    c.haversine.mean.toFixed(2),
    c.postgis.mean.toFixed(2),
    c.ratio.toFixed(2),
    c.haversine.opsPerSec.toFixed(0),
    c.postgis.opsPerSec.toFixed(0),
  ])

  const csvContent = [
    `# Benchmark Report — ${benchmark.meta.timestamp}`,
    `# Platform: ${benchmark.meta.platform} · Node: ${benchmark.meta.nodeVersion}`,
    `# Center: ${benchmark.meta.centerLabel}`,
    `# ${benchmark.analysis.note}`,
    "",
    headers.map(escapeCsvField).join(","),
    ...rows.map((r) => r.map(escapeCsvField).join(",")),
  ].join("\n")

  return csvContent
}

/**
 * Generate an HTML report string suitable for printing / "Save as PDF".
 */
export function generateBenchmarkHtmlReport(benchmark: BenchmarkData): string {
  const barRows = benchmark.comparisons
    .map((c) => {
      const cls = c.ratio <= 10 ? "green" : c.ratio <= 50 ? "amber" : "red"
      const faster = c.ratio <= 1 ? "Haversine" : "PostGIS"
      return [
        "<tr>",
        `  <td>${c.label}</td>`,
        `  <td class="num">${c.haversine.mean.toFixed(2)}</td>`,
        `  <td class="num">${c.postgis.mean.toFixed(2)}</td>`,
        `  <td class="num ${cls}">${c.ratio.toFixed(2)}x</td>`,
        `  <td class="num">${c.haversine.opsPerSec.toFixed(0)}</td>`,
        `  <td class="num">${c.postgis.opsPerSec.toFixed(0)}</td>`,
        `  <td class="num">${faster}</td>`,
        "</tr>",
      ].join("\n")
    })
    .join("\n")

  return [
    "<!DOCTYPE html>",
    '<html lang="pt-BR">',
    "<head>",
    '  <meta charset="UTF-8">',
    "  <style>",
    "    * { margin:0; padding:0; box-sizing:border-box; }",
    "    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; padding:40px; color:#1a1c1e; }",
    "    h1 { font-size:20px; margin-bottom:4px; }",
    "    .meta { color:#666; font-size:12px; margin-bottom:20px; }",
    "    table { width:100%; border-collapse:collapse; font-size:13px; }",
    "    th { text-align:left; padding:8px 10px; border-bottom:2px solid #ddd; font-weight:600; color:#444; }",
    "    th.num, td.num { text-align:right; }",
    "    td { padding:6px 10px; border-bottom:1px solid #eee; }",
    "    .green { color:#16a34a; font-weight:600; }",
    "    .amber { color:#d97706; font-weight:600; }",
    "    .red { color:#dc2626; font-weight:600; }",
    "    .analysis { margin-top:16px; padding:12px; background:#f5f5f5; border-radius:8px; font-size:12px; }",
    "    .footer { margin-top:20px; font-size:10px; color:#999; }",
    "  </style>",
    "</head>",
    "<body>",
    `  <h1>Benchmark — Haversine JS vs PostGIS</h1>`,
    `  <p class="meta">${new Date(benchmark.meta.timestamp).toLocaleString("pt-BR")} · ${benchmark.meta.platform} · Node ${benchmark.meta.nodeVersion} · Centro: ${benchmark.meta.centerLabel}</p>`,
    "  <table>",
    "    <thead>",
    "      <tr>",
    "        <th>Benchmark</th>",
    '        <th class="num">Haversine (us)</th>',
    '        <th class="num">PostGIS (us)</th>',
    '        <th class="num">Razao</th>',
    '        <th class="num">Haversine (ops/s)</th>',
    '        <th class="num">PostGIS (ops/s)</th>',
    '        <th class="num">Mais rapido</th>',
    "      </tr>",
    "    </thead>",
    "    <tbody>",
    `      ${barRows}`,
    "    </tbody>",
    "  </table>",
    '  <div class="analysis">',
    `    <strong>Analise:</strong> ${benchmark.analysis.note}<br>`,
    `    Haversine medio por provider: ${benchmark.analysis.avgHaversinePerProvider.toFixed(4)} us`,
    "  </div>",
    `  <p class="footer">Gerado por Severinno · ${new Date().toISOString().slice(0, 10)}</p>`,
    "</body>",
    "</html>",
  ].join("\n")
}

/**
 * Trigger a file download in the browser.
 */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Open the HTML report in a new tab and trigger the print dialog
 * (which allows the user to "Save as PDF").
 * Falls back to a console message if the popup is blocked.
 */
export function printBenchmarkReport(benchmark: BenchmarkData): void {
  const html = generateBenchmarkHtmlReport(benchmark)
  const win = window.open("", "_blank")
  if (!win) {
    console.warn(
      "[benchmark-data] Popup bloqueado — permita popups para exportar PDF. " +
        "Alternativamente, copie o CSV baixado para um relatório.",
    )
    return
  }
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => {
    win.print()
  }, 300)
}

/**
 * Single entry-point: downloads CSV + opens printable report.
 */
export function exportBenchmarkReport(benchmark: BenchmarkData): void {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:]/g, "-")
  const csv = generateBenchmarkCsv(benchmark)
  downloadFile(csv, `benchmark-${ts}.csv`, "text/csv;charset=utf-8")
  setTimeout(() => {
    printBenchmarkReport(benchmark)
  }, 500)
}
