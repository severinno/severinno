#!/usr/bin/env npx tsx
/**
 * Coverage History Tracker
 *
 * Maintains weekly snapshots of API route coverage in
 * docs/coverage-history.json and generates an SVG line chart
 * showing the evolution over time.
 *
 * Usage:
 *   npx tsx scripts/coverage-history.ts                    # snapshot + print SVG
 *   npx tsx scripts/coverage-history.ts --save             # snapshot + save SVG
 *   npx tsx scripts/coverage-history.ts --snapshot-only    # snapshot only
 *   npx tsx scripts/coverage-history.ts --chart-only       # chart from existing data
 *   npx tsx scripts/coverage-history.ts --chart-only --save  # save chart without snapshot
 *
 * Integrates with CI: add `npx tsx scripts/coverage-history.ts --save`
 * after coverage-badge to automatically track weekly coverage evolution.
 */

import { execSync } from "child_process"
import { join } from "path"
import { readFileSync, writeFileSync, existsSync } from "fs"

// ── Types ──────────────────────────────────────────────────────────────────

interface CoverageSnapshot {
  date: string // ISO date (YYYY-MM-DD)
  pct: number
  covered: number
  total: number
  excluded: number
  denominator: number
}

interface CoverageData {
  totalRoutes: number
  covered: number
  gaps: number
  excluded: number
  coveragePct: number
}

// ── Paths ──────────────────────────────────────────────────────────────────

const HISTORY_FILE = join(__dirname, "..", "docs", "coverage-history.json")
const CHART_FILE = join(__dirname, "..", "docs", "coverage-history.svg")

// ── Snapshot management ────────────────────────────────────────────────────

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function loadHistory(): CoverageSnapshot[] {
  if (!existsSync(HISTORY_FILE)) return []
  try {
    const raw = readFileSync(HISTORY_FILE, "utf-8")
    return JSON.parse(raw)
  } catch {
    console.warn("Warning: could not parse coverage history, starting fresh")
    return []
  }
}

function saveHistory(history: CoverageSnapshot[]): void {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date))
  writeFileSync(HISTORY_FILE, JSON.stringify(sorted, null, 2) + "\n", "utf-8")
}

function shouldTakeSnapshot(history: CoverageSnapshot[]): boolean {
  if (history.length === 0) return true
  const last = history[history.length - 1]
  const lastDate = new Date(last.date).getTime()
  return Date.now() - lastDate >= WEEK_MS
}

function takeSnapshot(data: CoverageData): CoverageSnapshot {
  const pct = data.coveragePct
  const { covered, totalRoutes: total, excluded = 0 } = data
  const denominator = total - excluded
  const today = new Date().toISOString().split("T")[0]

  return { date: today, pct, covered, total, excluded, denominator }
}

function computeCoverage(): CoverageData {
  const scriptPath = join(__dirname, "coverage-gaps.ts")
  const output = execSync(`npx tsx "${scriptPath}" --json`, {
    encoding: "utf-8",
    timeout: 30_000,
  })
  return JSON.parse(output)
}

// ── SVG chart generator ────────────────────────────────────────────────────

const CHART_WIDTH = 600
const CHART_HEIGHT = 280
const PAD_TOP = 30
const PAD_RIGHT = 30
const PAD_BOTTOM = 50
const PAD_LEFT = 55
const PLOT_WIDTH = CHART_WIDTH - PAD_LEFT - PAD_RIGHT // 515
const PLOT_HEIGHT = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM // 200
const Y_TICKS = [0, 25, 50, 75, 100]

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00")
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ]
  return `${months[d.getMonth()]} ${d.getDate()}`
}

