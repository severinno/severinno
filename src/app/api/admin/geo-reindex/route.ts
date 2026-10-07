export const dynamic = "force-dynamic"

/**
 * POST /api/admin/geo-reindex
 *
 * Executes REINDEX INDEX on PostGIS spatial indexes (idx_user_location_gist,
 * idx_booking_location_gist, idx_quoterequest_location_gist) to rebuild
 * GiST indexes when degradation is detected.
 *
 * Admin-only. Each index is reindexed individually with timing so the
 * dashboard can report progress and duration.
 *
 * Response shape:
 * ```json
 * {
 *   "success": true,
 *   "indexes": [
 *     { "name": "idx_user_location_gist", "durationMs": 1234, "ok": true },
 *     { "name": "idx_booking_location_gist", "durationMs": 567, "ok": true },
 *     { "name": "idx_quoterequest_location_gist", "durationMs": 321, "ok": true }
 *   ],
 *   "totalDurationMs": 2122,
 *   "message": "3/3 índices reindexados com sucesso."
 * }
 * ```
 *
 * On error:
 * ```json
 * {
 *   "error": "Falha ao reindexar: <index_name>: <error message>",
 *   "completedIndexes": [ ... ],
 *   "failedIndex": "<index_name>",
 * }
 * ```
 */

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"

import { db } from "@/lib/db"
import logger from "@/lib/logger"

import { withRoute } from "@/lib/api-route"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReindexResult {
  name: string
  durationMs: number
  ok: boolean
}

export interface GeoReindexResponse {
  success: boolean
  indexes: ReindexResult[]
  totalDurationMs: number
  message: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPATIAL_INDEXES = [
  "idx_user_location_gist",
  "idx_booking_location_gist",
  "idx_quoterequest_location_gist",
] as const

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const POST = withRoute("api.admin.geo-reindex.POST", async (_request) => {
  await requireRole("ADMIN")

  const completedIndexes: ReindexResult[] = []
  let failedIndex: string | null = null

  const startTotal = performance.now()

  for (const indexName of SPATIAL_INDEXES) {
    if (failedIndex) break // stop on first failure

    const idxStart = performance.now()
    try {
      // Use CONCURRENTLY to avoid locking the table during reindex.
      // REINDEX INDEX CONCURRENTLY requires PostgreSQL 12+.
      await db.$executeRawUnsafe(`REINDEX INDEX CONCURRENTLY IF EXISTS "${indexName}"`)
      const durationMs = Math.round(performance.now() - idxStart)
      completedIndexes.push({ name: indexName, durationMs, ok: true })
      logger.info({ indexName, durationMs }, "REINDEX completed")
    } catch (err) {
      const durationMs = Math.round(performance.now() - idxStart)
      const message = err instanceof Error ? err.message : String(err)
      completedIndexes.push({ name: indexName, durationMs, ok: false })
      failedIndex = indexName

      logger.error({ indexName, durationMs, err }, "REINDEX failed")

      return NextResponse.json(
        {
          error: `Falha ao reindexar: ${indexName}: ${message}`,
          completedIndexes,
          failedIndex: indexName,
        },
        { status: 500 },
      )
    }
  }

  const totalDurationMs = Math.round(performance.now() - startTotal)

  const successCount = completedIndexes.filter((i) => i.ok).length
  const totalCount = completedIndexes.length

  const response: GeoReindexResponse = {
    success: failedIndex == null,
    indexes: completedIndexes,
    totalDurationMs,
    message: `${successCount}/${totalCount} índices reindexados com sucesso.`,
  }

  return NextResponse.json(response)
})
