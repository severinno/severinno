/**
 * offline-reports-queue.ts
 *
 * Resilient offline queue for field inspection reports and photos.
 * Uses native IndexedDB (with fallback to localStorage/in-memory) to handle
 * large photo payloads and technical inspection checklists when providers
 * operate in basements, underground garages, or rural areas without mobile signal.
 */

export interface OfflineReportData {
  bookingId: string
  serviceTitle: string
  clientName?: string
  beforePhotos: string[]
  afterPhotos: string[]
  completionNote: string
  checklist: Array<{
    id: string
    label: string
    checked: boolean
    required?: boolean
  }>
}

export interface OfflineReportRecord extends OfflineReportData {
  id: string
  createdAt: number
  status: "PENDING" | "SYNCING" | "COMPLETED" | "FAILED"
  attempts: number
  lastError?: string
}

const DB_NAME = "severinno_offline_reports_v1"
const DB_VERSION = 1
const STORE_NAME = "pending_reports"
const FALLBACK_KEY = "severinno_offline_reports_fallback_v1"

// In-memory cache for SSR and immediate retrieval
let memoryFallback: OfflineReportRecord[] = []

/**
 * Open the native IndexedDB instance
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      return reject(new Error("IndexedDB unavailable"))
    }

    const req = window.indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" })
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Enqueue a report locally when offline or network fails
 */
export async function enqueueOfflineReport(data: OfflineReportData): Promise<OfflineReportRecord> {
  const record: OfflineReportRecord = {
    ...data,
    id: `report-${Date.now()}-${data.bookingId}`,
    createdAt: Date.now(),
    status: "PENDING",
    attempts: 0,
  }

  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const store = tx.objectStore(STORE_NAME)
      const putReq = store.put(record)
      putReq.onsuccess = () => resolve()
      putReq.onerror = () => reject(putReq.error)
    })
  } catch {
    // Fallback to localStorage / memory
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        const existing = JSON.parse(localStorage.getItem(FALLBACK_KEY) || "[]")
        existing.push(record)
        localStorage.setItem(FALLBACK_KEY, JSON.stringify(existing))
      } catch {
        memoryFallback.push(record)
      }
    } else {
      memoryFallback.push(record)
    }
  }

  return record
}

/**
 * Get all pending reports waiting for synchronization
 */
export async function getPendingOfflineReports(): Promise<OfflineReportRecord[]> {
  try {
    const db = await openDB()
    return await new Promise<OfflineReportRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly")
      const store = tx.objectStore(STORE_NAME)
      const getAllReq = store.getAll()
      getAllReq.onsuccess = () => {
        const records = (getAllReq.result as OfflineReportRecord[]) || []
        resolve(records.filter((r) => r.status === "PENDING" || r.status === "FAILED"))
      }
      getAllReq.onerror = () => reject(getAllReq.error)
    })
  } catch {
    // Fallback to localStorage / memory
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        const stored = JSON.parse(
          localStorage.getItem(FALLBACK_KEY) || "[]",
        ) as OfflineReportRecord[]
        return stored.filter((r) => r.status === "PENDING" || r.status === "FAILED")
      } catch {
        return memoryFallback.filter((r) => r.status === "PENDING" || r.status === "FAILED")
      }
    }
    return memoryFallback.filter((r) => r.status === "PENDING" || r.status === "FAILED")
  }
}

/**
 * Remove a successfully synchronized report
 */
export async function removeOfflineReport(id: string): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const store = tx.objectStore(STORE_NAME)
      const req = store.delete(id)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        const stored = JSON.parse(
          localStorage.getItem(FALLBACK_KEY) || "[]",
        ) as OfflineReportRecord[]
        const filtered = stored.filter((r) => r.id !== id)
        localStorage.setItem(FALLBACK_KEY, JSON.stringify(filtered))
      } catch {
        // no-op
      }
    }
    memoryFallback = memoryFallback.filter((r) => r.id !== id)
  }
}

/**
 * Count total pending reports
 */
export async function getPendingOfflineReportsCount(): Promise<number> {
  const pending = await getPendingOfflineReports()
  return pending.length
}

/**
 * Sincroniza todos os laudos pendentes com o servidor backend
 */
export async function syncOfflineReports(): Promise<{ synced: number; failed: number }> {
  if (typeof window !== "undefined" && typeof navigator !== "undefined" && !navigator.onLine) {
    return { synced: 0, failed: 0 }
  }

  const pending = await getPendingOfflineReports()
  if (pending.length === 0) return { synced: 0, failed: 0 }

  let synced = 0
  let failed = 0

  for (const report of pending) {
    report.status = "SYNCING"
    report.attempts += 1

    try {
      const res = await fetch(`/api/bookings/${report.bookingId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "after",
          photos: report.afterPhotos,
          completionNote: report.completionNote,
          checklist: report.checklist,
        }),
      })

      if (res.ok) {
        await removeOfflineReport(report.id)
        synced += 1
      } else {
        report.status = "FAILED"
        report.lastError = `HTTP ${res.status}`
        failed += 1
      }
    } catch (err) {
      report.status = "FAILED"
      report.lastError = err instanceof Error ? err.message : "Network error"
      failed += 1
    }
  }

  return { synced, failed }
}

/**
 * Setup auto-sync listeners when back online
 */
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    syncOfflineReports().catch(() => {})
  })
}
