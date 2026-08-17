/**
 * _shared.ts — INTERNAL shared-components barrel (no pages)
 *
 * Re-exports the reusable admin components that dashboard PAGES depend on.
 * Pages import from this file (`./_shared`) instead of the public barrel
 * (`@/components/admin`) so the barrel can safely re-export the pages too:
 *
 *   index.ts ──▶ pages ──▶ _shared.ts ──▶ leaf files
 *
 * The graph stays acyclic: the consumer-facing barrel (index.ts) re-exports
 * `./_shared` + page namespaces, and pages only ever import shared components
 * from `./_shared`. Importing a page therefore never transitively loads the
 * other pages (which would also break vitest lucide-mock coverage).
 *
 * Do NOT import pages here. Do NOT import this file from index.ts's page
 * namespaces — that would recreate the cycle.
 */

// ── Metric & KPI cards ──────────────────────────────────────────────────
export { MetricCard, KpiCard } from "./admin-metric-card"
export type { MetricCardProps, KpiCardProps } from "./admin-metric-card"
export { default as OnlineUsersKpiCard } from "./admin-online-users-card"
export type { OnlineUsersSessionsResponse } from "./admin-online-users-card"
export { default as SessionConflictAlert } from "./admin-session-conflict-alert"
export type { SessionConflictAlertData } from "./admin-session-conflict-alert"
export { default as SessionLimitsCard } from "./admin-session-limits-card"
export type { SessionLimitsInfo } from "./admin-session-limits-card"

// ── Dashboard layout ────────────────────────────────────────────────────
export { DashboardHeader } from "./admin-dashboard-header"
export type { DashboardHeaderProps } from "./admin-dashboard-header"
export { RefreshButton } from "./admin-refresh-button"
export type { RefreshButtonProps } from "./admin-refresh-button"

// ── Status / alerts ─────────────────────────────────────────────────────
export { TierBanner } from "./admin-tier-banner"
export type { TierBannerProps, TierBannerState } from "./admin-tier-banner"

// ── Shared design system (admin-shared) ─────────────────────────────────
export {
  // Helpers
  initials,
  errMsg,
  slugify,
  // Status system
  StatusBadge,
  bookingTone,
  bookingIcon,
  quoteTone,
  paymentTone,
  paymentIcon,
  RoleBadge,
  ActiveBadge,
  VerifiedBadge,
  BookingStatusBadge,
  PaymentStatusBadge,
  // Layout & state
  PageSectionHeader,
  FilterBar,
  SearchInput,
  TableSkeleton,
  EmptyState,
  ErrorState,
  Pagination,
  ResultCount,
  // Geo filter
  DEFAULT_GEO_FILTER,
  AdminGeoFilter,
  // Feedback & dialogs
  SavingPill,
  ConfirmDialog,
  ConfirmToggleDialog,
  Kbd,
  FreshnessLabel,
} from "./admin-shared"
export type { StatusTone, GeoFilterState } from "./admin-shared"

// ── Geo: metrics + charts ──────────────────────────────────────────────
export { BenchmarkSection } from "./benchmark-section"
export type { BenchmarkSectionProps } from "./benchmark-section"
export { TimelineSection } from "./timeline-section"
export type { TimelineSectionProps } from "./timeline-section"
export { LatencyBar, latencyColor, formatMs } from "./geo-latency-bar"
export type { LatencyBarProps } from "./geo-latency-bar"
export { GeoSkeleton } from "./geo-skeleton"

// ── GiST index ─────────────────────────────────────────────────────────
export { GiSTSelectivitySection } from "./gist-selectivity-section"
export type { GiSTSelectivitySectionProps } from "./gist-selectivity-section"
export { GistDegradationPanel } from "./gist-degradation-panel"
export type { GistDegradationPanelProps } from "./gist-degradation-panel"
export { GistReindexButton } from "./gist-reindex-button"
export type { GistReindexButtonProps } from "./gist-reindex-button"
export { RadiusDensitySelector } from "./radius-density-selector"
export type { RadiusDensitySelectorProps } from "./radius-density-selector"
export { IndicadorDeAtualizacao } from "./indicador-de-atualizacao"
export type { IndicadorDeAtualizacaoProps, IndicadorStatus } from "./indicador-de-atualizacao"
