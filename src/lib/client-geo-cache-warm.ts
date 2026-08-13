/**
 * client-geo-cache-warm.ts
 *
 * Cache warming for client-side geo and CEP caches.
 *
 * During low-activity hours (3-5 AM local time), scans the most-frequently
 * accessed cache entries and renews their `cachedAt` timestamp so they
 * don't expire during peak hours (morning commute, lunch break, etc.).
 *
 * How it works:
 *   1. `warmGeoCache()` — reads the FIFO queue, renews the top N entries
 *      (those most recently used). For the geo cache (1h TTL), this extends
 *      their life into the morning peak.
 *   2. `warmCepCache()` — scans all CEP entries and renews those close to
 *      their 7-day TTL expiry. Less critical than geo, but still useful.
 *   3. `attemptCacheWarming()` — checks if we're in the warming window
 *      (3-5 AM) and runs both warmers. Idempotent: tracks last warm time
 *      in localStorage so it only runs once per day.
 *
 * Integration:
 *   Called from the existing periodic sweep (setInterval in address-autocomplete)
 *   and from the page visibility change handler. Both already exist in the
 *   component that uses the caches, so we just add a `warm()` call alongside
 *   the existing `sweep()`.
 *
 * The warming window is deliberately conservative (3-5 AM) to avoid running
 * during any reasonable user activity period. Running during the sweep is
 * safe because the sweep fires every 10 minutes — the warming check is a
 * lightweight localStorage read.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Warming window: 3:00 AM – 5:00 AM local time (hour inclusive start, exclusive end). */
const WARM_START_HOUR = 3
const WARM_END_HOUR = 5

/** Max entries to renew per warming cycle — avoids thundering herd on localStorage. */
const MAX_WARM_ENTRIES = 20

/** localStorage key for last warm timestamp (prevents re-warming within same day). */
const LAST_WARM_KEY = "severinno:cache:warm:lastRun"

/** Min interval between warming cycles (23 hours — once daily). */
const WARM_COOLDOWN_MS = 23 * 60 * 60 * 1000

/** Geo cache: renew entries whose remaining TTL is less than this threshold. */
const GEO_WARM_THRESHOLD_MS = 15 * 60 * 1000 // 15 min remaining

/** CEP cache: renew entries whose remaining TTL is less than this threshold. */
const CEP_WARM_THRESHOLD_MS = 12 * 60 * 60 * 1000 // 12h remaining

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** Check if the current local hour is within the warming window (3-5 AM). */
function isWithinWarmingWindow(): boolean {
  try {
    const hour = new Date().getHours()
    return hour >= WARM_START_HOUR && hour < WARM_END_HOUR
  } catch {
    return false
  }
}

/** Check if enough time has passed since the last warm cycle. */
function isCooldownElapsed(): boolean {
  try {
    const raw = localStorage.getItem(LAST_WARM_KEY)
    if (!raw) return true
    const lastRun = Number(raw)
    if (!Number.isFinite(lastRun)) return true
    return Date.now() - lastRun >= WARM_COOLDOWN_MS
  } catch {
    return true
  }
}

/** Mark the warm cycle as completed for today. */
function markWarmCompleted(): void {
  try {
    localStorage.setItem(LAST_WARM_KEY, String(Date.now()))
  } catch {
    // localStorage unavailable — silently fail
  }
}

// ---------------------------------------------------------------------------
// Geo cache warming
// ---------------------------------------------------------------------------

/** localStorage prefix and queue key (must match client-geo-cache.ts). */
const GEO_STORAGE_PREFIX = "severinno:geo:"
const GEO_QUEUE_KEY = "severinno:geo:queue"
const GEO_TTL_MS = 60 * 60 * 1000

type GeoCacheEntry = {
  query: string
  results: unknown[]
  cachedAt: number
}

/**
 * Read the FIFO queue from localStorage.
 * Replicates the private helper from client-geo-cache.ts.
 */
