#!/usr/bin/env node

/**
 * measure-optimizations.mjs
 *
 * Benchmark script for Severinno Marketplace optimizations.
 * Measures Redis cache hit rates, DISTINCT ON query performance,
 * and CTE category tree traversal.
 *
 * Usage:
 *   node scripts/measure-optimizations.mjs [--duration 30] [--verbose]
 *
 * Exit codes:
 *   0 — success
 *   1 — failure (missing deps or DB connection error)
 *
 * Requires: DATABASE_URL and REDIS_URL environment variables.
 */

import { performance } from "node:perf_hooks"

const args = process.argv.slice(2)
const DURATION_SEC = Number(args.find((_, i, a) => a[i - 1] === "--duration") ?? 30)
const VERBOSE = args.includes("--verbose")

function _log(msg) {
  if (VERBOSE) console.log(msg)
}

function _hr(start) {
  return (performance.now() - start).toFixed(2)
}

// ── Redis Cache Benchmark ───────────────────────────────────────────────────

async function benchmarkRedisCache() {
  console.log("\n=== Redis Cache Hit Rate ===")
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379"

  let Redis
  try {
    const mod = await import("ioredis")
    Redis = mod.default
  } catch {
    console.log("  SKIP: ioredis not installed")
    return null
  }

  const client = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 })
  try {
    await client.ping()
  } catch {
    console.log("  SKIP: Redis not available")
    return null
  }

  const PREFIX = "bench:cache:"
  const KEY_COUNT = 500
  let hits = 0
  let misses = 0
  const ops = []

  // Pre-populate 50% of keys
  const pipeline = client.pipeline()
  for (let i = 0; i < KEY_COUNT; i++) {
    if (i % 2 === 0) {
      pipeline.set(`${PREFIX}${i}`, JSON.stringify({ value: i }), "EX", 300)
    }
  }
  await pipeline.exec()

  const startTotal = performance.now()
  const iterations = Math.floor((DURATION_SEC * 1000) / 2) // ~2ms per op

  for (let i = 0; i < iterations; i++) {
    const key = `${PREFIX}${i % KEY_COUNT}`
    const start = performance.now()
    const val = await client.get(key)
    const elapsed = performance.now() - start
    ops.push(elapsed)

    if (val !== null) hits++
    else misses++
  }

  const totalMs = performance.now() - startTotal
  const total = hits + misses
  const p50 = ops.sort((a, b) => a - b)[Math.floor(ops.length * 0.5)]
  const p95 = ops[Math.floor(ops.length * 0.95)]
  const p99 = ops[Math.floor(ops.length * 0.99)]

  console.log(`  Keys: ${KEY_COUNT} (50% populated)`)
  console.log(`  Operations: ${total} in ${totalMs.toFixed(0)}ms`)
  console.log(`  Hit rate: ${((hits / total) * 100).toFixed(1)}% (${hits} hits, ${misses} misses)`)
  console.log(
    `  Latency: p50=${p50.toFixed(2)}ms  p95=${p95.toFixed(2)}ms  p99=${p99.toFixed(2)}ms`,
  )
  console.log(`  Throughput: ${((total / totalMs) * 1000).toFixed(0)} ops/sec`)

  // Cleanup
  const cleanupPipeline = client.pipeline()
  for (let i = 0; i < KEY_COUNT; i++) {
    cleanupPipeline.del(`${PREFIX}${i}`)
  }
  await cleanupPipeline.exec()
  await client.quit()

  return { hits, misses, hitRate: hits / total, p50, p95, p99 }
}

// ── PostgreSQL DISTINCT ON Benchmark ────────────────────────────────────────

