#!/usr/bin/env node

/**
 * geo-benchmark-real.mjs — Real PostgreSQL + PostGIS benchmark
 *
 * Runs the same geo-distance scenarios as geo-benchmark.mjs (CPU model)
 * but against an actual PostgreSQL database with PostGIS. This validates
 * whether the model parameters (2ms overhead + 0.022ms/row) are accurate.
 *
 * Usage:
 *   node scripts/geo-benchmark-real.mjs
 *   node scripts/geo-benchmark-real.mjs --json           # save results
 *   node scripts/geo-benchmark-real.mjs --keep           # don't drop temp data
 *   node scripts/geo-benchmark-real.mjs --providers 500  # custom count
 *
 * Environment variables (with defaults):
 *   PGUSER=severinno   PGPASSWORD=severinno_dev   PGHOST=localhost
 *   PGPORT=5432        PGDATABASE=severinno
 *
 * Output: same JSON schema as geo-benchmark.mjs so scripts/compare-benchmarks.mjs
 *         can compare model vs real measurements.
 */

import pg from "pg"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { generateProviders } from "../src/lib/benchmark-utils.mjs"
import { haversineKm } from "../src/lib/geo-shared.mjs"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_OUT_DIR = "docs/benchmarks"
const DEFAULT_OUT_FILE = join(DEFAULT_OUT_DIR, "geo-real-latest.json")

const args = process.argv.slice(2)
const jsonFlag = args.includes("--json")
const jsonIndex = args.indexOf("--json")
const jsonFile =
  jsonFlag && args[jsonIndex + 1] && !args[jsonIndex + 1].startsWith("--")
    ? args[jsonIndex + 1]
    : DEFAULT_OUT_FILE
const keepData = args.includes("--keep")
const customCountIndex = args.indexOf("--providers")
const CUSTOM_COUNT = customCountIndex !== -1 ? parseInt(args[customCountIndex + 1], 10) : null

// Provider counts to benchmark
const COUNTS = CUSTOM_COUNT ? [CUSTOM_COUNT] : [100, 500, 1000, 5000]

// Benchmark configuration
const ITERATIONS_BENCH = 20 // how many times to repeat each DB query
const ITERATIONS_HAVERSINE = 200 // more for JS (fast per-call)
const WARMUP_SECONDS = 2 // run queries for this long before measuring

const CENTER = { lat: -23.5505, lng: -46.6333 }

// ---------------------------------------------------------------------------
// Database connection
// ---------------------------------------------------------------------------

const pool = new pg.Pool({
  user: process.env.PGUSER || "severinno",
  password: process.env.PGPASSWORD || "severinno_dev",
  host: process.env.PGHOST || "localhost",
  port: parseInt(process.env.PGPORT || "5432", 10),
  database: process.env.PGDATABASE || "severinno",
  max: 5,
  idleTimeoutMillis: 5000,
})

let conn = null

async function getConn() {
  if (!conn) conn = await pool.connect()
  return conn
}

async function query(sql, params = []) {
  const c = await getConn()
  return c.query(sql, params)
}

async function close() {
  if (conn) {
    conn.release()
    conn = null
  }
  await pool.end()
}

// ---------------------------------------------------------------------------
// Verify PostGIS
// ---------------------------------------------------------------------------

async function checkPostGIS() {
  const result = await query("SELECT PostGIS_Version() AS ver")
  return result.rows[0].ver
}

// ---------------------------------------------------------------------------
// Temporary data setup — creates providers in a schema-local temp table
// ---------------------------------------------------------------------------

const TABLE = "geo_benchmark_providers"

async function setupData(count) {
  const providers = generateProviders(count, 100, CENTER)
  const _centerWKT = `POINT(${CENTER.lng} ${CENTER.lat})`

  // Drop & recreate temp table
  await query(`DROP TABLE IF EXISTS "${TABLE}"`)
  await query(`
    CREATE TEMP TABLE "${TABLE}" (
      id SERIAL PRIMARY KEY,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      location geography(Point, 4326)
    )
  `)

  // Bulk insert with location
  const CHUNK = 500
  for (let i = 0; i < providers.length; i += CHUNK) {
    const chunk = providers.slice(i, i + CHUNK)
    const values = chunk
      .map((_, j) => {
        const idx = i + j
        return `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, ST_SetSRID(ST_MakePoint($${idx * 4 + 4}, $${idx * 4 + 3}), 4326)::geography)`
      })
      .join(", ")
    const params = chunk.flatMap((p) => [p.lat, p.lng, p.lat, p.lng])
    await query(`INSERT INTO "${TABLE}" (lat, lng, location) VALUES ${values}`, params)
  }

  // Create GiST index on location
  await query(`CREATE INDEX idx_${TABLE}_location ON "${TABLE}" USING GIST (location)`)
}

