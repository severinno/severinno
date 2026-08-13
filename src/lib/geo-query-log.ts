/**
 * geo-query-log.ts
 *
 * Persistent query frequency tracker for geo queries.
 *
 * Records every user geo query (search, CEP, reverse) with its frequency
 * so the most popular queries can be pre-warmed in Redis after a server
 * restart.
 *
 * Data flow:
 *   1. User searches "são paulo, sp" →
 *   2. geo.ts calls recordSearch("são paulo, sp") →
 *   3. geo-query-log increments count in memory →
 *   4. After debounce, persists to disk (JSON) →
 *   5. On next server restart, geo-startup-warm.ts reads the log →
 *   6. Top 20 searches + top 20 CEPs are pre-warmed in Redis
 *
 * Persistence:
 *   - Writes to a JSON file in a configurable path (default: data/geo-query-log.json)
 *   - Atomic writes (write to .tmp, then rename)
 *   - Debounced: batches writes every 30s after the last change
 *   - Graceful shutdown: flushes pending writes
 *
 * Thread-safety:
 *   - All operations are synchronous (single-threaded Node.js)
 *   - The JSON file is read once on module load, written atomically
 *   - Multiple processes: NOT safe (but fine for single-server / container)
 */

import "server-only"
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import logger from "./logger"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QueryLogCategory = "search" | "cep" | "reverse"

interface LogEntryData {
  count: number
  lastAccessed: number
}

interface QueryLogData {
  searches: Record<string, LogEntryData>
  ceps: Record<string, LogEntryData>
  reverses: Record<string, LogEntryData>
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const LOG_PATH = process.env.GEO_QUERY_LOG_PATH ?? join(process.cwd(), "data", "geo-query-log.json")

/** Debounce interval: persist at most once per 30s. */
const DEBOUNCE_MS = 30_000

/** If we accumulate this many changes, flush immediately (safety valve). */
const MAX_PENDING_CHANGES = 100

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

let data: QueryLogData = { searches: {}, ceps: {}, reverses: {} }
let dirty = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingChanges = 0

// ---------------------------------------------------------------------------
// Load on module init
// ---------------------------------------------------------------------------

function ensureDir(): void {
  const dir = join(LOG_PATH, "..")
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function loadFromDisk(): void {
  try {
    if (!existsSync(LOG_PATH)) {
      data = { searches: {}, ceps: {}, reverses: {} }
      return
    }
    const raw = readFileSync(LOG_PATH, "utf-8")
    data = JSON.parse(raw) as QueryLogData

    // Normalize: ensure all sections exist (in case of partial writes or old format)
    if (!data.searches) data.searches = {}
    if (!data.ceps) data.ceps = {}
    if (!data.reverses) data.reverses = {}
  } catch (err) {
    logger.warn({ err }, "geo-query-log: failed to load from disk — starting fresh")
    data = { searches: {}, ceps: {}, reverses: {} }
  }
}

/** Flush pending in-memory changes to disk (atomic write). */
function flushToDisk(): void {
  if (!dirty) return
  try {
    ensureDir()
    const tmpPath = `${LOG_PATH}.tmp.${process.pid}`
    writeFileSync(tmpPath, JSON.stringify(data), "utf-8")
    renameSync(tmpPath, LOG_PATH)
    dirty = false
    pendingChanges = 0
  } catch (err) {
    logger.error({ err }, "geo-query-log: failed to persist to disk")
  }
}

// Load existing data on module initialization
loadFromDisk()

// ── Graceful shutdown: flush pending writes on SIGINT/SIGTERM ─────────────
// Ensures the most recent query counts are persisted before the process exits.

function setupShutdownHandlers(): void {
  const handler = () => {
    flushToDisk()
  }
  process.on("SIGINT", handler)
  process.on("SIGTERM", handler)
  // Note: handlers are never removed because this module lives for the
  // entire process lifetime — listeners would only be a leak concern if
  // the module were dynamically loaded/unloaded, which it never is.
}

setupShutdownHandlers()

// ---------------------------------------------------------------------------
// Debounce scheduler
// ---------------------------------------------------------------------------

function scheduleFlush(): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    flushToDisk()
    debounceTimer = null
  }, DEBOUNCE_MS)
  // Allow Node.js to exit without waiting for the timer
  if (typeof debounceTimer?.unref === "function") {
    debounceTimer.unref()
  }
}

