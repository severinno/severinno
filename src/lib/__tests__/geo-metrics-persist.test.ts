/**
 * geo-metrics-persist.test.ts
 *
 * Unit tests for geo-metrics-persist.ts.
 *
 * Tests cover edge cases not covered by the integration test:
 *   - Corrupt/malformed snapshot files
 *   - Rotation (MAX_SNAPSHOTS enforcement)
 *   - Cache TTL invalidation
 *   - getSnapshotsDir()
 *
 * Strategy:
 *   - vi.hoisted() sets GEO_METRICS_SNAPSHOTS_DIR BEFORE module imports
 *   - Complete node:fs mock (no importOriginal) for full virtual filesystem
 *   - PersistedSnapshot type is imported for type safety only
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"

// ---------------------------------------------------------------------------
// Set env var BEFORE module imports (hoisted runs first)
// ---------------------------------------------------------------------------

vi.hoisted(() => {
  process.env.GEO_METRICS_SNAPSHOTS_DIR = "/tmp/geo-test-persist"
})

// ---------------------------------------------------------------------------
// Virtual filesystem — shared mutable state for mock fs operations
// ---------------------------------------------------------------------------

interface VirtualFile {
  name: string
  content: string
}

const virtualDir: VirtualFile[] = []

let mockExists = true
let mockReaddirShouldThrow = false
let mockMkdirShouldThrow = false
let mockUnlinkShouldThrow = false

// ---------------------------------------------------------------------------
// Mock node:fs — complete mock, no importOriginal
// ---------------------------------------------------------------------------

function populateVirtualDir(): Array<{ name: string; isFile: () => boolean }> {
  return virtualDir.map((f) => ({ name: f.name, isFile: () => true }))
}

vi.mock("node:fs", () => {
  const readFileSync = (path: string) => {
    const name = path.split("/").pop() ?? path.split("\\").pop() ?? ""
    const file = virtualDir.find((f) => f.name === name)
    if (!file) {
      const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException
      err.code = "ENOENT"
      throw err
    }
    return file.content
  }
  const writeFileSync = (_path: string, content: string) => {
    const name = _path.split("/").pop() ?? _path.split("\\").pop() ?? ""
    const idx = virtualDir.findIndex((f) => f.name === name)
    if (idx >= 0) {
      virtualDir[idx] = { name, content }
    } else {
      virtualDir.push({ name, content })
    }
  }
  const readdirSync = () => {
    if (mockReaddirShouldThrow) throw new Error("readdir failed")
    return populateVirtualDir()
  }
  const unlinkSync = (path: string) => {
    if (mockUnlinkShouldThrow) throw new Error("unlink failed")
    const name = path.split("/").pop() ?? path.split("\\").pop() ?? ""
    const idx = virtualDir.findIndex((f) => f.name === name)
    if (idx >= 0) virtualDir.splice(idx, 1)
  }
  const existsSync = () => mockExists
  const mkdirSync = () => {
    if (mockMkdirShouldThrow) throw new Error("mkdir failed")
  }
  return {
    default: {
      readFileSync,
      writeFileSync,
      readdirSync,
      unlinkSync,
      existsSync,
      mkdirSync,
    },
    readFileSync,
    writeFileSync,
    readdirSync,
    unlinkSync,
    existsSync,
    mkdirSync,
  }
})

vi.mock("node:path", () => {
  const join = (...parts: string[]) => parts.join("/")
  const basename = (path: string) => path.split("/").pop() ?? path
  return {
    default: { join, basename },
    join,
    basename,
  }
})

// ---------------------------------------------------------------------------
// Other mocks
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}))

vi.mock("../logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ── Mock Redis cache: in-memory store controlled by the test ──────────────
// This replaces the real Redis-backed cache with a simple Map so tests
// are deterministic and don't require a real Redis instance.

const redisStore = new Map<string, { value: string; expiresAt: number | null }>()

vi.mock("../redis", () => ({
  cacheGet: async <T>(key: string): Promise<T | null> => {
    const item = redisStore.get(key)
    if (!item) return null
    if (item.expiresAt !== null && item.expiresAt < Date.now()) {
      redisStore.delete(key)
      return null
    }
    return JSON.parse(item.value) as T
  },
  cacheSet: async (key: string, value: unknown, ttl?: number): Promise<void> => {
    const expiresAt = ttl !== undefined && ttl > 0 ? Date.now() + ttl * 1000 : null
    redisStore.set(key, { value: JSON.stringify(value), expiresAt })
  },
  cacheInvalidate: async (pattern: string): Promise<void> => {
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1)
      for (const key of redisStore.keys()) {
        if (key.startsWith(prefix)) redisStore.delete(key)
      }
    } else {
      redisStore.delete(pattern)
    }
  },
}))

// ---------------------------------------------------------------------------
// Imports — type PersistedSnapshot for the type only
// ---------------------------------------------------------------------------

import {
  persistSnapshot,
  loadPersistedSnapshots,
  flushGeoMetrics,
  getSnapshotCount,
  getSnapshotsDir,
  resetCacheFlags,
  wasSnapshotCacheHit,
  wasCountCacheHit,
} from "../geo-metrics-persist"
import type { PersistedSnapshot } from "../geo-metrics-persist"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a valid snapshot object. */
function makeSnapshot(ts: number, overrides?: Partial<PersistedSnapshot>): PersistedSnapshot {
  return {
    timestamp: ts,
    services: {
      nominatim: { p50: 100, p95: 200, p99: 400, count: 50 },
      viacep: { p50: 60, p95: 120, p99: 240, count: 30 },
      postgis: { p50: 8, p95: 15, p99: 30, count: 200 },
    },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  virtualDir.length = 0
  mockExists = true
  mockReaddirShouldThrow = false
  mockMkdirShouldThrow = false
  mockUnlinkShouldThrow = false
  redisStore.clear()
  vi.clearAllMocks()
  // Invalidate the Redis cache so each test starts fresh
  await flushGeoMetrics()
})