async function teardown() {
  if (!keepData) {
    await query(`DROP TABLE IF EXISTS "${TABLE}"`)
  }
}

// ---------------------------------------------------------------------------
// Benchmark runners
// ---------------------------------------------------------------------------

/** Run a function repeatedly, returning measured stats. */
async function bench(label, fn, iterations, warmupSeconds = WARMUP_SECONDS) {
  // Warmup
  const warmupStart = Date.now()
  let warmupCount = 0
  while (Date.now() - warmupStart < warmupSeconds * 1000) {
    await fn()
    warmupCount++
  }

  // Measured runs
  const samples = []
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now()
    await fn()
    const t1 = performance.now()
    samples.push((t1 - t0) * 1000) // µs
  }

  const sorted = [...samples].sort((a, b) => a - b)
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length

  return {
    name: label,
    label: label.replace(/[^a-z0-9_]/gi, "_").toLowerCase(),
    mean: Math.round(mean * 10) / 10,
    min: Math.round(sorted[0] * 10) / 10,
    max: Math.round(sorted[sorted.length - 1] * 10) / 10,
    opsPerSec: Math.round(1_000_000 / mean),
    warmupIterations: warmupCount,
    samples: samples.length,
  }
}

/** PostGIS ST_Distance — compute distance for all providers from center. */
function makePGBenchDistance(_count) {
  return async () => {
    await query(
      `
      SELECT ST_Distance(
        location,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
      ) / 1000 AS distance_km
      FROM "${TABLE}"
      ORDER BY id
    `,
      [CENTER.lng, CENTER.lat],
    )
  }
}

/** PostGIS ST_DWithin — filter providers within radius. */
function makePGBenchDWithin(count, radiusKm = 15) {
  return async () => {
    await query(
      `
      SELECT id,
        ST_Distance(
          location,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) / 1000 AS distance_km
      FROM "${TABLE}"
      WHERE ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        $3
      )
      ORDER BY distance_km
    `,
      [CENTER.lng, CENTER.lat, radiusKm * 1000],
    )
  }
}

/** PostGIS COUNT query with radius filter — models the radius-expansion path. */
function makePGBenchCount(radiusKm = 15) {
  return async () => {
    const r = await query(
      `
      SELECT COUNT(*)::int AS total
      FROM "${TABLE}"
      WHERE ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        $3
      )
    `,
      [CENTER.lng, CENTER.lat, radiusKm * 1000],
    )
    return r.rows[0].total
  }
}

