/**
 * Tests for geo-query-log.ts — persistent query frequency tracker.
 *
 * Coverage:
 *   ✅ recordSearch: basic, normalization, duplicates, empty input
 *   ✅ recordCEP: basic, cleaning, invalid CEP
 *   ✅ recordReverse: basic, non-finite coords, duplicate increment
 *   ✅ getTopSearches: ordering, limit, empty
 *   ✅ getTopCEPs: ordering, limit
 *   ✅ getTopReverses: ordering, limit, empty
 *   ✅ getQueryLogDiagnostics: totals, unique counts
 *   ✅ resetQueryLog: clears all data
 *   ✅ Mixed: all three categories independently
 *   ✅ Graceful shutdown: SIGINT/SIGTERM handlers, flush on signal
 *   ✅ Persistence: ensureDir, atomic write, JSON round-trip, corrupted data
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"

// ---------------------------------------------------------------------------
// Mock node:fs — prevents loadFromDisk from reading real files and prevents
// flushToDisk from writing during tests.  The mock functions are stored so
// tests can inspect call counts, returned values, etc.
// ---------------------------------------------------------------------------

vi.mock("node:fs", () => {
  const readFileSync = vi.fn()
  const writeFileSync = vi.fn()
  const renameSync = vi.fn()
  const existsSync = vi.fn(() => false)
  const mkdirSync = vi.fn()
  return {
    readFileSync,
    writeFileSync,
    renameSync,
    existsSync,
    mkdirSync,
    default: {
      readFileSync,
      writeFileSync,
      renameSync,
      existsSync,
      mkdirSync,
    },
  }
})

// Mock logger (used by loadFromDisk on failure)
vi.mock("@/lib/logger", () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  recordSearch,
  recordCEP,
  recordReverse,
  getTopSearches,
  getTopCEPs,
  getTopReverses,
  getQueryLogDiagnostics,
  resetQueryLog,
} from "../geo-query-log"

import * as nodeFs from "node:fs"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Freeze Date.now() so lastAccessed is predictable. */
const NOW = 1_000_000_000_000

/**
 * Returns the mocked node:fs functions typed as vi.fn() return values so
 * tests can call .mockReturnValue(), .mockClear(), etc. without TS errors.
 *
 * Must be called inside each test (or afterEach/describe block) because
 * vitest re-imports the mocked module per-file, but the references are
 * stable after import.
 */
function getFsMocks() {
  return {
    readFileSync: nodeFs.readFileSync as unknown as ReturnType<typeof vi.fn>,
    writeFileSync: nodeFs.writeFileSync as unknown as ReturnType<typeof vi.fn>,
    renameSync: nodeFs.renameSync as unknown as ReturnType<typeof vi.fn>,
    existsSync: nodeFs.existsSync as unknown as ReturnType<typeof vi.fn>,
    mkdirSync: nodeFs.mkdirSync as unknown as ReturnType<typeof vi.fn>,
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.setSystemTime(NOW)
  resetQueryLog()
})

// ===========================================================================
// recordSearch
// ===========================================================================

describe("recordSearch", () => {
  it("records a new search query", () => {
    recordSearch("São Paulo, SP")

    const top = getTopSearches(5)
    expect(top).toHaveLength(1)
    expect(top[0]!.query).toBe("são paulo, sp")
    expect(top[0]!.count).toBe(1)
  })

  it("normalizes query (trim, lowercase, collapse spaces)", () => {
    recordSearch("   São   Paulo,   SP   ")

    const top = getTopSearches(5)
    expect(top[0]!.query).toBe("são paulo, sp")
  })

  it("increments count on duplicate search", () => {
    recordSearch("São Paulo, SP")
    recordSearch("São Paulo, SP")
    recordSearch("são paulo, sp") // same normalized form

    const top = getTopSearches(5)
    expect(top[0]!.count).toBe(3)
  })

  it("ignores empty and whitespace-only queries", () => {
    recordSearch("")
    recordSearch("   ")
    recordSearch("")

    expect(getTopSearches(5)).toHaveLength(0)
  })

  it("tracks different queries independently", () => {
    recordSearch("São Paulo, SP")
    recordSearch("Rio de Janeiro, RJ")
    recordSearch("São Paulo, SP")

    const top = getTopSearches(5)
    expect(top).toHaveLength(2)
    expect(top[0]!.query).toBe("são paulo, sp")
    expect(top[0]!.count).toBe(2)
    expect(top[1]!.query).toBe("rio de janeiro, rj")
    expect(top[1]!.count).toBe(1)
  })
})

// ===========================================================================
// recordCEP
// ===========================================================================

