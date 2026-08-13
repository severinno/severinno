/**
 * admin-barrel-smoke.test.tsx
 *
 * Barrel-integrity smoke test for src/components/admin/index.ts.
 *
 * Importing the barrel evaluates ALL 28 dashboard-page namespaces eagerly
 * (ESM `export * as NS`), which is the exact scenario that can crash with
 * TDZ/circular-import issues if the acyclic design (`./_shared`) is broken.
 *
 * Lives under src/lib (NOT src/components) so it runs in the UNIT config
 * (vitest.config.unit.ts), which has no global vitrine lucide-react mock —
 * i.e. a realistic environment where all real icons resolve, same as the app.
 *
 * Assertions:
 *  - Every one of the 28 namespaces exposes its main page component.
 *  - The shared components are still exported (no regression).
 */
import { describe, it, expect, vi } from "vitest"

// ── Default-config hardening ──────────────────────────────────────────────
// This file matches BOTH vitest configs. The DEFAULT config (vitest.config.ts)
// registers the vitrine setup file (src/components/vitrine/__tests__/vitest
// .setup.tsx) which globally mocks lucide-react (6 icons) and @/lib/api (5
// fetch helpers) — too small for the barrel's 28 pages (e.g. Wrench from
// admin-taxonomy). Pass-through overrides restore the real modules so the
// barrel import works there too. Harmless under the unit config (no-op).
vi.mock("lucide-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("lucide-react")>()),
}))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
}))

import * as Admin from "@/components/admin"

describe("admin barrel — page namespaces", () => {
  it("exposes all 28 dashboard-page namespaces with their main component", () => {
    const namespaces: Record<string, string> = {
      Dashboard: "AdminDashboard",
      Taxonomy: "AdminTaxonomy",
      Users: "AdminUsers",
      Providers: "AdminProviders",
      Services: "AdminServices",
      Bookings: "AdminBookings",
      Finance: "AdminFinanceDashboard",
      Settlements: "AdminSettlements",
      Settings: "AdminSettings",
      Errors: "AdminErrorTrends",
      Health: "AdminHealthDashboard",
      Performance: "AdminPerformanceDashboard",
      Push: "AdminPushNotifications",
      PushRecurring: "AdminPushRecurring",
      PushHistory: "AdminPushHistory",
      PushMetrics: "AdminPushMetrics",
      ProjectStatus: "AdminProjectStatus",
      PushAudit: "AdminPushAudit",
      WebhookAudit: "AdminWebhookAudit",
      GatewayDashboard: "AdminGatewayDashboard",
      PgBouncer: "AdminPgBouncer",
      GeoMetricsDashboard: "AdminGeoMetricsDashboard",
      CoverageMap: "AdminCoverageMap",
      BenchmarkDashboard: "AdminBenchmarkDashboard",
      BenchmarkEvolution: "AdminBenchmarkEvolution",
      GeoCacheDashboard: "AdminGeoCacheDashboard",
      RedisDiagnostics: "AdminRedisDiagnosticsDashboard",
      GeoRateLimitStatus: "AdminGeoRateLimitStatus",
    }

    const barrel = Admin as unknown as Record<string, Record<string, unknown>>

    for (const [ns, mainExport] of Object.entries(namespaces)) {
      const mod = barrel[ns]
      expect(mod, `namespace ${ns} missing`).toBeDefined()
      expect(
        typeof mod?.[mainExport],
        `${ns}.${mainExport} should be a component function`,
      ).toBe("function")
    }
  })

  it("still exposes the shared components (no regression)", () => {
    expect(Admin.MetricCard).toBeDefined()
    expect(Admin.DashboardHeader).toBeDefined()
    expect(Admin.BenchmarkSection).toBeDefined()
    expect(Admin.GiSTSelectivitySection).toBeDefined()
    expect(Admin.RefreshButton).toBeDefined()
    expect(Admin.KpiCard).toBeDefined()
  })
})
