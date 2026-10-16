"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

// Lazy-loaded admin sub-views — each is a separate chunk that loads on demand.
// This cuts the initial bundle from ~1MB to ~200KB by deferring recharts, maplibre, etc.
const AdminDashboard = dynamic(
  () => import("./admin-dashboard").then((m) => ({ default: m.AdminDashboard })),
  { ssr: false },
)
const AdminTaxonomy = dynamic(
  () => import("./admin-taxonomy").then((m) => ({ default: m.AdminTaxonomy })),
  { ssr: false },
)
const AdminUsers = dynamic(() => import("./admin-users").then((m) => ({ default: m.AdminUsers })), {
  ssr: false,
})
const AdminProviders = dynamic(
  () => import("./admin-providers").then((m) => ({ default: m.AdminProviders })),
  { ssr: false },
)
const AdminServices = dynamic(
  () => import("./admin-services").then((m) => ({ default: m.AdminServices })),
  { ssr: false },
)
const AdminBookings = dynamic(
  () => import("./admin-bookings").then((m) => ({ default: m.AdminBookings })),
  { ssr: false },
)
const AdminFinanceDashboard = dynamic(
  () => import("./admin-finance").then((m) => ({ default: m.AdminFinanceDashboard })),
  { ssr: false },
)
const AdminSettlements = dynamic(
  () => import("./admin-settlements").then((m) => ({ default: m.AdminSettlements })),
  { ssr: false },
)
const AdminSettings = dynamic(
  () => import("./admin-settings").then((m) => ({ default: m.AdminSettings })),
  { ssr: false },
)
const AdminMaintenance = dynamic(
  () => import("./admin-maintenance").then((m) => ({ default: m.AdminMaintenance })),
  { ssr: false },
)
const AdminErrorTrends = dynamic(
  () => import("./admin-errors").then((m) => ({ default: m.AdminErrorTrends })),
  { ssr: false },
)
const AdminHealthDashboard = dynamic(
  () => import("./admin-health").then((m) => ({ default: m.AdminHealthDashboard })),
  { ssr: false },
)
const AdminPerformanceDashboard = dynamic(
  () => import("./admin-performance").then((m) => ({ default: m.AdminPerformanceDashboard })),
  { ssr: false },
)
const AdminPushNotifications = dynamic(
  () => import("./admin-push").then((m) => ({ default: m.AdminPushNotifications })),
  { ssr: false },
)
const AdminPushRecurring = dynamic(
  () => import("./admin-push-recurring").then((m) => ({ default: m.AdminPushRecurring })),
  { ssr: false },
)
const AdminPushHistory = dynamic(
  () => import("./admin-push-history").then((m) => ({ default: m.AdminPushHistory })),
  { ssr: false },
)
const AdminPushMetrics = dynamic(
  () => import("./admin-push-metrics").then((m) => ({ default: m.AdminPushMetrics })),
  { ssr: false },
)
const AdminProjectStatus = dynamic(
  () => import("./admin-project-status").then((m) => ({ default: m.AdminProjectStatus })),
  { ssr: false },
)
const AdminPushAudit = dynamic(
  () => import("./admin-push-audit").then((m) => ({ default: m.AdminPushAudit })),
  { ssr: false },
)
const AdminWebhookAudit = dynamic(
  () => import("./admin-webhook-audit").then((m) => ({ default: m.AdminWebhookAudit })),
  { ssr: false },
)
const AdminGatewayDashboard = dynamic(
  () => import("./admin-gateway-dashboard").then((m) => ({ default: m.AdminGatewayDashboard })),
  { ssr: false },
)
const AdminPgBouncer = dynamic(
  () => import("./admin-pgbouncer").then((m) => ({ default: m.AdminPgBouncer })),
  { ssr: false },
)
const AdminGeoMetricsDashboard = dynamic(
  () =>
    import("./admin-geo-metrics-dashboard").then((m) => ({ default: m.AdminGeoMetricsDashboard })),
  { ssr: false },
)
const AdminCoverageMap = dynamic(
  () => import("./admin-coverage-map").then((m) => ({ default: m.AdminCoverageMap })),
  { ssr: false },
)
const AdminOperationsMap = dynamic(
  () => import("./admin-operations-map").then((m) => ({ default: m.AdminOperationsMap })),
  { ssr: false },
)
const AdminBenchmarkDashboard = dynamic(
  () => import("./admin-benchmark-dashboard").then((m) => ({ default: m.AdminBenchmarkDashboard })),
  { ssr: false },
)
const AdminBenchmarkEvolution = dynamic(
  () => import("./admin-benchmark-evolution").then((m) => ({ default: m.AdminBenchmarkEvolution })),
  { ssr: false },
)
const AdminGeoCacheDashboard = dynamic(
  () => import("./admin-geo-cache-dashboard").then((m) => ({ default: m.AdminGeoCacheDashboard })),
  { ssr: false },
)
const AdminRedisDiagnosticsDashboard = dynamic(
  () =>
    import("./admin-redis-diagnostics").then((m) => ({
      default: m.AdminRedisDiagnosticsDashboard,
    })),
  { ssr: false },
)
const AdminGeoRateLimitStatus = dynamic(
  () =>
    import("./admin-geo-rate-limit-status").then((m) => ({ default: m.AdminGeoRateLimitStatus })),
  { ssr: false },
)
const GeoDebugDashboard = dynamic(
  () => import("./geo-debug-dashboard").then((m) => ({ default: m.GeoDebugDashboard })),
  { ssr: false },
)
const AdminAnalyticsDashboard = dynamic(
  () =>
    import("./admin-analytics-dashboard").then((m) => ({
      default: m.AdminAnalyticsDashboard,
    })),
  { ssr: false },
)
const AdminDemandHeatmap = dynamic(
  () => import("./admin-demand-heatmap").then((m) => ({ default: m.AdminDemandHeatmap })),
  { ssr: false },
)
const AdminIdentityReview = dynamic(
  () => import("./admin-identity-review").then((m) => ({ default: m.AdminIdentityReview })),
  { ssr: false },
)
const AdminWhatsApp = dynamic(
  () => import("./admin-whatsapp").then((m) => ({ default: m.AdminWhatsApp })),
  { ssr: false },
)
const AdminDisputes = dynamic(
  () => import("./admin-disputes").then((m) => ({ default: m.AdminDisputes })),
  { ssr: false },
)
const AdminCommissions = dynamic(
  () => import("./admin-commissions").then((m) => ({ default: m.AdminCommissions })),
  { ssr: false },
)
const AdminGTMFunnel = dynamic(
  () => import("./admin-gtm-funnel").then((m) => ({ default: m.AdminGTMFunnel })),
  { ssr: false },
)

