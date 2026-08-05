#!/usr/bin/env node

/**
 * save-geo-benchmark.mjs
 *
 * Runs the geo-distance benchmark and saves the result to a
 * date-stamped JSON file under docs/benchmarks/.
 *
 * Usage:
 *   node scripts/save-geo-benchmark.mjs          # → docs/benchmarks/geo-2026-07-26.json
 *   node scripts/save-geo-benchmark.mjs custom   # → docs/benchmarks/geo-custom.json
 */

import { execSync } from "node:child_process"
import { join, dirname } from "node:path"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "benchmarks")

const tag = process.argv[2] ?? new Date().toISOString().slice(0, 10)
const outFile = join(OUT_DIR, `geo-${tag}.json`)

mkdirSync(OUT_DIR, { recursive: true })

// Run benchmark in JSON mode
execSync(
  `node "${join(dirname(fileURLToPath(import.meta.url)), "geo-benchmark.mjs")}" --json "${outFile}"`,
  { stdio: "inherit" },
)