function markDirty(): void {
  dirty = true
  pendingChanges++
  if (pendingChanges >= MAX_PENDING_CHANGES) {
    if (debounceTimer) clearTimeout(debounceTimer)
    flushToDisk()
    debounceTimer = null
  } else {
    scheduleFlush()
  }
}

// ---------------------------------------------------------------------------
// Record helpers
// ---------------------------------------------------------------------------

/**
 * Record a search query occurrence.
 * Normalizes the query (trim, lowercase, collapse spaces) before storing.
 */
export function recordSearch(query: string): void {
  if (!query?.trim()) return
  const key = query.trim().toLowerCase().replace(/\s+/g, " ")
  const entry = data.searches[key]
  if (entry) {
    entry.count++
    entry.lastAccessed = Date.now()
  } else {
    data.searches[key] = { count: 1, lastAccessed: Date.now() }
  }
  markDirty()
}

/**
 * Record a CEP lookup occurrence.
 * Cleans the CEP (strip non-digits) before storing.
 */
export function recordCEP(cep: string): void {
  const key = cep.replace(/\D/g, "")
  if (!key || key.length !== 8) return
  const entry = data.ceps[key]
  if (entry) {
    entry.count++
    entry.lastAccessed = Date.now()
  } else {
    data.ceps[key] = { count: 1, lastAccessed: Date.now() }
  }
  markDirty()
}

/**
 * Record a reverse geocode occurrence.
 * Uses the same coordinate format as the cache key: "lat,lng" with 4 decimal places.
 */
export function recordReverse(lat: number, lng: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`
  const entry = data.reverses[key]
  if (entry) {
    entry.count++
    entry.lastAccessed = Date.now()
  } else {
    data.reverses[key] = { count: 1, lastAccessed: Date.now() }
  }
  markDirty()
}

// ---------------------------------------------------------------------------
// Query helpers (for warming)
// ---------------------------------------------------------------------------

/**
 * Get the top N search queries by frequency.
 * Returns entries sorted by count descending.
 */
export function getTopSearches(n: number): Array<{ query: string; count: number }> {
  return Object.entries(data.searches)
    .map(([query, entry]) => ({ query, count: entry.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

/**
 * Get the top N CEPs by frequency.
 * Returns entries sorted by count descending.
 */
export function getTopCEPs(n: number): Array<{ cep: string; count: number }> {
  return Object.entries(data.ceps)
    .map(([cep, entry]) => ({ cep, count: entry.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

/**
 * Get the top N reverse geocode coordinates by frequency.
 * Returns entries sorted by count descending.
 */
export function getTopReverses(n: number): Array<{ coords: string; count: number }> {
  return Object.entries(data.reverses)
    .map(([coords, entry]) => ({ coords, count: entry.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
}

// ---------------------------------------------------------------------------
// Diagnostics & admin
// ---------------------------------------------------------------------------

export type QueryLogDiagnostics = {
  totalSearches: number
  totalCEPs: number
  totalReverses: number
  uniqueSearches: number
  uniqueCEPs: number
  uniqueReverses: number
  pendingChanges: number
  logPath: string
}

/**
 * Get diagnostics info about the query log.
 */
export function getQueryLogDiagnostics(): QueryLogDiagnostics {
  const searches = Object.values(data.searches)
  const ceps = Object.values(data.ceps)
  const reverses = Object.values(data.reverses)

  return {
    totalSearches: searches.reduce((s, e) => s + e.count, 0),
    totalCEPs: ceps.reduce((s, e) => s + e.count, 0),
    totalReverses: reverses.reduce((s, e) => s + e.count, 0),
    uniqueSearches: searches.length,
    uniqueCEPs: ceps.length,
    uniqueReverses: reverses.length,
    pendingChanges,
    logPath: LOG_PATH,
  }
}

/**
 * Force-flush pending changes to disk immediately.
 * Useful before graceful shutdown.
 */
export function flushQueryLog(): void {
  flushToDisk()
}

/**
 * Reset the query log (clear in-memory + disk).
 * Useful for testing or admin reset.
 */
export function resetQueryLog(): void {
  data = { searches: {}, ceps: {}, reverses: {} }
  dirty = true
  flushToDisk()
}
