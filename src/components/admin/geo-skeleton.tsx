"use client"

/**
 * GeoSkeleton — loading placeholder for the Geo Metrics Dashboard
 *
 * Extracted from admin-geo-metrics-dashboard.tsx for reusability.
 * Matches the layout of the real dashboard: header, 4 KPI cards, 2 charts.
 */

import { Skeleton } from "@/components/ui/skeleton"

// ── Component ────────────────────────────────────────────────────────────

export function GeoSkeleton() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="mb-2 h-6 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  )
}