// ---------------------------------------------------------------------------
// Admin Skeleton Loading — fallback para React.Suspense
// ---------------------------------------------------------------------------
export function AdminSkeleton() {
  return (
    <div className="space-y-6 p-6">
      {/* Stats cards skeleton */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="mb-2 h-4 w-24" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="mt-2 h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart area skeleton */}
      <Card>
        <CardContent className="p-6">
          <Skeleton className="mb-4 h-5 w-40" />
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>

      {/* Table skeleton */}
      <Card>
        <CardContent className="p-6">
          <Skeleton className="mb-4 h-5 w-32" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// View Router
// ---------------------------------------------------------------------------
export function AdminView({
  view,
  onNavigate,
}: {
  view: string
  onNavigate: (view: string) => void
}) {
  switch (view) {
    case "admin.dashboard":
      return <AdminDashboard onNavigate={onNavigate} />
    case "admin.operations":
      return <AdminOperationsMap />
    case "admin.taxonomy":
      return <AdminTaxonomy />
    case "admin.users":
      return <AdminUsers />
    case "admin.providers":
      return <AdminProviders />
    case "admin.verifications":
      return <AdminIdentityReview />
    case "admin.analytics":
      return <AdminAnalyticsDashboard />
    case "admin.demand":
      return <AdminDemandHeatmap />
    case "admin.services":
      return <AdminServices />
    case "admin.finance":
      return <AdminFinanceDashboard />
    case "admin.commissions":
      return <AdminCommissions />
    case "admin.settlements":
      return <AdminSettlements />
    case "admin.disputes":
      return <AdminDisputes />
    case "admin.bookings":
      return <AdminBookings />
    case "admin.gtm-leads":
      return <AdminGTMFunnel />
    case "admin.whatsapp":
      return <AdminWhatsApp />
    case "admin.push":
      return <AdminPushNotifications />
    case "admin.push-recurring":
      return <AdminPushRecurring />
    case "admin.push-metrics":
      return <AdminPushMetrics />
    case "admin.push-history":
      return <AdminPushHistory />
    case "admin.push-audit":
      return <AdminPushAudit />
    case "admin.webhook-audit":
      return <AdminWebhookAudit />
    case "admin.project-status":
      return <AdminProjectStatus />
    case "admin.gateway":
      return <AdminGatewayDashboard />
    case "admin.coverage":
      return <AdminCoverageMap />
    case "admin.redis-diagnostics":
      return <AdminRedisDiagnosticsDashboard />
    case "admin.geo-rate-limit-status":
      return <AdminGeoRateLimitStatus />
    case "admin.geo-cache":
      return <AdminGeoCacheDashboard />
    case "admin.geo-metrics":
      return <AdminGeoMetricsDashboard />
    case "admin.geo-debug":
      return <GeoDebugDashboard />
    case "admin.benchmarks":
      return <AdminBenchmarkDashboard />
    case "admin.benchmark-evolution":
      return <AdminBenchmarkEvolution />
    case "admin.performance":
      return <AdminPerformanceDashboard />
    case "admin.pgbouncer":
      return <AdminPgBouncer />
    case "admin.errors":
      return <AdminErrorTrends />
    case "admin.health":
      return <AdminHealthDashboard />
    case "admin.settings":
      return <AdminSettings />
    case "admin.maintenance":
      return <AdminMaintenance />
    default:
      return <AdminDashboard onNavigate={onNavigate} />
  }
}
