/**
 * E2E test for Redis caching of PostGIS proximity queries.
 *
 * Verifies:
 *   1. findProvidersWithinRadius returns providers and caches result in Redis
 *   2. Cache key exists (SCAN match 'proximity:*')
 *   3. Repeat query returns same result (from cache)
 *   4. Redis goes offline -> function degrades gracefully (PostGIS fallback)
 *   5. Redis comes back -> new query is re-cached
 *
 * Usage:
 *   # Start test infrastructure
 *   docker compose -f docker-compose.test.yml up -d postgis redis
 *
 *   # Wait for DB to be ready, then run schema setup
 *   # (assumes postgis extension + location column are already present)
 *
 *   # Run the test
 *   DATABASE_URL="postgresql://severinno:severinno_test@localhost:5433/severinno_test" \
 *   REDIS_URL="redis://localhost:6381" \
 *   bun scripts/test-redis-cache.ts
 */

import { PrismaClient } from "@prisma/client"
import { Redis } from "ioredis"
import { execSync } from "child_process"

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

if (!process.env.DATABASE_URL) {
  console.error("  DATABASE_URL not set. See usage comment at the top of this script.")
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const COMPOSE_FILE = "docker-compose.test.yml"
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6381"
const CENTER_LAT = -19.8125
const CENTER_LNG = -41.9736
const RADIUS_KM = 50

// ---------------------------------------------------------------------------
// Track test data for cleanup
// ---------------------------------------------------------------------------

const seededEmails: string[] = []

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(label: string, msg: string) {
  console.log(`  ${label.padEnd(12)} ${msg}`)
}

function pass(msg: string) {
  console.log(`  + ${msg}`)
}

function fail(msg: string) {
  console.log(`  x ${msg}`)
}

function divider(title: string) {
  console.log(`\n  --- ${title} ${"-".repeat(60)}`)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Run a docker compose command and return stdout. Fails silently. */
function dockerCmd(args: string): string {
  try {
    return execSync(`docker compose -f ${COMPOSE_FILE} ${args}`, {
      encoding: "utf-8",
      timeout: 30_000,
    }).trim()
  } catch {
    return ""
  }
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

async function setupDatabase(db: PrismaClient) {
  divider("SETUP")

  // Verify PostGIS extension
  const pgCheck = await db.$queryRaw<Array<{ available: boolean }>>`
    SELECT true AS available
    FROM pg_extension
    WHERE extname = 'postgis'
  `
  if (!(pgCheck.length > 0 && pgCheck[0]?.available === true)) {
    throw new Error("PostGIS extension not available in test database")
  }
  log("DB", "PostGIS extension available")

  // Verify location column exists
  const colCheck = await db.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'location'
  `
  if (colCheck.length === 0) {
    throw new Error("location column not found on User table")
  }
  log("DB", "location column exists")
}

async function seedTestData(db: PrismaClient) {
  divider("SEED DATA")

  const providers = [
    { name: "Cache Test Provider A", lat: CENTER_LAT + 0.05, lng: CENTER_LNG + 0.03 },
    { name: "Cache Test Provider B", lat: CENTER_LAT - 0.07, lng: CENTER_LNG - 0.04 },
    { name: "Cache Test Provider C", lat: CENTER_LAT + 0.15, lng: CENTER_LNG - 0.1 },
  ]

  for (const p of providers) {
    const email = `cache-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`
    seededEmails.push(email)
    const id = `cache-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    await db.$executeRawUnsafe(
      `INSERT INTO "User" (id, email, "passwordHash", name, role, lat, lng, active, verified)
       VALUES ($1, $2, 'test-hash', $3, 'PROVIDER', $4, $5, true, true)`,
      id,
      email,
      p.name,
      p.lat,
      p.lng,
    )
    log("SEED", `Created provider ${p.name} (${email})`)
  }

  // Verify the trigger synced location
  const count = await db.$queryRaw<Array<{ cnt: bigint }>>`
    SELECT COUNT(*)::bigint AS cnt FROM "User"
    WHERE email = ANY($1::text[]) AND location IS NOT NULL
  `
  const synced = Number(count[0]?.cnt ?? 0)
  if (synced === providers.length) {
    pass(`Trigger synced location for all ${providers.length} providers`)
  } else {
    fail(`Expected ${providers.length} synced locations, got ${synced}`)
  }
}

async function cleanupTestData(db: PrismaClient) {
  divider("CLEANUP")
  if (seededEmails.length === 0) {
    log("CLEANUP", "No test data to clean up")
    return
  }

  for (const email of seededEmails) {
    try {
      await db.$executeRawUnsafe(`DELETE FROM "User" WHERE email = $1`, email)
    } catch {
      // ignore cleanup errors
    }
  }
  log("CLEANUP", `Deleted ${seededEmails.length} test providers`)
  seededEmails.length = 0
}

// ---------------------------------------------------------------------------
// Test steps
// ---------------------------------------------------------------------------

async function testRedisCache() {
  divider("TEST REDIS CACHE - PostGIS Proximity")
  let passed = 0
  let failed = 0

  // Step 1: Import the real function (dynamic import so env vars are set)
  const { findProvidersWithinRadius } = await import("../src/lib/postgis")

  // -----------------------------------------------------------------------
  // STEP 1 — First query (cache miss -> PostGIS)
  // -----------------------------------------------------------------------
  divider("STEP 1: First query (cache miss -> PostGIS)")

  const result1 = await findProvidersWithinRadius(CENTER_LAT, CENTER_LNG, RADIUS_KM)
  const count1 = result1.length

  if (count1 > 0) {
    pass(`Found ${count1} providers within ${RADIUS_KM}km`)
    passed++
  } else {
    fail(`Expected >0 providers, got ${count1}`)
    failed++
  }

  // -----------------------------------------------------------------------
  // STEP 2 — Verify cache key exists in Redis (SCAN + GET)
  // -----------------------------------------------------------------------
  divider("STEP 2: Verify cache entry in Redis")

  const verifyRedis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
    enableOfflineQueue: false,
  })

  try {
    // SCAN with COUNT 1000 — sufficient for our few keys
    const [_cursor, keys] = await verifyRedis.scan(0, "MATCH", "proximity:*", "COUNT", "1000")
    const cacheKeys = keys.filter((k) => k.startsWith("proximity:"))

    if (cacheKeys.length > 0) {
      pass(`Cache keys found in Redis: ${cacheKeys.join(", ")}`)

      // Read the cached value and compare with query result
      const cachedRaw = await verifyRedis.get(cacheKeys[0])
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw) as Array<{ id: string; distanceKm: number }>
        if (cached.length === count1) {
          pass(`Cached data matches query result (${cached.length} items)`)
          passed++
        } else {
          fail(`Cached count (${cached.length}) != query count (${count1})`)
          failed++
        }

        // Verify distance values match (within 0.01 km tolerance)
        const distDiff = result1.every((r) => {
          const cachedItem = cached.find((c) => c.id === r.id)
          return cachedItem && Math.abs(cachedItem.distanceKm - r.distanceKm) < 0.01
        })
        if (distDiff) {
          pass("Distance values match between query and cache")
          passed++
        } else {
          fail("Distance values differ between query and cache")
          failed++
        }
      } else {
        fail("Could not read cached value from Redis")
        failed++
      }
    } else {
      fail(`No 'proximity:*' keys found in Redis`)
      failed++
    }
  } catch (e) {
    fail(`Redis verification failed: ${e instanceof Error ? e.message : e}`)
    failed++
  } finally {
    verifyRedis.disconnect()
  }

  // -----------------------------------------------------------------------
  // STEP 3 — Same query again (cache hit -> same result)
  // -----------------------------------------------------------------------
  divider("STEP 3: Repeat query (cache hit -> same result)")

  const result2 = await findProvidersWithinRadius(CENTER_LAT, CENTER_LNG, RADIUS_KM)

  // Count match
  if (result2.length === count1) {
    pass(`Same number of providers: ${count1}`)
    passed++
  } else {
    fail(`Count changed: ${count1} -> ${result2.length}`)
    failed++
  }

  // ID match
  const ids1 = new Set(result1.map((r) => r.id))
  const sameIds = result2.every((r) => ids1.has(r.id))
  if (sameIds) {
    pass("All provider IDs match between queries")
    passed++
  } else {
    fail("Provider IDs differ between queries")
    failed++
  }

  // Distance match (within tolerance)
  const distMatch = result2.every((r, i) => {
    const r1 = result1[i]
    return r1 && Math.abs(r.distanceKm - r1.distanceKm) < 0.01
  })
  if (distMatch) {
    pass("Distance values match between queries")
    passed++
  } else {
    fail("Distance values differ between queries")
    failed++
  }

  // -----------------------------------------------------------------------
  // STEP 4 — Stop Redis -> fallback query (graceful degradation)
  // -----------------------------------------------------------------------
  divider("STEP 4: Stop Redis -> fallback query")

  log("DOCKER", "Stopping Redis container...")
  dockerCmd("stop redis") // fails silently if already stopped
  await sleep(2000)

  // Confirm Redis is offline
  const checkRedis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
    enableOfflineQueue: false,
  })

  let redisOffline = false
  try {
    await checkRedis.ping()
  } catch {
    redisOffline = true
  } finally {
    checkRedis.disconnect()
  }

  if (redisOffline) {
    pass("Redis is offline (confirmed)")
    passed++
  } else {
    fail("Redis is still responding — cannot test offline scenario")
    failed++
  }

  // Query with Redis offline — should fall back to PostGIS
  const result3 = await findProvidersWithinRadius(CENTER_LAT, CENTER_LNG, RADIUS_KM)

  if (result3.length === count1) {
    pass(`Same ${count1} providers returned (PostGIS fallback)`)
    passed++
  } else {
    fail(`Expected ${count1} providers, got ${result3.length}`)
    failed++
  }

  // Verify IDs and distances still match
  const _ids3 = new Set(result3.map((r) => r.id))
  const sameIds2 = result3.every((r) => ids1.has(r.id))
  if (sameIds2) {
    pass("All provider IDs match even with Redis offline")
    passed++
  } else {
    fail("Provider IDs differ with Redis offline")
    failed++
  }

  const distMatch2 = result3.every((r, i) => {
    const r1 = result1[i]
    return r1 && Math.abs(r.distanceKm - r1.distanceKm) < 0.01
  })
  if (distMatch2) {
    pass("Distance values match with Redis offline (PostGIS fallback)")
    passed++
  } else {
    fail("Distance values differ with Redis offline")
    failed++
  }

  // -----------------------------------------------------------------------
  // STEP 5 — Restart Redis -> re-caching
  // -----------------------------------------------------------------------
  divider("STEP 5: Restart Redis -> re-caching")

  log("DOCKER", "Starting Redis container...")
  dockerCmd("start redis")

  // Wait for healthcheck (up to 30s)
  let healthy = false
  for (let i = 0; i < 15; i++) {
    try {
      const status = dockerCmd(`ps --filter "name=redis" --format "{{.Status}}"`)
      if (status.includes("healthy") || status.includes("up")) {
        healthy = true
        break
      }
    } catch {
      // still starting
    }
    await sleep(2000)
  }

  if (healthy) {
    pass("Redis container restarted and healthy")
    passed++
  } else {
    fail("Redis did not become healthy in time")
    failed++
    log("WARN", "Skipping re-cache verification...")
  }

  // Fresh query — should re-populate cache
  const result4 = await findProvidersWithinRadius(CENTER_LAT, CENTER_LNG, RADIUS_KM)

  if (result4.length === count1) {
    pass(`Same ${count1} providers after Redis restart`)
    passed++
  } else {
    fail(`Expected ${count1} providers, got ${result4.length}`)
    failed++
  }

  // Verify new cache key exists
  const verifyRedis2 = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    lazyConnect: true,
    enableOfflineQueue: false,
  })

  try {
    const [, keys2] = await verifyRedis2.scan(0, "MATCH", "proximity:*", "COUNT", "1000")
    const cacheKeys2 = keys2.filter((k) => k.startsWith("proximity:"))

    if (cacheKeys2.length > 0) {
      pass(`Cache re-populated: ${cacheKeys2.join(", ")}`)
      passed++
    } else {
      fail("No cache keys found after Redis restart")
      failed++
    }

    // Verify cached data matches
    const cachedRaw2 = await verifyRedis2.get(cacheKeys2[0])
    if (cachedRaw2) {
      const cached2 = JSON.parse(cachedRaw2) as Array<{ id: string; distanceKm: number }>
      if (cached2.length === count1) {
        pass("Re-cached data is consistent")
        passed++
      } else {
        fail(`Re-cached count (${cached2.length}) != ${count1}`)
        failed++
      }
    }
  } catch (e) {
    fail(`Re-cache verification failed: ${e instanceof Error ? e.message : e}`)
    failed++
  } finally {
    verifyRedis2.disconnect()
  }

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  divider("RESULTS")
  console.log(`  ${passed} passed, ${failed} failed, ${passed + failed} total`)

  return failed === 0
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Wait for a container to be healthy by checking its status in docker ps. */
async function waitForHealthy(containerName: string, maxRetries = 15): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    const status = dockerCmd(`ps --filter "name=${containerName}" --format "{{.Status}}"`)
    if (status.includes("healthy") || status.includes("up")) return true
    await sleep(2000)
  }
  return false
}