/** Haversine JS — compute all distances in JS (no DB). */
function makeHaversineBench(count) {
  const providers = generateProviders(count, 100, CENTER)
  return () => {
    let sum = 0
    for (let i = 0; i < providers.length; i++) {
      sum += haversineKm(CENTER.lat, CENTER.lng, providers[i].lat, providers[i].lng)
    }
    if (sum < 0) throw new Error("unreachable")
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("")
  console.log("╔══════════════════════════════════════════════════════════════════════╗")
  console.log("║      Severinno — Real PostGIS Benchmark (actual database)          ║")
  console.log("╚══════════════════════════════════════════════════════════════════════╝")
  console.log("")

  // ── Connect & verify ───────────────────────────────────────────────────

  try {
    const pgVer = await checkPostGIS()
    console.log(`  PostgreSQL:   ${pgVer}`)
  } catch (e) {
    console.error("❌ Could not connect to PostgreSQL or PostGIS not available.")
    console.error(`   ${e.message}`)
    console.error("")
    console.error("  Make sure PostgreSQL is running and set PGUSER, PGPASSWORD,")
    console.error("  PGHOST, PGPORT, PGDATABASE env vars if using non-default values.")
    console.error("")
    process.exit(1)
  }

  const connInfo = await query("SELECT inet_server_addr() AS addr, inet_server_port() AS port")
  const dbInfo = await query("SELECT current_database() AS db, version() AS ver")
  console.log(
    `  Host:         ${connInfo.rows[0]?.addr ?? "localhost"}:${connInfo.rows[0]?.port ?? 5432}`,
  )
  console.log(`  Database:     ${dbInfo.rows[0]?.db ?? "?"}`)
  console.log(`  Server:       ${dbInfo.rows[0]?.ver?.split(",")[0] ?? "?"}`)
  console.log(`  Platform:     ${process.platform} ${process.arch}  Node ${process.version}`)
  console.log("")

  const allBenchmarks = []
  const haversineUnitCosts = {}

  for (const count of COUNTS) {
    console.log(`  ─── ${count.toLocaleString()} providers ───────────────────────────────────┐`)
    console.log("")

    // Setup data
    console.log(`  Inserting ${count.toLocaleString()} synthetic providers…`)
    const setupStart = Date.now()
    await setupData(count)
    const setupMs = Date.now() - setupStart
    console.log(`  Done in ${setupMs}ms`)
    console.log("")

    // Warm up buffer cache
    console.log(`  Warming buffer cache with ST_Distance call…`)
    await makePGBenchDistance(count)() // cold
    await makePGBenchDistance(count)() // warm
    console.log("")

    // Haversine (pure JS)
    const hv = await bench(
      `Haversine JS ${count.toLocaleString()}`,
      makeHaversineBench(count),
      ITERATIONS_HAVERSINE,
      1,
    )
    console.log(
      `  Haversine JS:         ${hv.mean.toFixed(0).padStart(7)} µs mean  (${hv.opsPerSec.toLocaleString()} ops/sec)`,
    )
    allBenchmarks.push(hv)

    // PostGIS ST_Distance (all providers)
    const pgDist = await bench(
      `PostGIS ST_Distance ${count.toLocaleString()}`,
      makePGBenchDistance(count),
      ITERATIONS_BENCH,
    )
    console.log(
      `  PostGIS ST_Distance:  ${pgDist.mean.toFixed(0).padStart(7)} µs mean  (${pgDist.opsPerSec.toLocaleString()} ops/sec)`,
    )
    allBenchmarks.push(pgDist)

    // PostGIS ST_DWithin + ST_Distance (15km radius — typical neighborhood)
    const dWithin15 = await bench(
      `PostGIS ST_DWithin ${count.toLocaleString()} (15km)`,
      makePGBenchDWithin(count, 15),
      ITERATIONS_BENCH,
    )
    console.log(
      `  PostGIS ST_DWithin 15km: ${dWithin15.mean.toFixed(0).padStart(7)} µs  (${dWithin15.opsPerSec.toLocaleString()} ops/sec)`,
    )
    allBenchmarks.push(dWithin15)

    // PostGIS COUNT query (15km radius — models radius-expansion path)
    const countQ = await bench(
      `PostGIS COUNT ${count.toLocaleString()} (15km)`,
      makePGBenchCount(15),
      ITERATIONS_BENCH,
    )
    console.log(
      `  PostGIS COUNT 15km:   ${countQ.mean.toFixed(0).padStart(7)} µs  (${countQ.opsPerSec.toLocaleString()} ops/sec)`,
    )
    allBenchmarks.push(countQ)

    // PostGIS ST_DWithin with expanded radius (50km)
    const dWithin50 = await bench(
      `PostGIS ST_DWithin ${count.toLocaleString()} (50km)`,
      makePGBenchDWithin(count, 50),
      ITERATIONS_BENCH,
    )
    console.log(
      `  PostGIS ST_DWithin 50km: ${dWithin50.mean.toFixed(0).padStart(7)} µs  (${dWithin50.opsPerSec.toLocaleString()} ops/sec)`,
    )
    allBenchmarks.push(dWithin50)

    // Per-provider cost for Haversine
    haversineUnitCosts[`at${count}`] = +(hv.mean / count).toFixed(4)

    // Teardown between counts
    await teardown()
    console.log("")
  }

  // Final cleanup
  if (!keepData) await teardown()
  await close()

  // ── Derive model parameters from real measurements ──────────────────────
  //
  // For each ST_Distance measurement, estimate:
  //   fixed_overhead + per_row × N = measured_mean
  //
  // Using the smallest and largest counts to solve for two unknowns.
  const distanceBenchmarks = allBenchmarks.filter((b) => b.label.startsWith("postgis_st_distance"))
  let modelOverhead = null
  let modelPerRow = null
  if (distanceBenchmarks.length >= 2) {
    // Use first and last counts to solve linear model
    const smallest = distanceBenchmarks[0]
    const largest = distanceBenchmarks[distanceBenchmarks.length - 1]
    const countS = parseInt(smallest.label.match(/\d+/)?.[0] ?? "100", 10)
    const countL = parseInt(largest.label.match(/\d+/)?.[0] ?? "5000", 10)
    // measured = overhead + perRow × count
    // Solve: perRow = (largest.mean - smallest.mean) / (countL - countS)
    modelPerRow = (largest.mean - smallest.mean) / (countL - countS)
    modelOverhead = smallest.mean - modelPerRow * countS
  }

  // ── Build result ───────────────────────────────────────────────────────

  const results = {
    meta: {
      center: CENTER,
      centerLabel: "São Paulo",
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
      type: "real_postgis",
      dbms: dbInfo.rows[0]?.ver?.split(",")[0] ?? "?",
      postgisVersion: await checkPostGIS().catch(() => "?"),
    },
    benchmarks: allBenchmarks,
    analysis: {
      haversineUnitCosts,
      derivedModel:
        modelOverhead !== null
          ? {
              fixedOverheadMs: +(modelOverhead / 1000).toFixed(3),
              perRowMs: +(modelPerRow / 1000).toFixed(5),
              formula: `T(N) = ${(modelOverhead / 1000).toFixed(3)} ms + ${(modelPerRow / 1000).toFixed(5)} ms × N`,
              note: "Derived from linear regression of real PostGIS ST_Distance measurements. Compare with the CPU model in geo-benchmark.mjs (2 ms + 0.022 ms × N).",
            }
          : null,
    },
  }

  // ── Print table ────────────────────────────────────────────────────────

  function pad(s, w) {
    return String(s ?? "").padStart(w)
  }

  console.log("╔══════════════════════════════════════════════════════════════════════╗")
  console.log("║                         Results Summary                             ║")
  console.log("╚══════════════════════════════════════════════════════════════════════╝")
  console.log("")

  console.log("  ┌──────────────────────────────┬──────────┬──────────┬──────────┬─────────────┐")
  console.log("  │ Benchmark                     │   Mean   │   Min    │   Max    │   ops/sec   │")
  console.log("  ├──────────────────────────────┼──────────┼──────────┼──────────┼─────────────┤")

  for (const b of results.benchmarks) {
    console.log(
      `  │ ${b.name.padEnd(28)} │ ${pad(b.mean, 6)} µs │ ${pad(b.min, 6)} µs │ ${pad(b.max, 6)} µs │ ${pad(b.opsPerSec, 9)}  │`,
    )
  }

  console.log("  └──────────────────────────────┴──────────┴──────────┴──────────┴─────────────┘")
  console.log("")

  // ── Comparison with model ──────────────────────────────────────────────

  console.log("╔══════════════════════════════════════════════════════════════════════╗")
  console.log("║              Model vs Real — Parameter Comparison                   ║")
  console.log("╚══════════════════════════════════════════════════════════════════════╝")
  console.log("")

  if (modelOverhead !== null) {
    console.log(`  Model (CPU model in geo-benchmark.mjs):`)
    console.log(`    Fixed overhead:  2.000 ms`)
    console.log(`    Per-row cost:    0.022 ms`)
    console.log("")
    console.log(`  Real measurements (linear regression):`)
    console.log(`    Fixed overhead:  ${(modelOverhead / 1000).toFixed(3)} ms`)
    console.log(`    Per-row cost:    ${(modelPerRow / 1000).toFixed(5)} ms`)
    console.log(`    Formula:         ${results.analysis.derivedModel.formula}`)
    console.log("")

    const overheadRatio = modelOverhead / 2000
    const perRowRatio = modelPerRow / 0.022
    console.log(`  Ratio (real / model):`)
    console.log(`    Fixed overhead:  ${overheadRatio.toFixed(2)}×`)
    console.log(`    Per-row cost:    ${perRowRatio.toFixed(2)}×`)
    console.log("")

    if (overheadRatio < 2 && perRowRatio < 2) {
      console.log("  ✅ Model is within 2× of real measurements — adequate for capacity planning.")
    } else {
      console.log(
        "  ⚠  Model deviates >2× from real measurements. Consider updating model parameters.",
      )
    }
    console.log("")
  }

  // Haversine unit costs
  const avgCost =
    Object.values(haversineUnitCosts).reduce((s, v) => s + v, 0) /
    Object.values(haversineUnitCosts).length
  console.log(`  Average Haversine cost:    ${avgCost.toFixed(4)} µs / provider`)
  console.log("")

  // ── JSON output ────────────────────────────────────────────────────────

  if (jsonFlag) {
    mkdirSync(dirname(jsonFile), { recursive: true })
    writeFileSync(jsonFile, JSON.stringify(results, null, 2), "utf-8")
    console.log(`  📁 Results saved to ${jsonFile}`)
    console.log("")
  }

  console.log("  To compare with the CPU model:")
  console.log(
    `    node scripts/compare-benchmarks.mjs docs/benchmarks/geo-latest.json ${jsonFlag ? jsonFile : "docs/benchmarks/geo-real-latest.json"}`,
  )
  console.log("")
}

async function safeCleanup() {
  try {
    await teardown()
  } catch {
    /* table may not exist */
  }
  try {
    await close()
  } catch {
    /* pool already closed */
  }
}

main().catch(async (e) => {
  console.error("❌ Benchmark failed:", e)
  await safeCleanup()
  process.exit(1)
})