function readGeoQueue(): string[] {
  try {
    const raw = localStorage.getItem(GEO_QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Write the FIFO queue to localStorage.
 */
function writeGeoQueue(queue: string[]): void {
  try {
    localStorage.setItem(GEO_QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // silently fail
  }
}

/**
 * Renew (touch) a specific geo cache entry by updating its `cachedAt`
 * timestamp to now, extending its life by one full TTL.
 */
function renewGeoEntry(query: string): boolean {
  try {
    const raw = localStorage.getItem(`${GEO_STORAGE_PREFIX}${query}`)
    if (!raw) return false

    const entry = JSON.parse(raw) as GeoCacheEntry
    if (!entry.results || !entry.cachedAt) return false

    // Only renew if the entry is still fresh but close to expiry
    const remainingTtl = entry.cachedAt + GEO_TTL_MS - Date.now()
    if (remainingTtl > GEO_WARM_THRESHOLD_MS) return false // still plenty of life
    if (remainingTtl <= 0) {
      // Already expired — remove it instead
      localStorage.removeItem(`${GEO_STORAGE_PREFIX}${query}`)
      return false
    }

    // Renew: update cachedAt
    entry.cachedAt = Date.now()
    localStorage.setItem(`${GEO_STORAGE_PREFIX}${query}`, JSON.stringify(entry))
    return true
  } catch {
    return false
  }
}

/**
 * Warm the geo cache: scan the FIFO queue and renew entries that are
 * within GEO_WARM_THRESHOLD_MS of expiry.
 *
 * Renews up to MAX_WARM_ENTRIES per cycle. Entries are processed from
 * most-recently-used (end of queue) to oldest (start of queue).
 */
export function warmGeoCache(): number {
  const queue = readGeoQueue()
  if (queue.length === 0) return 0

  let renewed = 0
  const updated: string[] = []

  // Process from newest (end) to oldest (start) — LRU-first
  for (let i = queue.length - 1; i >= 0 && renewed < MAX_WARM_ENTRIES; i--) {
    const q = queue[i]!
    if (renewGeoEntry(q)) {
      renewed++
      updated.push(q)
    }
  }

  // Move renewed entries to the front of the queue (most-recently-used)
  if (updated.length > 0) {
    const remaining = queue.filter((q) => !updated.includes(q))
    writeGeoQueue([...updated, ...remaining])
  }

  return renewed
}

// ---------------------------------------------------------------------------
// CEP cache warming
// ---------------------------------------------------------------------------

/** localStorage prefix (must match client-cep-cache.ts). */
const CEP_STORAGE_PREFIX = "severinno:cep:"
const CEP_TTL_MS = 7 * 24 * 60 * 60 * 1000

type CepCacheEntry = {
  data: unknown
  cachedAt: number
}

/**
 * Renew (touch) a specific CEP cache entry.
 */
function renewCepEntry(cep: string): boolean {
  try {
    const raw = localStorage.getItem(`${CEP_STORAGE_PREFIX}${cep}`)
    if (!raw) return false

    const entry = JSON.parse(raw) as CepCacheEntry
    if (!entry.data || !entry.cachedAt) return false

    // Only renew if the entry is close to its 7-day expiry
    const remainingTtl = entry.cachedAt + CEP_TTL_MS - Date.now()
    if (remainingTtl > CEP_WARM_THRESHOLD_MS) return false
    if (remainingTtl <= 0) {
      localStorage.removeItem(`${CEP_STORAGE_PREFIX}${cep}`)
      return false
    }

    entry.cachedAt = Date.now()
    localStorage.setItem(`${CEP_STORAGE_PREFIX}${cep}`, JSON.stringify(entry))
    return true
  } catch {
    return false
  }
}

/**
 * Warm the CEP cache: scan all localStorage entries with the CEP prefix
 * and renew those within CEP_WARM_THRESHOLD_MS of expiry.
 *
 * Renews up to MAX_WARM_ENTRIES per cycle.
 */
export function warmCepCache(): number {
  let renewed = 0

  try {
    const cepsToWarm: string[] = []

    for (let i = 0; i < localStorage.length && cepsToWarm.length < MAX_WARM_ENTRIES; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(CEP_STORAGE_PREFIX)) continue

      const cep = key.slice(CEP_STORAGE_PREFIX.length)
      if (!cep) continue

      try {
        const raw = localStorage.getItem(key)
        if (!raw) continue

        const entry = JSON.parse(raw) as CepCacheEntry
        if (!entry.data || !entry.cachedAt) continue

        const remainingTtl = entry.cachedAt + CEP_TTL_MS - Date.now()
        if (remainingTtl <= 0 || remainingTtl > CEP_WARM_THRESHOLD_MS) continue

        cepsToWarm.push(cep)
      } catch {
        // skip corrupt entries
      }
    }

    for (const cep of cepsToWarm) {
      if (renewCepEntry(cep)) renewed++
    }
  } catch {
    // localStorage unavailable
  }

  return renewed
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Attempt to warm both caches. Only runs if:
 *   1. We're within the warming window (3-5 AM local time)
 *   2. We haven't warmed in the last 23 hours (once daily)
 *
 * Safe to call frequently (e.g. every 10 min sweep) — the checks are
 * lightweight localStorage reads. Returns a summary of what was done.
 */
export function attemptCacheWarming(): {
  withinWindow: boolean
  cooldownElapsed: boolean
  geoRenewed: number
  cepRenewed: number
  skipped: boolean
} {
  const withinWindow = isWithinWarmingWindow()
  const cooldownElapsed = isCooldownElapsed()

  if (!withinWindow || !cooldownElapsed) {
    return {
      withinWindow,
      cooldownElapsed,
      geoRenewed: 0,
      cepRenewed: 0,
      skipped: true,
    }
  }

  const geoRenewed = warmGeoCache()
  const cepRenewed = warmCepCache()

  markWarmCompleted()

  return {
    withinWindow: true,
    cooldownElapsed: true,
    geoRenewed,
    cepRenewed,
    skipped: false,
  }
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * Get the current warming config and state for debugging.
 */
export function getWarmingDiagnostics(): {
  currentHour: number
  withinWindow: boolean
  cooldownElapsed: boolean
  lastWarmTimestamp: number | null
  warmStartHour: number
  warmEndHour: number
  maxWarmEntries: number
} {
  let lastWarmTimestamp: number | null = null
  try {
    const raw = localStorage.getItem(LAST_WARM_KEY)
    if (raw) lastWarmTimestamp = Number(raw)
  } catch {
    // ignore
  }

  return {
    currentHour: new Date().getHours(),
    withinWindow: isWithinWarmingWindow(),
    cooldownElapsed: isCooldownElapsed(),
    lastWarmTimestamp,
    warmStartHour: WARM_START_HOUR,
    warmEndHour: WARM_END_HOUR,
    maxWarmEntries: MAX_WARM_ENTRIES,
  }
}