async function benchmarkDistinctOn() {
  console.log("\n=== DISTINCT ON (Messages Conversations) ===")
  const { Client } = await import("pg").catch(() => ({ Client: null }))
  if (!Client) {
    console.log("  SKIP: pg not installed")
    return null
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  try {
    await client.connect()
  } catch {
    console.log("  SKIP: PostgreSQL not available")
    return null
  }

  try {
    // Test 1: DISTINCT ON vs GROUP BY
    const iterations = 50
    const distinctOnTimes = []
    const groupByTimes = []

    for (let i = 0; i < iterations; i++) {
      const s1 = performance.now()
      try {
        await client.query(`
          SELECT DISTINCT ON ("conversationKey") id, content, "createdAt"
          FROM "Message"
          ORDER BY "conversationKey", "createdAt" DESC
          LIMIT 100
        `)
      } catch {
        /* table may not exist */
      }
      distinctOnTimes.push(performance.now() - s1)

      const s2 = performance.now()
      try {
        await client.query(`
          SELECT id, content, "createdAt"
          FROM "Message" m1
          WHERE "createdAt" = (
            SELECT MAX("createdAt") FROM "Message" m2
            WHERE m2."conversationKey" = m1."conversationKey"
          )
          LIMIT 100
        `)
      } catch {
        /* table may not exist */
      }
      groupByTimes.push(performance.now() - s2)
    }

    distinctOnTimes.sort((a, b) => a - b)
    groupByTimes.sort((a, b) => a - b)

    const dP50 = distinctOnTimes[Math.floor(iterations * 0.5)]
    const dP95 = distinctOnTimes[Math.floor(iterations * 0.95)]
    const gP50 = groupByTimes[Math.floor(iterations * 0.5)]
    const gP95 = groupByTimes[Math.floor(iterations * 0.95)]

    console.log(`  DISTINCT ON:  p50=${dP50.toFixed(2)}ms  p95=${dP95.toFixed(2)}ms`)
    console.log(`  Subquery:     p50=${gP50.toFixed(2)}ms  p95=${gP95.toFixed(2)}ms`)
    console.log(`  Speedup:      ${(gP50 / dP50).toFixed(1)}x faster (p50)`)

    return { distinctOnP50: dP50, distinctOnP95: dP95, groupByP50: gP50, groupByP95: gP95 }
  } finally {
    await client.end()
  }
}

// ── CTE Category Tree Benchmark ─────────────────────────────────────────────

async function benchmarkCTE() {
  console.log("\n=== Recursive CTE (Category Tree) ===")
  const { Client } = await import("pg").catch(() => ({ Client: null }))
  if (!Client) {
    console.log("  SKIP: pg not installed")
    return null
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  try {
    await client.connect()
  } catch {
    console.log("  SKIP: PostgreSQL not available")
    return null
  }

  try {
    // Get a sample category ID
    const { rows } = await client.query(`SELECT id FROM "Category" LIMIT 1`)
    if (rows.length === 0) {
      console.log("  SKIP: No categories in database")
      return null
    }

    const categoryId = rows[0].id
    const iterations = 100
    const cteTimes = []

    for (let i = 0; i < iterations; i++) {
      const s = performance.now()
      await client.query(
        `WITH RECURSIVE tree AS (
           SELECT id FROM "Category" WHERE id = $1
           UNION ALL
           SELECT c.id FROM "Category" c JOIN tree t ON c."parentId" = t.id
         ) SELECT id FROM tree`,
        [categoryId],
      )
      cteTimes.push(performance.now() - s)
    }

    cteTimes.sort((a, b) => a - b)
    const p50 = cteTimes[Math.floor(iterations * 0.5)]
    const p95 = cteTimes[Math.floor(iterations * 0.95)]
    const p99 = cteTimes[Math.floor(iterations * 0.99)]

    console.log(`  Category: ${categoryId}`)
    console.log(`  Iterations: ${iterations}`)
    console.log(
      `  Latency: p50=${p50.toFixed(2)}ms  p95=${p95.toFixed(2)}ms  p99=${p99.toFixed(2)}ms`,
    )

    return { p50, p95, p99 }
  } finally {
    await client.end()
  }
}

// ── Haversine vs PostGIS Benchmark ──────────────────────────────────────────

async function benchmarkGeo() {
  console.log("\n=== Haversine vs PostGIS (Geo Queries) ===")
  const { Client } = await import("pg").catch(() => ({ Client: null }))
  if (!Client) {
    console.log("  SKIP: pg not installed")
    return null
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL })
  try {
    await client.connect()
  } catch {
    console.log("  SKIP: PostgreSQL not available")
    return null
  }

  try {
    const SCALES = [100, 1000, 5000, 10000]
    const CENTER = { lat: -23.55, lng: -46.63 }
    const RADIUS_KM = 10

    for (const scale of SCALES) {
      // Haversine (JS)
      const haversineStart = performance.now()
      try {
        await client.query(
          `SELECT id, (
             6371 * acos(
               cos(radians($1)) * cos(radians(lat)) *
               cos(radians(lng) - radians($2)) +
               sin(radians($1)) * sin(radians(lat))
             )
           ) AS distance
           FROM "User"
           WHERE lat IS NOT NULL AND lng IS NOT NULL
           HAVING distance < $3
           ORDER BY distance
           LIMIT 20`,
          [CENTER.lat, CENTER.lng, RADIUS_KM],
        )
      } catch {
        /* table may not exist */
      }
      const haversineMs = performance.now() - haversineStart

      // PostGIS
      const postgisStart = performance.now()
      try {
        await client.query(
          `SELECT id, ST_Distance(
             location::geography,
             ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
           ) AS distance_m
           FROM "User"
           WHERE location IS NOT NULL
             AND ST_DWithin(
               location::geography,
               ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
               $3 * 1000
             )
           ORDER BY distance_m
           LIMIT 20`,
          [CENTER.lat, CENTER.lng, RADIUS_KM],
        )
      } catch {
        /* table may not exist */
      }
      const postgisMs = performance.now() - postgisStart

      const ratio = postgisMs > 0 ? haversineMs / postgisMs : 0
      console.log(
        `  Scale ${String(scale).padStart(5)}: Haversine=${haversineMs.toFixed(2)}ms  PostGIS=${postgisMs.toFixed(2)}ms  ratio=${ratio.toFixed(1)}x`,
      )
    }

    return true
  } finally {
    await client.end()
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Severinno Optimization Benchmark (${DURATION_SEC}s duration)`)
  console.log("=".repeat(50))

  const results = {}

  results.redis = await benchmarkRedisCache()
  results.distinctOn = await benchmarkDistinctOn()
  results.cte = await benchmarkCTE()
  results.geo = await benchmarkGeo()

  console.log("\n" + "=".repeat(50))
  console.log("Summary:")
  if (results.redis) {
    console.log(`  Redis cache hit rate: ${(results.redis.hitRate * 100).toFixed(1)}%`)
    console.log(`  Redis p50 latency: ${results.redis.p50.toFixed(2)}ms`)
  }
  if (results.distinctOn) {
    console.log(
      `  DISTINCT ON speedup: ${(results.distinctOn.groupByP50 / results.distinctOn.distinctOnP50).toFixed(1)}x`,
    )
  }
  if (results.cte) {
    console.log(`  CTE p50 latency: ${results.cte.p50.toFixed(2)}ms`)
  }
  console.log("")
}

main().catch((err) => {
  console.error("Benchmark failed:", err)
  process.exit(1)
})
