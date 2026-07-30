/**
 * geo.ts — barrel export for geo-related types
 *
 * Centralises all commonly-used geo type definitions so consumers can import
 * from a single path instead of reaching into individual modules.
 *
 * Usage:
 *   import type {
 *     GeoServiceName,
 *     GeoMetricsSnapshot,
 *     SnapshotsSummaryResponse,
 *     PerformanceCheckResult,
 *   } from "@/types/geo"
 *
 * Convention:
 *   — All exports are `export type { … }` (isolatedModules-safe).
 *   — When a module both exports types and has side effects (e.g. geo-metrics.ts
 *     hydrates history on import), import only the type, never the module itself
 *     through this barrel.
 *   — Avoid importing this barrel from within `src/lib/` to prevent circular deps.
 */

// ── Metrics ──────────────────────────────────────────────────────────────
export type { GeoServiceName, GeoServiceMetrics, GeoMetricsSnapshot } from "@/lib/geo-metrics"
// ⚠️  SERVICE_LABELS is intentionally NOT re-exported here.
//     geo-metrics.ts has `import "server-only"` at module top, plus an async
//     IIFE that hydrates history on import. A value export would bundle the
//     full module on the client and crash. Import from @/lib/geo-metrics
//     directly when you need the display labels.

// ── Persistence ──────────────────────────────────────────────────────────
export type { PersistedSnapshot } from "@/lib/geo-metrics-persist"

// ── Performance alert ────────────────────────────────────────────────────
export type { BaselineSource, PerformanceCheckResult } from "@/lib/geo-performance-alert"

// ── Health alert ─────────────────────────────────────────────────────────
export type { GeoHealthAlertResult, GeoHealthInput } from "@/lib/geo-health-alert"

// ── Benchmark model ──────────────────────────────────────────────────────
export type {
  SelectivityPoint,
  CrossoverPoint,
  MeasuredPoint,
  P95Stats,
  HistorySnapshot,
  CostAtSelectivity,
} from "@/lib/geo-benchmark-model"

// ── Cache warming ────────────────────────────────────────────────────────
export type { WarmResult } from "@/lib/geo-cache-warm"

// ── Query log ────────────────────────────────────────────────────────────
export type { QueryLogCategory, QueryLogDiagnostics } from "@/lib/geo-query-log"

// ── Alert notification ───────────────────────────────────────────────────
export type { AlertSeverity, GeoAlertPayload } from "@/lib/geo-alert-notify"

// ── Auto-baseline ────────────────────────────────────────────────────────
export type { ServiceBaseline } from "@/lib/geo-auto-baseline"

// ── Startup warming ──────────────────────────────────────────────────────
export type { StartupWarmResult } from "@/lib/geo-startup-warm"

// ── Dashboard API response types ─────────────────────────────────────────
export type {
  SnapshotsSummaryResponse,
  ServiceAggregate,
  TimeBucket,
} from "@/app/api/admin/geo-snapshots-summary/route"
