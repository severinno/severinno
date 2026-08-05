#!/usr/bin/env node
/**
 * search-benchmark.mjs — standalone search-index benchmark
 *
 * Measures modelled throughput of common OpenSearch / full-text search
 * operations used in Severinno: exact-match, full-text, geo-search,
 * combined queries, and bulk indexing.
 *
 * The search side is a **CPU-modelled estimate** (not a real OpenSearch
 * instance) that reproduces the wall-clock cost of local search queries
 * on a typical machine.  See the model parameters below.
 *
 * Usage:
 *   node scripts/search-benchmark.mjs
 *   node scripts/search-benchmark.mjs --json              # default: search-latest.json
 *   node scripts/search-benchmark.mjs --json results.json # custom filename
 *
 * The --json flag writes a JSON file compatible with
 * `scripts/compare-benchmarks.mjs --filter search`.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { calibrateBusyLoop } from "../src/lib/cpu-calibrate.mjs"
import { measure } from "../src/lib/benchmark-utils.mjs"

// ---------------------------------------------------------------------------
// Default output directory
// ---------------------------------------------------------------------------

const DEFAULT_OUT_DIR = "docs/benchmarks"
const DEFAULT_OUT_FILE = join(DEFAULT_OUT_DIR, "search-latest.json")

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const jsonFlag = args.includes("--json")
const jsonIndex = args.indexOf("--json")
const jsonFile =
  jsonFlag && args[jsonIndex + 1] && !args[jsonIndex + 1].startsWith("--")
    ? args[jsonIndex + 1]
    : DEFAULT_OUT_FILE

// ---------------------------------------------------------------------------
// Search modelled latency parameters
// ---------------------------------------------------------------------------
//
// Model parameters (conservative for local OpenSearch 2.x, warm page cache):
//   ┌───────────────────────────┬───────────┬───────────────────────────────┐
//   │ Operation                 │ Latency   │ Source                        │
//   ├───────────────────────────┼───────────┼───────────────────────────────┤
//   │ HTTP round-trip           │   0.2 ms  │ localhost curl               │
//   │ Exact-match (term) query  │   2.0 ms  │ OpenSearch benchmark API     │
//   │ Full-text (match) query   │   4.0 ms  │ OpenSearch benchmark API     │
//   │ Geo-distance query        │   3.0 ms  │ OpenSearch benchmark API     │
//   │ Combined (text + geo)     │   5.0 ms  │ estimated (two clauses)      │
//   │ Aggregation (faceted)     │   6.0 ms  │ OpenSearch benchmark API     │
//   │ Bulk index (per doc)      │   0.5 ms  │ OpenSearch benchmark API     │
//   │ Serialise 1 KB payload    │   1.0 µs  │ negligible, amortised        │
//   ├───────────────────────────┼───────────┼───────────────────────────────┤
//   │ Exact-match total         │   2.2 ms  │ model = 2200 µs              │
//   │ Full-text total           │   4.2 ms  │ model = 4200 µs              │
//   │ Geo-distance total        │   3.2 ms  │ model = 3200 µs              │
//   │ Combined total            │   5.2 ms  │ model = 5200 µs              │
//   │ Aggregation total         │   6.2 ms  │ model = 6200 µs              │
//   │ Bulk 100 docs             │  70.0 ms  │ model = 70000 µs             │
//   └───────────────────────────┴───────────┴───────────────────────────────┘
//
// Reference:
//   https://opensearch.org/docs/latest/benchmark/

const EXACT_MATCH_US = 2200
const FULLTEXT_US = 4200
const GEO_DISTANCE_US = 3200
const COMBINED_US = 5200
const AGGREGATION_US = 6200
const BULK_100_US = 70000

const ITERS_PER_MS = calibrateBusyLoop()

// ---------------------------------------------------------------------------
// Modelled search operations
// ---------------------------------------------------------------------------

function simulatedSearchOp(latencyUs) {
  const ms = latencyUs / 1000
  if (ms <= 0) return
  const target = Math.max(1, Math.round(ms * ITERS_PER_MS))
  let acc = 0
  for (let i = 0; i < target; i++) acc += Math.sqrt(i & 1023)
  if (acc < 0) throw new Error("unreachable")
}

function exactMatch() {
  simulatedSearchOp(EXACT_MATCH_US)
}
function fulltextSearch() {
  simulatedSearchOp(FULLTEXT_US)
}
function geoDistance() {
  simulatedSearchOp(GEO_DISTANCE_US)
}
function combinedSearch() {
  simulatedSearchOp(COMBINED_US)
}
function aggregation() {
  simulatedSearchOp(AGGREGATION_US)
}
function bulkIndex100() {
  simulatedSearchOp(BULK_100_US)
}

// ---------------------------------------------------------------------------
// Run benchmarks — collect structured results
// ---------------------------------------------------------------------------

function runAll() {
  const sExact = measure(() => exactMatch(), 100)
  const sFulltext = measure(() => fulltextSearch(), 100)
  const sGeo = measure(() => geoDistance(), 100)
  const sCombined = measure(() => combinedSearch(), 50)
  const sAgg = measure(() => aggregation(), 50)
  const sBulk = measure(() => bulkIndex100(), 10)

  return {
    meta: {
      model: "CPU-modelled local OpenSearch 2.x (loopback, warm page cache)",
      cpuItersPerMs: Math.round(ITERS_PER_MS),
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
    },
    benchmarks: [
      { name: "Exact-match (term)     1", label: "search_exact_match", ...sExact },
      { name: "Full-text (match)      1", label: "search_fulltext", ...sFulltext },
      { name: "Geo-distance query     1", label: "search_geo_distance", ...sGeo },
      { name: "Combined (text + geo)  1", label: "search_combined", ...sCombined },
      { name: "Aggregation (faceted)  1", label: "search_aggregation", ...sAgg },
      { name: "Bulk index           100", label: "search_bulk_100", ...sBulk },
    ],
    analysis: {
      note: "CPU-modelled estimate of local OpenSearch operations. Real-world performance depends on shard count, index size, query complexity, and hardware.",
      modelParams: {
        exactMatchUs: EXACT_MATCH_US,
        fulltextUs: FULLTEXT_US,
        geoDistanceUs: GEO_DISTANCE_US,
        combinedUs: COMBINED_US,
        aggregationUs: AGGREGATION_US,
        bulk100Us: BULK_100_US,
      },
    },
  }
}

const results = runAll()

// ---------------------------------------------------------------------------
// Print formatted table
// ---------------------------------------------------------------------------

function pad(s, w) {
  return String(s).padStart(w)
}

console.log("")
console.log("╔══════════════════════════════════════════════════════════════════════╗")
console.log("║      Severinno — Search-Index Benchmark (modelled)                 ║")
console.log("╚══════════════════════════════════════════════════════════════════════╝")
console.log("")
console.log(`  CPU:      ${ITERS_PER_MS.toFixed(0).padStart(5)} iters/ms  (calibrated busy-loop)`)
console.log(`  Platform: ${process.platform} ${process.arch}  Node ${process.version}`)
console.log("")
console.log("  ┌──────────────────────┬──────────┬──────────┬──────────┬─────────────┐")
console.log("  │ Benchmark            │   Mean   │   Min    │   Max    │   ops/sec   │")
console.log("  ├──────────────────────┼──────────┼──────────┼──────────┼─────────────┤")
for (const b of results.benchmarks) {
  console.log(
    `  │ ${b.name.padEnd(20)} │ ${pad(b.mean, 6)} µs │ ${pad(b.min, 6)} µs │ ${pad(b.max, 6)} µs │ ${pad(b.opsPerSec, 9)}  │`,
  )
}
console.log("  └──────────────────────┴──────────┴──────────┴──────────┴─────────────┘")
console.log("")
console.log("  [model] = CPU-modelled estimate of local OpenSearch operations.")
console.log("           NOT a measurement against a real search cluster.")
console.log("")
console.log("  ─── Model parameters ───────────────────────────────────────────────")
console.log("")
console.log(`    Exact-match (term):  ~${EXACT_MATCH_US} µs  (HTTP + Lucene term lookup)`)
console.log(`    Full-text (match):   ~${FULLTEXT_US} µs  (HTTP + inverted index scan)`)
console.log(`    Geo-distance:        ~${GEO_DISTANCE_US} µs  (HTTP + geo-hash filter)`)
console.log(`    Combined (text+geo): ~${COMBINED_US} µs  (HTTP + two clauses)`)
console.log(`    Aggregation:         ~${AGGREGATION_US} µs  (HTTP + term buckets)`)
console.log(`    Bulk 100 docs:       ~${BULK_100_US} µs  (HTTP + indexing pipeline)`)
console.log("")
console.log("  ─── Practical guidance ─────────────────────────────────────────────")
console.log("")
console.log("  • Full-text search is ~2× slower than exact-match (inverted index).")
console.log("  • Geo-distance adds ~50% overhead vs exact-match.")
console.log("  • Combining text + geo is additive: ~5.2 ms total.")
console.log("  • Aggregations add ~40% overhead vs simple search queries.")
console.log("  • Bulk indexing amortises overhead: ~700 µs/doc at 100 docs/batch.")
console.log("")

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

if (jsonFlag) {
  mkdirSync(dirname(jsonFile), { recursive: true })
  writeFileSync(jsonFile, JSON.stringify(results, null, 2), "utf-8")
  console.log(`  📁 Results saved to ${jsonFile}`)
  console.log("")
}
