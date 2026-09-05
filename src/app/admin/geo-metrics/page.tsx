"use client"

import dynamic from "next/dynamic"

const AdminGeoMetricsDashboard = dynamic(
  () =>
    import("@/components/admin/admin-geo-metrics-dashboard").then((m) => ({
      default: m.AdminGeoMetricsDashboard,
    })),
  { ssr: false },
)

export default function AdminGeoMetricsPage() {
  return <AdminGeoMetricsDashboard />
}
