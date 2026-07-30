"use client"

/**
 * TierBanner — Reusable degradation/critical tier banner for admin dashboards
 *
 * Displays a prominent banner when a service or cache tier is operating in a
 * degraded or critical state (e.g., Redis fell back to standalone or in-memory).
 *
 * Extracted from AdminRedisDiagnosticsDashboard.
 *
 * Usage:
 *   <TierBanner state="degraded" title="Modo degradado" description="..." />
 *   <TierBanner state="critical" title="Cache apenas em memória" description="..." degradationCount={3} />
 */

import * as React from "react"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TierBannerState = "degraded" | "critical"

export interface TierBannerProps {
  /** Visual severity: "degraded" (amber) or "critical" (red). */
  state: TierBannerState
  /** Short bold label shown first (e.g. "⚠️ Modo degradado"). */
  title: React.ReactNode
  /** Longer description shown after the title. */
  description: React.ReactNode
  /** Optional count of how many degradations occurred (appended to description). */
  degradationCount?: number
  /** Additional classes for the root element. */
  className?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TierBanner({
  state,
  title,
  description,
  degradationCount,
  className,
}: TierBannerProps) {
  return (
    <div
      className={cn(
        "rounded-xl border px-5 py-3 text-xs",
        state === "degraded"
          ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/30 dark:bg-amber-950/20 dark:text-amber-300"
          : "border-red-200 bg-red-50 text-red-800 dark:border-red-800/30 dark:bg-red-950/20 dark:text-red-300",
        className,
      )}
    >
      <span className="font-semibold">{title}</span>
      <span className="ml-2">
        {description}
        {degradationCount != null && degradationCount > 0 && (
          <span className="ml-1">
            ({degradationCount} degradação{degradationCount !== 1 ? "ões" : ""} desde o início).
          </span>
        )}
      </span>
    </div>
  )
}

export default TierBanner