function generateChart(history: CoverageSnapshot[]): string {
  if (history.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="Coverage history: no data">
  <rect width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="#f8f9fa" rx="6"/>
  <text x="${CHART_WIDTH / 2}" y="${CHART_HEIGHT / 2}" text-anchor="middle" fill="#868e96" font-family="DejaVu Sans,Verdana,sans-serif" font-size="14">No coverage history yet</text>
</svg>`
  }

  const latestPct = history[history.length - 1].pct
  const lineColor = latestPct >= 80 ? "#2ea44f" : latestPct >= 50 ? "#bfa100" : "#cb2431"
  const gridColor = "#e9ecef"
  const textColor = "#868e96"
  const axisColor = "#adb5bd"

  // Map percentage (0..100) to Y pixel (bottom..top)
  const yPos = (pct: number): number => PAD_TOP + PLOT_HEIGHT - (pct / 100) * PLOT_HEIGHT

  // Spread points evenly along the X-axis
  const xPos = (index: number): number => {
    if (history.length === 1) return PAD_LEFT + PLOT_WIDTH / 2
    return PAD_LEFT + (index / (history.length - 1)) * PLOT_WIDTH
  }

  // Build data points
  const points = history.map((h, i) => ({
    x: xPos(i),
    y: yPos(h.pct),
    date: formatDate(h.date),
    pct: h.pct,
    covered: h.covered,
    denominator: h.denominator,
  }))

  // Polyline coordinates
  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ")

  // Area fill polygon
  let areaFill = ""
  if (points.length >= 2) {
    const bottomY = PAD_TOP + PLOT_HEIGHT
    const firstX = points[0].x
    const lastX = points[points.length - 1].x
    const areaPoints = points.map((p) => `${p.x},${p.y}`).join(" ")
    areaFill = `
    <polygon fill="url(#areaGrad)" points="${firstX},${bottomY} ${areaPoints} ${lastX},${bottomY}"/>`
  }

  // Data dots with tooltips
  const dotGroups = points
    .map(
      (p) => `    <g>
      <circle cx="${p.x}" cy="${p.y}" r="4" fill="${lineColor}" stroke="#fff" stroke-width="2"/>
      <title>${p.date}: ${p.pct}% (${p.covered}/${p.denominator})</title>
    </g>`,
    )
    .join("\n")

  // X-axis date labels — skip every Nth label when there are many points
  // to avoid overlapping text
  const xLabelStep = history.length > 15 ? 3 : history.length > 8 ? 2 : 1
  const xLabels = points
    .filter((_, i) => i % xLabelStep === 0)
    .map(
      (p) =>
        `    <text x="${p.x}" y="${CHART_HEIGHT - 12}" text-anchor="middle" fill="${textColor}" font-family="DejaVu Sans,Verdana,sans-serif" font-size="11">${p.date}</text>`,
    )
    .join("\n")

  // Grid lines + Y-axis labels
  const yGrid = Y_TICKS.map((tick) => {
    const y = yPos(tick)
    return `  <line x1="${PAD_LEFT}" y1="${y}" x2="${CHART_WIDTH - PAD_RIGHT}" y2="${y}" stroke="${gridColor}" stroke-width="1"/>
  <text x="${PAD_LEFT - 8}" y="${y + 4}" text-anchor="end" fill="${textColor}" font-family="DejaVu Sans,Verdana,sans-serif" font-size="11">${tick}%</text>`
  }).join("\n")

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_WIDTH}" height="${CHART_HEIGHT}" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" role="img" aria-label="Coverage evolution: ${latestPct}%">
  <defs>
    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${lineColor}" stop-opacity="0.15"/>
      <stop offset="1" stop-color="${lineColor}" stop-opacity="0.01"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${CHART_WIDTH}" height="${CHART_HEIGHT}" fill="#f8f9fa" rx="6"/>

  <!-- Title -->
  <text x="${PAD_LEFT}" y="20" fill="#212529" font-family="DejaVu Sans,Verdana,sans-serif" font-size="13" font-weight="bold">Coverage Evolution</text>
  <text x="${CHART_WIDTH - PAD_RIGHT}" y="20" text-anchor="end" fill="${lineColor}" font-family="DejaVu Sans,Verdana,sans-serif" font-size="13" font-weight="bold">${latestPct}%</text>

  <!-- Grid lines + Y-axis labels -->
${yGrid}

  <!-- Y-axis line -->
  <line x1="${PAD_LEFT}" y1="${PAD_TOP}" x2="${PAD_LEFT}" y2="${PAD_TOP + PLOT_HEIGHT}" stroke="${axisColor}" stroke-width="1"/>

  <!-- X-axis line -->
  <line x1="${PAD_LEFT}" y1="${PAD_TOP + PLOT_HEIGHT}" x2="${CHART_WIDTH - PAD_RIGHT}" y2="${PAD_TOP + PLOT_HEIGHT}" stroke="${axisColor}" stroke-width="1"/>

  <!-- Area fill under the line -->
  <g>${areaFill}</g>

  <!-- Data line -->
  <polyline fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${polylinePoints}"/>

  <!-- Data dots -->
  <g>
${dotGroups}
  </g>

  <!-- X-axis labels -->
  <g>
${xLabels}
  </g>
</svg>`
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2)
  const snapshotOnly = args.includes("--snapshot-only")
  const chartOnly = args.includes("--chart-only")
  const saveToFile = args.includes("--save")

  // Take a new snapshot unless --chart-only
  if (!chartOnly) {
    const data = computeCoverage()
    const history = loadHistory()

    if (shouldTakeSnapshot(history)) {
      const snapshot = takeSnapshot(data)
      history.push(snapshot)
      saveHistory(history)
      console.error(
        `Snapshot: ${snapshot.date} — ${snapshot.pct}% (${snapshot.covered}/${snapshot.denominator})`,
      )
    } else {
      console.error("Snapshot: skipped — last snapshot is less than 7 days old")
    }

    if (snapshotOnly) return
  }

  // Generate chart
  const history = loadHistory()
  const svg = generateChart(history)

  if (saveToFile) {
    writeFileSync(CHART_FILE, svg, "utf-8")
    console.error(`Chart saved to ${CHART_FILE}`)
    // When saving to file, also print chart info to stdout for CI logs
    const latestPct = history.length > 0 ? history[history.length - 1].pct : 0
    console.log(`Chart: ${latestPct}% (${history.length} data points)`)
  } else {
    // All status messages go to stderr so stdout contains only the SVG
    process.stdout.write(svg + "\n")
  }
}

main()
