#!/usr/bin/env node

/**
 * geo-benchmark-gist.mjs — GiST Index vs Full-Scan Benchmark
 *
 * Isolates the PostGIS GiST index cost by comparing:
 *   • ST_Distance (full scan)  — sequential scan + distance on ALL rows
 *   • ST_DWithin + ST_Distance — GiST index lookup + distance on filtered rows
 *   • ST_DWithin COUNT         — GiST index-only scan (cheapest)
 *
 * Measurements at varying radii and provider densities reveal:
 *   • GiST index lookup overhead (constant per query)
 *   • Selectivity curve (what fraction of rows pass the filter)
 *   • Crossover radius where index becomes more expensive than full scan
 *
 * Usage:
 *   node scripts/geo-benchmark-gist.mjs
 *   node scripts/geo-benchmark-gist.mjs --json
 *   node scripts/geo-benchmark-gist.mjs --providers 5000 --spread 200
 *   node scripts/geo-benchmark-gist.mjs --radius-list 1,5,25,100
 *
 * Env vars (with defaults):
 *   PGUSER=severinno  PGPASSWORD=severinno_dev  PGHOST=localhost
 *   PGPORT=5432       PGDATABASE=severinno
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
const DEFAULT_OUT_FILE = join(DEFAULT_OUT_DIR, "geo-gist-latest.json")

const args = process.argv.slice(2)
const jsonFlag = args.includes("--json")
const jsonIndex = args.indexOf("--json")
const jsonFile =
  jsonFlag && args[jsonIndex + 1] && !args[jsonIndex + 1].startsWith("--")
    ? args[jsonIndex + 1]
    : DEFAULT_OUT_FILE
const keepData = args.includes("--keep")

// Provider counts (density)
const customCountIndex = args.indexOf("--providers")
const COUNTS =
  customCountIndex !== -1 ? [parseInt(args[customCountIndex + 1], 10)] : [1000, 5000, 10000]

// Spread km (distribution)
const customSpreadIndex = args.indexOf("--spread")
const SPREAD_KM = customSpreadIndex !== -1 ? parseInt(args[customSpreadIndex + 1], 10) : 100 // ~São Paulo metro area

// Radius list
const customRadiusIndex = args.indexOf("--radius-list")
const RAW_RADII =
  customRadiusIndex !== -1
    ? args[customRadiusIndex + 1].split(",").map(Number)
    : [1, 3, 5, 10, 15, 25, 50, 100]
if (RAW_RADII.length === 0 || RAW_RADII.some((r) => !Number.isFinite(r) || r <= 0)) {
  console.error("❌ Invalid or empty radius list. Use e.g. --radius-list 1,5,10,25")
  process.exit(1)
}
const RADII_KM = RAW_RADII

// Benchmark config
const ITERATIONS = 20
const WARMUP_SECONDS = 2

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
  max: 3,
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

async function closeConn() {
  if (conn) {
    conn.release()
    conn = null
  }
  await pool.end()
}

// ---------------------------------------------------------------------------
// PostGIS check
// ---------------------------------------------------------------------------

async function checkPostGIS() {
  const r = await query("SELECT PostGIS_Version() AS ver")
  return r.rows[0].ver
}

// ---------------------------------------------------------------------------
// Temp table setup
// ---------------------------------------------------------------------------

const TABLE = "geo_benchmark_gist"

async function setupData(count) {
  const providers = generateProviders(count, SPREAD_KM, CENTER)

  await query(`DROP TABLE IF EXISTS "${TABLE}"`)
  await query(`
    CREATE TEMP TABLE "${TABLE}" (
      id SERIAL PRIMARY KEY,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      location geography(Point, 4326)
    )
  `)

  const CHUNK = 500
  for (let i = 0; i < providers.length; i += CHUNK) {
    const chunk = providers.slice(i, i + CHUNK)
    const values = chunk
      .map((_, j) => {
        const idx = i + j
        return `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3},
              ST_SetSRID(ST_MakePoint($${idx * 4 + 4}, $${idx * 4 + 3}), 4326)::geography)`
      })
      .join(",\n")
    const params = chunk.flatMap((p) => [p.lat, p.lng, p.lat, p.lng])
    await query(`INSERT INTO "${TABLE}" (lat, lng, location) VALUES ${values}`, params)
  }

  // GiST index
  await query(`CREATE INDEX idx_${TABLE}_location ON "${TABLE}" USING GIST (location)`)

  // Return providers so JS benchmarks use the SAME points as PostGIS
  return { count: providers.length, providers }
}

async function teardown() {
  if (!keepData) {
    await query(`DROP TABLE IF EXISTS "${TABLE}"`)
  }
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

async function bench(label, fn, iterations = ITERATIONS, warmupSeconds = WARMUP_SECONDS) {
  const warmupStart = Date.now()
  let warmupCount = 0
  while (Date.now() - warmupStart < warmupSeconds * 1000) {
    await fn()
    warmupCount++
  }

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
    median: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10,
    p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
    opsPerSec: Math.round(1_000_000 / mean),
    warmupIterations: warmupCount,
    samples: samples.length,
  }
}

// ---------------------------------------------------------------------------
// Query builders
// ---------------------------------------------------------------------------

/** Full scan: ST_Distance on every row — no WHERE, no index. */
function makeFullScan() {
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

/** GiST scan with ST_DWithin filter + ST_Distance computation. */
function makeGiSTDWithin(radiusKm) {
  return async () => {
    const r = await query(
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
    return r.rows
  }
}

/** GiST index-only scan: COUNT within radius (cheapest index path). */
function makeGiSTCount(radiusKm) {
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

/** Haversine JS fallback on ALL rows (no filtering). */
function makeHaversineFull(providers) {
  return () => {
    let sum = 0
    for (let i = 0; i < providers.length; i++) {
      sum += haversineKm(CENTER.lat, CENTER.lng, providers[i].lat, providers[i].lng)
    }
    if (sum < 0) throw new Error("unreachable")
  }
}

/** Haversine JS fallback with manual filter (simulates app-level filtering). */
function makeHaversineFiltered(providers, radiusKm) {
  return () => {
    let count = 0
    for (let i = 0; i < providers.length; i++) {
      const d = haversineKm(CENTER.lat, CENTER.lng, providers[i].lat, providers[i].lng)
      if (d <= radiusKm) count++
    }
    if (count < 0) throw new Error("unreachable")
  }
}

// ---------------------------------------------------------------------------
// GiST cost analysis
// ---------------------------------------------------------------------------

/**
 * Given a set of measurements for a single density + radius combo,
 * isolate the GiST index lookup cost.
 *
 *   full_scan_time     = T(N)
 *   gist_dwithin_time  = T_idx_lookup + selectivity × T(N)
 *   => T_idx_lookup    = gist_dwithin_time - selectivity × full_scan_time
 *
 * Where selectivity = (rows_in_radius / total_rows), measured from the COUNT query.
 */
function analyzeGiSTCost(fullScanTime, dWithinTime, countResult, totalRows) {
  const selectivity = countResult / totalRows
  const indexLookupUs = dWithinTime - selectivity * fullScanTime

  return {
    totalRows,
    rowsInRadius: countResult,
    selectivity: +selectivity.toFixed(4),
    fullScanUs: fullScanTime,
    dWithinUs: dWithinTime,
    indexLookupUs: Math.max(0, +indexLookupUs.toFixed(1)),
    // If index lookup cost is > full scan, the index is actually slower
    gistFasterThanFullScan: dWithinTime < fullScanTime,
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("")
  console.log("╔══════════════════════════════════════════════════════════════════════╗")
  console.log("║     Severinno — GiST Index vs Full-Scan Benchmark (PostGIS)        ║")
  console.log("╚══════════════════════════════════════════════════════════════════════╝")
  console.log("")

  // ── Connect ────────────────────────────────────────────────────────────

  try {
    // Self-provisioning: a fresh postgis container (POSTGRES_DB vem de
    // template1) normalmente NÃO tem a extensão habilitada — sem ela o
    // checkPostGIS falha. CREATE EXTENSION IF NOT EXISTS torna o script
    // robusto tanto para CI quanto para runs locais. O docker-postgis pode
    // carregar a extensão logo após o servidor aceitar conexões (race) — um
    // erro duplicate key nesse caso significa que ela JÁ ESTÁ presente (o
    // que é aceitável, não é falha de conexão nem de imagem).
    await query("CREATE EXTENSION IF NOT EXISTS postgis").catch((e) => {
      if (!/already exists|duplicate key/i.test(e.message ?? "")) throw e
    })
    const pgVer = await checkPostGIS()
    console.log(`  PostgreSQL:   ${pgVer}`)
  } catch (e) {
    console.error("❌ Could not connect to PostgreSQL or PostGIS not available.")
    console.error(`   ${e.message}`)
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
  console.log(`  Spread:       ${SPREAD_KM} km from center`)
  console.log(`  Radii:        ${RADII_KM.join(", ")} km`)
  console.log(`  Densities:    ${COUNTS.join(", ")} providers`)
  console.log("")

  const allBenchmarks = []
  const allAnalyses = []
  const pivotData = [] // rows for crossover analysis

  for (const count of COUNTS) {
    console.log(
      `  ─── ${count.toLocaleString()} providers (spread ${SPREAD_KM}km) ───────────────────`,
    )

    const setupStart = Date.now()
    const { count: actualCount, providers } = await setupData(count)
    const setupMs = Date.now() - setupStart
    console.log(`  Setup: ${actualCount.toLocaleString()} rows in ${setupMs}ms`)

    // ── Full scan: ST_Distance (all rows) ──────────────────────────────

    console.log("  Warming buffer cache…")
    await makeFullScan()() // cold
    await makeFullScan()() // warm
    console.log("")

    const fullScan = await bench(
      `Full Scan ST_Distance (${count.toLocaleString()})`,
      makeFullScan(),
    )
    console.log(
      `  Full Scan ST_Distance:  ${fullScan.mean.toFixed(0).padStart(7)} µs mean  (${fullScan.opsPerSec.toLocaleString()} ops/sec)`,
    )
    allBenchmarks.push(fullScan)

    // Haversine JS full scan (baseline)
    const hvFull = await bench(
      `Haversine JS Full (${count.toLocaleString()})`,
      makeHaversineFull(providers),
      100, // more iterations for fast JS
      1,
    )
    console.log(
      `  Haversine JS Full:      ${hvFull.mean.toFixed(0).padStart(7)} µs  (${hvFull.opsPerSec.toLocaleString()} ops/sec)`,
    )
    allBenchmarks.push(hvFull)

    // ── Varying radius benchmarks ──────────────────────────────────────

    console.log("")
    console.log("  ┌────────┬──────────────┬──────────────┬────────────┬──────────┬──────────┐")
    console.log("  │ Radius │ GiST DWithin │ GiST COUNT   │ Haversine  │ Rows in  │ Select.  │")
    console.log("  │   km   │    µs        │    µs        │ Filter µs  │ radius   │          │")
    console.log("  ├────────┼──────────────┼──────────────┼────────────┼──────────┼──────────┤")

    for (const radiusKm of RADII_KM) {
      // GiST ST_DWithin + ST_Distance
      const gistDW = await bench(
        `GiST DWithin ${radiusKm}km (${count.toLocaleString()})`,
        makeGiSTDWithin(radiusKm),
      )
      allBenchmarks.push(gistDW)

      // GiST COUNT (index-only)
      const gistCount = await bench(
        `GiST COUNT ${radiusKm}km (${count.toLocaleString()})`,
        makeGiSTCount(radiusKm),
        10, // fewer iterations for COUNT (very fast)
        1,
      )
      allBenchmarks.push(gistCount)

      // Haversine with manual filter
      const hvFiltered = await bench(
        `Haversine Filtered ${radiusKm}km (${count.toLocaleString()})`,
        makeHaversineFiltered(providers, radiusKm),
        100,
        1,
      )
      allBenchmarks.push(hvFiltered)

      // Get actual row count from last COUNT query execution
      const countRow = await makeGiSTCount(radiusKm)()
      const rowsInRadius = countRow

      // GiST cost analysis
      const analysis = analyzeGiSTCost(fullScan.mean, gistDW.mean, rowsInRadius, actualCount)
      allAnalyses.push({
        ...analysis,
        radiusKm,
        providerCount: actualCount,
        spreadKm: SPREAD_KM,
        countMeanUs: gistCount.mean,
        haversineFilteredUs: hvFiltered.mean,
      })

      // Pivot row for crossover analysis
      pivotData.push({
        radiusKm,
        providerCount: actualCount,
        spreadKm: SPREAD_KM,
        selectivity: analysis.selectivity,
        fullScanUs: fullScan.mean,
        dWithinUs: gistDW.mean,
        countUs: gistCount.mean,
        haversineFilteredUs: hvFiltered.mean,
        indexLookupUs: analysis.indexLookupUs,
        gistFaster: analysis.gistFasterThanFullScan,
      })

      console.log(
        `  │ ${String(radiusKm).padStart(6)} │ ${String(Math.round(gistDW.mean)).padStart(12)} │ ${String(
          Math.round(gistCount.mean),
        ).padStart(12)} │ ${String(Math.round(hvFiltered.mean)).padStart(10)} │ ${String(
          rowsInRadius,
        ).padStart(8)} │ ${(analysis.selectivity * 100).toFixed(1).padStart(7)}% │`,
      )
    }

    console.log("  └────────┴──────────────┴──────────────┴────────────┴──────────┴──────────┘")
    console.log("")

    // Teardown between densities
    await teardown()
  }

  // ── GiST overhead summary ─────────────────────────────────────────────

  console.log("╔══════════════════════════════════════════════════════════════════════╗")
  console.log("║               GiST Index Overhead — Isolated Cost                   ║")
  console.log("╚══════════════════════════════════════════════════════════════════════╝")
  console.log("")
  console.log("  Formula:  index_lookup = dwithin_time - selectivity × full_scan_time")
  console.log("")

  console.log("  ┌──────────┬────────┬────────────┬────────────┬────────────┬──────────┐")
  console.log("  │ Providers│ Radius │ Selectivity │ Full Scan  │ GiST DWith │   Index  │")
  console.log("  │          │   km   │      %      │    µs      │    µs      │ Lookup µs│")
  console.log("  ├──────────┼────────┼────────────┼────────────┼────────────┼──────────┤")

  for (const a of allAnalyses) {
    console.log(
      `  │ ${String(a.providerCount).padStart(8)} │ ${String(a.radiusKm).padStart(6)} │ ${(
        a.selectivity * 100
      )
        .toFixed(1)
        .padStart(10)} │ ${String(Math.round(a.fullScanUs)).padStart(10)} │ ${String(
        Math.round(a.dWithinUs),
      ).padStart(10)} │ ${String(Math.round(a.indexLookupUs)).padStart(8)} │`,
    )
  }

  console.log("  └──────────┴────────┴────────────┴────────────┴────────────┴──────────┘")
  console.log("")

  // ── Crossover analysis ────────────────────────────────────────────────

  console.log("╔══════════════════════════════════════════════════════════════════════╗")
  console.log("║              Crossover Analysis — When GiST Wins                     ║")
  console.log("╚══════════════════════════════════════════════════════════════════════╝")
  console.log("")

  for (const density of COUNTS) {
    const rows = pivotData.filter((p) => p.providerCount === density)

    // Find the smallest radius where GiST DWithin is faster than full scan
    const crossover = rows.find((r) => r.gistFaster)
    const notFaster = rows.filter((r) => !r.gistFaster)
    const lastNotFaster = notFaster[notFaster.length - 1]

    if (crossover) {
      console.log(`  ${density.toLocaleString()} providers (spread ${SPREAD_KM}km):`)
      console.log(`    GiST becomes faster than full scan at ~${crossover.radiusKm} km radius`)
      console.log(`    (Last radius where full scan wins: ${lastNotFaster?.radiusKm ?? "none"} km)`)
      console.log(
        `    At ${crossover.radiusKm} km: ` +
          `GiST=${Math.round(crossover.dWithinUs)}µs vs Full=${Math.round(crossover.fullScanUs)}µs` +
          ` (${Math.round((1 - crossover.dWithinUs / crossover.fullScanUs) * 100)}% faster)`,
      )
    } else {
      console.log(`  ${density.toLocaleString()} providers (spread ${SPREAD_KM}km):`)
      console.log(`    GiST is NOT faster than full scan at any tested radius`)
      console.log(
        `    (Best ratio: ${Math.round(lastNotFaster ? (lastNotFaster.dWithinUs / lastNotFaster.fullScanUs) * 100 : 0)}% at ${lastNotFaster?.radiusKm ?? "?"} km)`,
      )
    }

    // Best ratio
    const best = rows.reduce((best, r) =>
      r.dWithinUs / r.fullScanUs < best.dWithinUs / best.fullScanUs ? r : best,
    )
    console.log(
      `    Best GiST/full ratio: ${((best.dWithinUs / best.fullScanUs) * 100).toFixed(1)}% at ${best.radiusKm} km`,
    )
    console.log("")
  }

  // ── Summary table ──────────────────────────────────────────────────────

  console.log("╔══════════════════════════════════════════════════════════════════════╗")
  console.log("║                          Summary Stats                              ║")
  console.log("╚══════════════════════════════════════════════════════════════════════╝")
  console.log("")

  // Average index lookup overhead
  const lookupCosts = allAnalyses.filter((a) => a.selectivity < 0.8).map((a) => a.indexLookupUs)
  if (lookupCosts.length > 0) {
    const avgLookup = lookupCosts.reduce((s, v) => s + v, 0) / lookupCosts.length
    console.log(
      `  Average GiST index lookup overhead: ${Math.round(avgLookup)} µs` +
        ` (from ${lookupCosts.length} measurements where selectivity < 80%)`,
    )
  }

  // Average per-row GiST traversal cost
  const perRowCosts = allAnalyses
    .filter((a) => a.selectivity > 0.01 && a.selectivity < 0.8)
    .map((a) => a.indexLookupUs / a.providerCount)
  if (perRowCosts.length > 0) {
    const avgPerRow = perRowCosts.reduce((s, v) => s + v, 0) / perRowCosts.length
    console.log(`  Average per-row GiST traversal cost: ${avgPerRow.toFixed(4)} µs/row`)
  }

  // Average selectivity per radius (all densities)
  console.log("")
  console.log("  Selectivity curve (avg across densities):")
  for (const radiusKm of RADII_KM) {
    const sels = pivotData.filter((p) => p.radiusKm === radiusKm).map((p) => p.selectivity)
    if (sels.length > 0) {
      const avgSel = sels.reduce((s, v) => s + v, 0) / sels.length
      console.log(
        `    ${String(radiusKm).padStart(3)} km:  ${(avgSel * 100).toFixed(1).padStart(5)}% of rows`,
      )
    }
  }

  console.log("")

  // ── JSON output ────────────────────────────────────────────────────────

  const results = {
    meta: {
      center: CENTER,
      centerLabel: "São Paulo",
      spreadKm: SPREAD_KM,
      radiiKm: RADII_KM,
      densities: COUNTS,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
      type: "gist_index_analysis",
      dbms: dbInfo.rows[0]?.ver?.split(",")[0] ?? "?",
      postgisVersion: await checkPostGIS().catch(() => "?"),
    },
    benchmarks: allBenchmarks,
    analyses: allAnalyses,
    crossover: pivotData,
    summary: {
      avgIndexLookupUs:
        lookupCosts.length > 0
          ? Math.round(lookupCosts.reduce((s, v) => s + v, 0) / lookupCosts.length)
          : null,
      avgPerRowGiSTUs:
        perRowCosts.length > 0
          ? +(perRowCosts.reduce((s, v) => s + v, 0) / perRowCosts.length).toFixed(4)
          : null,
      selectivityByRadius: Object.fromEntries(
        RADII_KM.map((r) => [
          `${r}km`,
          +(
            (pivotData.filter((p) => p.radiusKm === r).reduce((s, p) => s + p.selectivity, 0) /
              Math.max(1, pivotData.filter((p) => p.radiusKm === r).length)) *
            100
          ).toFixed(1),
        ]),
      ),
    },
  }

  if (jsonFlag) {
    mkdirSync(dirname(jsonFile), { recursive: true })
    writeFileSync(jsonFile, JSON.stringify(results, null, 2), "utf-8")
    console.log(`  📁 Results saved to ${jsonFile}`)
    console.log("")
  }

  console.log("  Scripts for comparison:")
  const defFile = jsonFlag ? jsonFile : DEFAULT_OUT_FILE
  console.log(`    node scripts/compare-benchmarks.mjs docs/benchmarks/geo-latest.json ${defFile}`)
  console.log("")

  // Final cleanup
  if (!keepData) await teardown()
  await closeConn()
}

async function safeCleanup() {
  try {
    await teardown()
  } catch {}
  try {
    await closeConn()
  } catch {}
}

main().catch(async (e) => {
  console.error("❌ Benchmark failed:", e)
  await safeCleanup()
  process.exit(1)
})
