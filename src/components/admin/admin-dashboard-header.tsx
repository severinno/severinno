"use client"

/**
 * DashboardHeader — Reusable header for admin dashboard pages
 *
 * Extracted from 5 duplicated header implementations across admin dashboards.
 * Renders:
 *   - Title + description (left)
 *   - Optional prefix content (Redis badge, days selector, etc.)
 *   - Timestamp ("Atualizado HH:MM:SS")
 *   - Refresh button with animate-spin
 *   - IndicadorDeAtualizacao ("Atualizando…" spinner)
 *
 * Usage:
 *   import { DashboardHeader } from "@/components/admin/admin-dashboard-header"
 *
 *   <DashboardHeader
 *     title="Métricas de Geolocalização"
 *     description="P50/P95/P99 dos serviços de geocoding"
 *     isFetching={isFetching}
 *     onRefresh={() => void refetch()}
 *     dataUpdatedAt={dataUpdatedAt}
 *   />
 *
 *   // With extra content (e.g. Redis badge, days selector):
 *   <DashboardHeader
 *     title="Cache Geo"
 *     description="Hit/miss ratio"
 *     isFetching={isFetching}
 *     onRefresh={() => void refetch()}
 *     dataUpdatedAt={dataUpdatedAt}
 *     refreshLabel="Atualizar diagnóstico"
 *     prefixContent={<RedisStatusBadge status={cacheStats.redisAvailable} />}
 *   />
 */

import * as React from "react"
import { RefreshButton } from "@/components/admin/admin-refresh-button"
import { TierBanner, type TierBannerProps } from "@/components/admin/admin-tier-banner"

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DashboardHeaderProps {
  /** Page title (h1). */
  title: string
  /** Subtitle/description below the title. */
  description: string
  /** Whether the page is currently refetching data. */
  isFetching: boolean
  /** Callback when the refresh button is clicked. */
  onRefresh: () => void
  /** Timestamp of the last successful data fetch (optional — hides timestamp if omitted). */
  dataUpdatedAt?: number
  /** aria-label for the refresh button (default: "Atualizar"). Passed through to RefreshButton. */
  refreshLabel?: string
  /** Optional extra elements rendered before the timestamp in the right section. */
  prefixContent?: React.ReactNode
  /** Optional extra elements rendered after the refresh button (e.g. reset buttons). */
  suffixContent?: React.ReactNode
  /** Optional tier degradation banner shown below the header row. */
  tierBanner?: TierBannerProps
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DashboardHeader({
  title,
  description,
  isFetching,
  onRefresh,
  dataUpdatedAt,
  refreshLabel = "Atualizar",
  prefixContent,
  suffixContent,
  tierBanner,
}: DashboardHeaderProps) {
  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-foreground text-xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>
        </div>
        <div className="flex items-center gap-3">
          {prefixContent}

          {dataUpdatedAt ? (
            <span className="text-muted-foreground text-xs">
              Atualizado {new Date(dataUpdatedAt).toLocaleTimeString("pt-BR")}
            </span>
          ) : null}

          <RefreshButton isFetching={isFetching} onRefresh={onRefresh} label={refreshLabel} />

          {suffixContent}
        </div>
      </div>

      {tierBanner ? (
        <TierBanner
          state={tierBanner.state}
          title={tierBanner.title}
          description={tierBanner.description}
          degradationCount={tierBanner.degradationCount}
          className={tierBanner.className}
        />
      ) : null}
    </>
  )
}
