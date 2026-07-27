#!/usr/bin/env npx tsx
/**
 * Coverage Badge Generator
 *
 * Delegates to coverage-gaps.ts --json for accurate coverage data,
 * then generates a shields.io-style SVG badge with color thresholds:
 *   green  (#2ea44f)  coverage >= 80%
 *   yellow (#bfa100)  coverage >= 50%
 *   red    (#cb2431)  coverage <  50%
 *
 * Usage:
 *   npx tsx scripts/coverage-badge.ts                  # print SVG to stdout
 *   npx tsx scripts/coverage-badge.ts --save           # save to docs/badge-coverage.svg
 *   npx tsx scripts/coverage-badge.ts --update-readme  # update badge URL in README.md
 */

import { execSync } from "child_process"
import { join } from "path"
import { readFileSync, writeFileSync, existsSync } from "fs"

// ── Coverage data (delegates to coverage-gaps.ts --json) ───────────────────

type CoverageData = {
  totalRoutes: number
  covered: number
  gaps: number
  excluded: number
  coveragePct: number
}

function computeCoverage(): CoverageData {
  const scriptPath = join(__dirname, "coverage-gaps.ts")
  const output = execSync(`npx tsx "${scriptPath}" --json`, {
    encoding: "utf-8",
    timeout: 30_000,
  })
  return JSON.parse(output)
}

// ── SVG template ───────────────────────────────────────────────────────────

function generateBadge(pct: number, covered: number, denominator: number): string {
  const color = pct >= 80 ? "#2ea44f" : pct >= 50 ? "#bfa100" : "#cb2431"
  const label = "coverage"
  const value = `${pct}% (${covered}/${denominator})`

  // shields.io flat-style badge, self-contained SVG
  const labelWidth = 70
  const valueWidth = Math.max(50, value.length * 7 + 14)
  const totalWidth = labelWidth + valueWidth
  const height = 20

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" viewBox="0 0 ${totalWidth} ${height}" role="img" aria-label="coverage: ${value}">
  <title>coverage: ${value}</title>
  <defs>
    <linearGradient id="b" x2="0" y2="100%">
      <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
      <stop offset="1" stop-opacity=".1"/>
    </linearGradient>
  </defs>
  <rect width="${totalWidth}" height="${height}" rx="3" fill="#555"/>
  <rect x="${labelWidth}" width="${valueWidth}" height="${height}" rx="3" fill="${color}"/>
  <rect x="${labelWidth}" width="4" height="${height}" fill="${color}"/>
  <rect width="${totalWidth}" height="${height}" fill="url(#b)"/>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${Math.round(labelWidth / 2)}" y="14">${label}</text>
    <text x="${Math.round(labelWidth + valueWidth / 2)}" y="14">${value}</text>
  </g>
</svg>`
}

// ── README updater ─────────────────────────────────────────────────────────

const BADGE_PATTERN = /https:\/\/img\.shields\.io\/badge\/coverage-[^\s)]+/g

function updateReadme(pct: number, covered: number, denominator: number): void {
  const readmePath = join(__dirname, "..", "README.md")
  if (!existsSync(readmePath)) {
    console.error("README.md not found")
    process.exit(1)
  }

  let readme = readFileSync(readmePath, "utf-8")
  const color = pct >= 80 ? "2ea44f" : pct >= 50 ? "bfa100" : "cb2431"
  const badgeText = `coverage-${pct}%25%20(${covered}%2F${denominator})-${color}`
  const newBadge = `https://img.shields.io/badge/${badgeText}`

  // Reset lastIndex before testing
  BADGE_PATTERN.lastIndex = 0
  const hasBadge = BADGE_PATTERN.test(readme)
  BADGE_PATTERN.lastIndex = 0

  if (hasBadge) {
    readme = readme.replace(BADGE_PATTERN, newBadge)
  } else {
    // Append after the last badge img tag
    const lastImg = /<img[^>]*>/g
    let match: RegExpExecArray | null = null
    let lastMatch: RegExpExecArray | null = null
    while ((match = lastImg.exec(readme)) !== null) {
      lastMatch = match
    }
    if (lastMatch) {
      const idx = lastMatch.index + lastMatch[0].length
      readme = readme.slice(0, idx) + `\n  <img src="${newBadge}" alt="Coverage: ${pct}%">` + readme.slice(idx)
    } else {
      console.warn("Could not find any img tag in README.md — badge not added")
      return
    }
  }

  writeFileSync(readmePath, readme, "utf-8")
  console.log(`README.md updated: coverage badge → ${pct}% (${covered}/${denominator})`)
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2)
  const saveToFile = args.includes("--save")
  const updateReadmeFlag = args.includes("--update-readme")

  const data = computeCoverage()
  const { coveragePct: pct, covered, totalRoutes: total, excluded = 0 } = data
  const denominator = total - excluded
  const svg = generateBadge(pct, covered, denominator)

  if (saveToFile) {
    const outPath = join(__dirname, "..", "docs", "badge-coverage.svg")
    writeFileSync(outPath, svg, "utf-8")
    console.log(`Badge saved to ${outPath}`)
  } else if (updateReadmeFlag) {
    updateReadme(pct, covered, denominator)
  }

  console.log(`Coverage: ${pct}% (${covered}/${denominator})`)

  if (!saveToFile && !updateReadmeFlag) {
    console.log(svg)
  }
}

main()
