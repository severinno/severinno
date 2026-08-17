/**
 * Barrel export — Admin Components
 *
 * Centralizes imports from src/components/admin/ so consumers can use:
 *
 *   import { MetricCard, DashboardHeader, Finance, GeoMetricsDashboard } from "@/components/admin"
 *
 * instead of individual deep imports.
 *
 * Two kinds of exports:
 *
 *  1. Shared/reusable components (MetricCard, DashboardHeader, …) — re-exported
 *     from ./_shared (see that file for the internal acyclic design).
 *  2. Full dashboard pages (AdminFinanceDashboard, AdminGeoMetricsDashboard,
 *     …) — exported under a PascalCase NAMESPACE derived from the file name
 *     (e.g. `Finance`, `GeoMetricsDashboard`) to avoid name collisions and
 *     confusion between pages that export similarly-named components:
 *
 *       import { Finance, GeoMetricsDashboard } from "@/components/admin"
 *       <Finance.AdminFinanceDashboard />
 *       <GeoMetricsDashboard.AdminGeoMetricsDashboard />
 *
 * WHY pages import `./_shared` and not this barrel: importing this barrel
 * evaluates ALL 28 pages (ESM `export * as NS` is eager), which would (a)
 * create a barrel ↔ page import cycle and (b) make any page import transitively
 * load every page — breaking vitest tests that mock lucide-react with a
 * partial icon surface. Keeping pages on ./_shared keeps the graph acyclic:
 *
 *   consumer ─▶ index.ts ─▶ pages ─▶ ./_shared ─▶ leaf files
 */

// ── Shared components (internal barrel — see _shared.ts) ─────────────────
export * from "./_shared"

// ── Full dashboard pages (namespaces) ──────────────────────────────────
// Canonical page list from admin-panel.tsx. Namespaced to avoid collisions
// with the shared components above and between pages themselves.
export * as Dashboard from "./admin-dashboard"
export * as Taxonomy from "./admin-taxonomy"
export * as Users from "./admin-users"
export * as Providers from "./admin-providers"
export * as Services from "./admin-services"
export * as Bookings from "./admin-bookings"
export * as Finance from "./admin-finance"
export * as Settlements from "./admin-settlements"
export * as Settings from "./admin-settings"
export * as Errors from "./admin-errors"
export * as Health from "./admin-health"
export * as Performance from "./admin-performance"
export * as Push from "./admin-push"
export * as PushRecurring from "./admin-push-recurring"
export * as PushHistory from "./admin-push-history"
export * as PushMetrics from "./admin-push-metrics"
export * as ProjectStatus from "./admin-project-status"
export * as PushAudit from "./admin-push-audit"
export * as WebhookAudit from "./admin-webhook-audit"
export * as RevokeInactive from "./admin-revoke-inactive"
export * as ActiveSessions from "./admin-active-sessions"
export * as GatewayDashboard from "./admin-gateway-dashboard"
export * as PgBouncer from "./admin-pgbouncer"
export * as GeoMetricsDashboard from "./admin-geo-metrics-dashboard"
export * as CoverageMap from "./admin-coverage-map"
export * as BenchmarkDashboard from "./admin-benchmark-dashboard"
export * as BenchmarkEvolution from "./admin-benchmark-evolution"
export * as GeoCacheDashboard from "./admin-geo-cache-dashboard"
export * as RedisDiagnostics from "./admin-redis-diagnostics"
export * as GeoRateLimitStatus from "./admin-geo-rate-limit-status"