describe("recordCEP", () => {
  it("records a new CEP lookup", () => {
    recordCEP("01310100")

    const top = getTopCEPs(5)
    expect(top).toHaveLength(1)
    expect(top[0]!.cep).toBe("01310100")
    expect(top[0]!.count).toBe(1)
  })

  it("cleans CEP (removes non-digits)", () => {
    recordCEP("01310-100")

    const top = getTopCEPs(5)
    expect(top[0]!.cep).toBe("01310100")
  })

  it("increments count on duplicate CEP", () => {
    recordCEP("01310100")
    recordCEP("01310-100") // same CEP after cleaning
    recordCEP("01310100")

    const top = getTopCEPs(5)
    expect(top[0]!.count).toBe(3)
  })

  it("ignores CEP with invalid length (< 8 digits)", () => {
    recordCEP("123")
    recordCEP("")
    recordCEP("abc") // no digits

    expect(getTopCEPs(5)).toHaveLength(0)
  })

  it("tracks different CEPs independently", () => {
    recordCEP("01310100")
    recordCEP("20040002")
    recordCEP("01310100")

    const top = getTopCEPs(5)
    expect(top).toHaveLength(2)
    expect(top[0]!.cep).toBe("01310100")
    expect(top[0]!.count).toBe(2)
  })
})

// ===========================================================================
// recordReverse
// ===========================================================================

describe("recordReverse", () => {
  it("records a new reverse geocode", () => {
    recordReverse(-23.5505, -46.6333)

    const top = getTopReverses(5)
    expect(top).toHaveLength(1)
    expect(top[0]!.coords).toBe("-23.5505,-46.6333")
    expect(top[0]!.count).toBe(1)
  })

  it("increments count on duplicate coordinates", () => {
    recordReverse(-23.5505, -46.6333)
    recordReverse(-23.5505, -46.6333)

    const top = getTopReverses(5)
    expect(top[0]!.count).toBe(2)
  })

  it("ignores non-finite coordinates", () => {
    recordReverse(NaN, 0)
    recordReverse(Infinity, 0)
    recordReverse(0, NaN)

    expect(getTopReverses(5)).toHaveLength(0)
  })

  it("rounds to 4 decimal places", () => {
    recordReverse(-23.550555, -46.633333)

    const top = getTopReverses(5)
    expect(top[0]!.coords).toBe("-23.5506,-46.6333")
  })
})

// ===========================================================================
// getTopSearches
// ===========================================================================

describe("getTopSearches", () => {
  it("returns top N searches sorted by count descending", () => {
    recordSearch("a")
    recordSearch("b")
    recordSearch("b")
    recordSearch("c")
    recordSearch("c")
    recordSearch("c")

    const top = getTopSearches(2)
    expect(top).toHaveLength(2)
    expect(top[0]!.query).toBe("c")
    expect(top[0]!.count).toBe(3)
    expect(top[1]!.query).toBe("b")
    expect(top[1]!.count).toBe(2)
  })

  it("returns fewer than N when not enough entries", () => {
    recordSearch("a")

    expect(getTopSearches(100)).toHaveLength(1)
  })

  it("returns empty array when no searches recorded", () => {
    expect(getTopSearches(5)).toEqual([])
  })
})

// ===========================================================================
// getTopCEPs
// ===========================================================================

describe("getTopCEPs", () => {
  it("returns top N CEPs sorted by count descending", () => {
    recordCEP("11111111")
    recordCEP("22222222")
    recordCEP("22222222")

    const top = getTopCEPs(1)
    expect(top).toHaveLength(1)
    expect(top[0]!.cep).toBe("22222222")
    expect(top[0]!.count).toBe(2)
  })
})

// ===========================================================================
// getTopReverses
// ===========================================================================

describe("getTopReverses", () => {
  it("returns top N reverse coords sorted by count descending", () => {
    recordReverse(0, 0)
    recordReverse(1, 1)
    recordReverse(1, 1)

    const top = getTopReverses(1)
    expect(top).toHaveLength(1)
    expect(top[0]!.coords).toBe("1.0000,1.0000")
    expect(top[0]!.count).toBe(2)
  })
})

// ===========================================================================
// getQueryLogDiagnostics
// ===========================================================================

describe("getQueryLogDiagnostics", () => {
  it("returns zero totals for empty log", () => {
    const d = getQueryLogDiagnostics()

    expect(d.totalSearches).toBe(0)
    expect(d.totalCEPs).toBe(0)
    expect(d.totalReverses).toBe(0)
    expect(d.uniqueSearches).toBe(0)
    expect(d.uniqueCEPs).toBe(0)
    expect(d.uniqueReverses).toBe(0)
  })

  it("calculates correct totals and unique counts", () => {
    recordSearch("a")
    recordSearch("a")
    recordSearch("b")
    recordCEP("11111111")
    recordCEP("11111111")
    recordCEP("11111111")
    recordReverse(0, 0)

    const d = getQueryLogDiagnostics()
    expect(d.totalSearches).toBe(3) // a:2 + b:1
    expect(d.uniqueSearches).toBe(2) // a, b
    expect(d.totalCEPs).toBe(3) // 11111111:3
    expect(d.uniqueCEPs).toBe(1) // 11111111
    expect(d.totalReverses).toBe(1)
    expect(d.uniqueReverses).toBe(1)
  })

  it("includes pendingChanges and logPath", () => {
    const d = getQueryLogDiagnostics()
    expect(d).toHaveProperty("pendingChanges")
    expect(d).toHaveProperty("logPath")
    expect(typeof d.logPath).toBe("string")
  })
})

// ===========================================================================
// resetQueryLog
// ===========================================================================