afterAll(() => {
  delete process.env.GEO_METRICS_SNAPSHOTS_DIR
})

// ═══════════════════════════════════════════════════════════════════════════
// Corrupt file handling
// ═══════════════════════════════════════════════════════════════════════════

describe("loadPersistedSnapshots — corrupt file handling", () => {
  it("skips files with invalid JSON content", async () => {
    const valid = makeSnapshot(1000)
    virtualDir.push(
      { name: "snap-1000.json", content: JSON.stringify(valid) },
      { name: "snap-2000.json", content: "not valid json {{{{" },
    )

    const result = await loadPersistedSnapshots()
    expect(result).toHaveLength(1)
    expect(result[0]!.timestamp).toBe(1000)
  })

  it("skips files with missing timestamp field", async () => {
    virtualDir.push({
      name: "snap-3000.json",
      content: JSON.stringify({
        services: { nominatim: { p50: 100, p95: 200, p99: 400, count: 50 } },
      }),
    })

    const result = await loadPersistedSnapshots()
    expect(result).toHaveLength(0)
  })

  it("skips files with missing services object", async () => {
    virtualDir.push({
      name: "snap-4000.json",
      content: JSON.stringify({ timestamp: 4000 }),
    })

    const result = await loadPersistedSnapshots()
    expect(result).toHaveLength(0)
  })

  it("skips files with non-object services", async () => {
    virtualDir.push({
      name: "snap-5000.json",
      content: JSON.stringify({ timestamp: 5000, services: "not-an-object" }),
    })

    const result = await loadPersistedSnapshots()
    expect(result).toHaveLength(0)
  })

  it("loads valid files even when mixed with corrupt ones", async () => {
    const valid1 = makeSnapshot(100)
    const valid2 = makeSnapshot(200)
    virtualDir.push(
      { name: "snap-100.json", content: JSON.stringify(valid1) },
      { name: "snap-corrupt.json", content: "{broken}" },
      { name: "not-a-snap.log", content: "ignored" },
      { name: "snap-200.json", content: JSON.stringify(valid2) },
    )

    const result = await loadPersistedSnapshots()
    expect(result).toHaveLength(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Cache TTL and invalidation
// ═══════════════════════════════════════════════════════════════════════════

describe("loadPersistedSnapshots cache behavior", () => {
  it("returns cached data on repeated calls within TTL", async () => {
    const snap = makeSnapshot(100)
    virtualDir.push({ name: "snap-100.json", content: JSON.stringify(snap) })
    const first = await loadPersistedSnapshots()
    expect(first).toHaveLength(1)

    // Add a new file — cache should return stale data
    const snap2 = makeSnapshot(200)
    virtualDir.push({ name: "snap-200.json", content: JSON.stringify(snap2) })

    const second = await loadPersistedSnapshots()
    expect(second).toHaveLength(1) // Still 1 (cached), not 2
  })

  it("flushGeoMetrics invalidates cache forcing re-read", async () => {
    const snap = makeSnapshot(100)
    virtualDir.push({ name: "snap-100.json", content: JSON.stringify(snap) })
    await loadPersistedSnapshots() // populate cache

    // Add new file and flush
    const snap2 = makeSnapshot(200)
    virtualDir.push({ name: "snap-200.json", content: JSON.stringify(snap2) })
    await flushGeoMetrics() // invalidates cache

    // Next call should re-read from disk
    const result = await loadPersistedSnapshots()
    expect(result).toHaveLength(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// getSnapshotsDir
// ═══════════════════════════════════════════════════════════════════════════

describe("getSnapshotsDir", () => {
  it("returns the configured snapshots directory from env", () => {
    const dir = getSnapshotsDir()
    expect(dir).toBe("/tmp/geo-test-persist")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// persistSnapshot — debounce behavior
// ═══════════════════════════════════════════════════════════════════════════

describe("persistSnapshot — debounce", () => {
  it("queues only the last snapshot when multiple calls within debounce window", async () => {
    const snap1 = makeSnapshot(100)
    const snap2 = makeSnapshot(200)

    persistSnapshot(snap1)
    persistSnapshot(snap2) // replaces pending

    // Before flush, nothing is written to virtual disk
    expect(await getSnapshotCount()).toBe(0)

    // Flush writes only snap2 (the latest)
    await flushGeoMetrics()
    expect(await getSnapshotCount()).toBe(1)

    // Verify it's snap2 by loading and checking timestamp
    const loaded = await loadPersistedSnapshots()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.timestamp).toBe(200)
  })

  it("does not write if no snapshot was queued", async () => {
    await flushGeoMetrics()
    expect(await getSnapshotCount()).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Cache status flags (wasSnapshotCacheHit / wasCountCacheHit)
// ═══════════════════════════════════════════════════════════════════════════

describe("cache status flags — X-Snapshots-Cache lifecycle", () => {
  it("first call → miss (loads from disk)", async () => {
    virtualDir.push({
      name: "snap-100.json",
      content: JSON.stringify(makeSnapshot(100)),
    })

    resetCacheFlags()
    await loadPersistedSnapshots()
    expect(wasSnapshotCacheHit()).toBe(false)
  })

  it("second call within TTL → hit (returns cache)", async () => {
    virtualDir.push({
      name: "snap-100.json",
      content: JSON.stringify(makeSnapshot(100)),
    })

    // First call — populate cache
    resetCacheFlags()
    const first = await loadPersistedSnapshots()
    expect(wasSnapshotCacheHit()).toBe(false)
    expect(first).toHaveLength(1)

    // Second call — within TTL, should hit cache
    resetCacheFlags()
    const second = await loadPersistedSnapshots()
    expect(wasSnapshotCacheHit()).toBe(true)
    expect(second).toEqual(first) // same data (cached)
    expect(second).toHaveLength(1)
  })

  it("writeSnapshot via persistSnapshot + flush invalidates both caches", async () => {
    virtualDir.push({
      name: "snap-100.json",
      content: JSON.stringify(makeSnapshot(100)),
    })

    // Populate both caches
    resetCacheFlags()
    await loadPersistedSnapshots()
    await getSnapshotCount()
    expect(wasSnapshotCacheHit()).toBe(false)
    expect(wasCountCacheHit()).toBe(false)

    // Write a new snapshot — this should invalidate both caches
    persistSnapshot(makeSnapshot(200))
    await flushGeoMetrics()

    // loadPersistedSnapshots should now miss (cache invalidated)
    resetCacheFlags()
    const loaded = await loadPersistedSnapshots()
    expect(wasSnapshotCacheHit()).toBe(false)
    expect(loaded).toHaveLength(2)

    // getSnapshotCount should also miss (count cache invalidated)
    resetCacheFlags()
    await getSnapshotCount()
    expect(wasCountCacheHit()).toBe(false)
  })

  it("sequential: miss → hit → invalidate → miss", async () => {
    virtualDir.push({
      name: "snap-1.json",
      content: JSON.stringify(makeSnapshot(1)),
    })

    // ── Phase 1: MISS ──
    resetCacheFlags()
    await loadPersistedSnapshots()
    expect(wasSnapshotCacheHit()).toBe(false)

    // ── Phase 2: HIT ──
    resetCacheFlags()
    await loadPersistedSnapshots()
    expect(wasSnapshotCacheHit()).toBe(true)

    // ── Phase 3: writeSnapshot invalidates ──
    persistSnapshot(makeSnapshot(2))
    await flushGeoMetrics()

    // ── Phase 4: MISS again ──
    resetCacheFlags()
    await loadPersistedSnapshots()
    expect(wasSnapshotCacheHit()).toBe(false)
    expect(await loadPersistedSnapshots()).toHaveLength(2)
  })

  it("flushGeoMetrics without pending snapshot still invalidates cache", async () => {
    virtualDir.push({
      name: "snap-100.json",
      content: JSON.stringify(makeSnapshot(100)),
    })

    // Populate cache
    await loadPersistedSnapshots()

    // Flush without any pending snapshot
    resetCacheFlags()
    await flushGeoMetrics()

    // Cache should still be invalidated
    resetCacheFlags()
    await loadPersistedSnapshots()
    expect(wasSnapshotCacheHit()).toBe(false)
  })

  it("getSnapshotCount cache: first miss → second hit → write invalidates", async () => {
    virtualDir.push({ name: "snap-100.json", content: JSON.stringify(makeSnapshot(100)) })

    // First call — count from disk
    resetCacheFlags()
    const c1 = await getSnapshotCount()
    expect(wasCountCacheHit()).toBe(false)
    expect(c1).toBe(1)

    // Second call — cached count
    resetCacheFlags()
    const c2 = await getSnapshotCount()
    expect(wasCountCacheHit()).toBe(true)
    expect(c2).toBe(1)

    // Write invalidates count cache
    persistSnapshot(makeSnapshot(200))
    await flushGeoMetrics()

    resetCacheFlags()
    const c3 = await getSnapshotCount()
    expect(wasCountCacheHit()).toBe(false)
    expect(c3).toBe(2)
  })

  it("count cache returns 0 without crash when directory doesn't exist", async () => {
    mockExists = false

    resetCacheFlags()
    const count = await getSnapshotCount()
    expect(wasCountCacheHit()).toBe(false)
    expect(count).toBe(0)

    // Second call — now the count 0 should be cached
    resetCacheFlags()
    const c2 = await getSnapshotCount()
    expect(wasCountCacheHit()).toBe(true)
    expect(c2).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("edge cases", () => {
  it("getSnapshotCount returns 0 when directory doesn't exist", async () => {
    mockExists = false
    const count = await getSnapshotCount()
    expect(count).toBe(0)
  })

  it("getSnapshotCount returns 0 on readdir failure", async () => {
    mockReaddirShouldThrow = true
    const count = await getSnapshotCount()
    expect(count).toBe(0)
  })

  it("loadPersistedSnapshots returns [] on readdir failure", async () => {
    mockReaddirShouldThrow = true
    const result = await loadPersistedSnapshots()
    expect(result).toEqual([])
  })

  it("persistSnapshot and flush handle mkdir failure gracefully", async () => {
    // Directory doesn't exist, so ensureDir() will try mkdir
    mockExists = false
    mockMkdirShouldThrow = true
    persistSnapshot(makeSnapshot(999))
    await flushGeoMetrics()
    // Snapshot was not written (mkdir failed)
    expect(await getSnapshotCount()).toBe(0)
  })

  it("rotation handles unlink failure gracefully", async () => {
    mockUnlinkShouldThrow = true
    // Create many snapshots
    for (let i = 0; i < 1050; i++) {
      virtualDir.push({
        name: `snap-${i}.json`,
        content: JSON.stringify(makeSnapshot(i)),
      })
    }
    // Write one more to trigger rotation
    persistSnapshot(makeSnapshot(5000))
    await flushGeoMetrics()
    // Should not throw despite unlink failures
    expect(await getSnapshotCount()).toBeGreaterThanOrEqual(1)
  })
})