async function main() {
  // Start test infrastructure (no-op if already running)
  log("DOCKER", "Starting test containers...")
  dockerCmd("up -d postgis redis")

  // Wait for both containers to be healthy before proceeding
  const pgReady = await waitForHealthy("postgis")
  const redisReady = await waitForHealthy("redis")

  if (!pgReady) {
    console.error("  PostGIS container did not become healthy in time")
    process.exit(1)
  }
  log("DOCKER", "PostGIS container healthy")

  const db = new PrismaClient()

  // Flush Redis to remove stale cache entries from prior runs
  if (redisReady) {
    const cleanupRedis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      lazyConnect: true,
      enableOfflineQueue: false,
    })
    try {
      await cleanupRedis.flushall()
      log("REDIS", "Flushed all keys (clean state)")
    } catch {
      log("REDIS", "Could not flush Redis")
    } finally {
      cleanupRedis.disconnect()
    }
  } else {
    log("REDIS", "Redis not healthy — running without cache verification")
  }

  try {
    await setupDatabase(db)
    await seedTestData(db)

    const success = await testRedisCache()

    if (!success) {
      console.log("\n  TEST FAILED - see errors above")
      process.exit(1)
    }

    console.log("\n  All tests passed!\n")
  } catch (e) {
    console.error("\n  Test suite crashed:", e instanceof Error ? e.message : e)
    process.exit(1)
  } finally {
    await cleanupTestData(db)
    await db.$disconnect()
  }
}

main()