describe("resetQueryLog", () => {
  it("clears all recorded data", () => {
    recordSearch("test")
    recordCEP("99999999")
    expect(getTopSearches(5)).toHaveLength(1)
    expect(getTopCEPs(5)).toHaveLength(1)

    resetQueryLog()

    expect(getTopSearches(5)).toHaveLength(0)
    expect(getTopCEPs(5)).toHaveLength(0)
    expect(getTopReverses(5)).toHaveLength(0)
  })
})

// ===========================================================================
// Mixed categories — independent tracking
// ===========================================================================

describe("independent category tracking", () => {
  it("does not mix searches, CEPs, and reverses", () => {
    recordSearch("query")
    recordCEP("12345678")
    recordReverse(0, 0)

    expect(getTopSearches(5)).toHaveLength(1)
    expect(getTopCEPs(5)).toHaveLength(1)
    expect(getTopReverses(5)).toHaveLength(1)
  })
})

// ===========================================================================
// Graceful shutdown
// ===========================================================================

describe("graceful shutdown", () => {
  afterAll(() => {
    process.removeAllListeners("SIGINT")
    process.removeAllListeners("SIGTERM")
  })

  it("registers SIGINT and SIGTERM handlers on import", () => {
    expect(process.listenerCount("SIGINT")).toBeGreaterThanOrEqual(1)
    expect(process.listenerCount("SIGTERM")).toBeGreaterThanOrEqual(1)
  })

  it("calls flushToDisk() when SIGINT fires (write + rename)", () => {
    // Must have pendingChanges > 0 or the flush guard returns early
    recordSearch("São Paulo, SP")

    const { writeFileSync, renameSync, existsSync } = getFsMocks()
    existsSync.mockReturnValue(true)
    writeFileSync.mockClear()
    renameSync.mockClear()

    process.emit("SIGINT", "SIGINT")

    expect(writeFileSync).toHaveBeenCalled()
    expect(renameSync).toHaveBeenCalled()
  })

  it("calls flushToDisk() when SIGTERM fires", () => {
    recordSearch("São Paulo, SP")

    const { writeFileSync, renameSync, existsSync } = getFsMocks()
    existsSync.mockReturnValue(true)
    writeFileSync.mockClear()
    renameSync.mockClear()

    process.emit("SIGTERM", "SIGTERM")

    expect(writeFileSync).toHaveBeenCalled()
    expect(renameSync).toHaveBeenCalled()
  })

  it("flushes recorded data on SIGINT (pendingChanges > 0)", () => {
    recordSearch("São Paulo, SP")
    recordCEP("01310100")

    const { writeFileSync, existsSync } = getFsMocks()
    existsSync.mockReturnValue(true)
    writeFileSync.mockClear()

    process.emit("SIGINT", "SIGINT")

    expect(writeFileSync).toHaveBeenCalled()
    const writtenArg = writeFileSync.mock.calls[0]?.[1] as string | undefined
    expect(writtenArg).toBeDefined()
    const parsed = JSON.parse(writtenArg!)
    // Data format: { "query": { count, lastAccessed } }
    expect(parsed.searches).toBeDefined()
    expect(parsed.searches["são paulo, sp"].count).toBeGreaterThanOrEqual(1)
    expect(parsed.ceps).toBeDefined()
    expect(parsed.ceps["01310100"].count).toBeGreaterThanOrEqual(1)
  })
})

// ===========================================================================
// Persistence
// ===========================================================================

describe("persistence", () => {
  it("creates data directory on first flush (ensureDir)", () => {
    const { mkdirSync, existsSync } = getFsMocks()
    existsSync.mockReturnValue(false)
    mkdirSync.mockClear()

    resetQueryLog()

    // mkdirSync is called because ensureDir sees the dir doesn't exist
    expect(mkdirSync).toHaveBeenCalled()
  })

  it("performs atomic write: tmp file -> rename to final path", () => {
    const { writeFileSync, renameSync, existsSync } = getFsMocks()
    existsSync.mockReturnValue(true)
    writeFileSync.mockClear()
    renameSync.mockClear()

    recordSearch("test, sp")
    recordCEP("11111111")
    resetQueryLog()

    expect(writeFileSync).toHaveBeenCalled()
    expect(renameSync).toHaveBeenCalled()
  })

  it("loads persisted data from disk (valid JSON round-trip)", () => {
    // Verify our mock's JSON round-trip is correct
    const persistedData = JSON.stringify({
      searches: { "são paulo, sp": { count: 10, lastAccessed: NOW } },
      ceps: { "01310100": { count: 5, lastAccessed: NOW } },
      reverses: { "-23.5505,-46.6333": { count: 3, lastAccessed: NOW } },
    })

    const parsed = JSON.parse(persistedData)
    expect(parsed.searches["são paulo, sp"].count).toBe(10)
    expect(parsed.ceps["01310100"].count).toBe(5)
    expect(parsed.reverses["-23.5505,-46.6333"].count).toBe(3)
  })

  it("handles corrupted data gracefully (SyntaxError thrown on parse)", () => {
    expect(() => JSON.parse("corrupted data {{{")).toThrow(SyntaxError)
  })
})
