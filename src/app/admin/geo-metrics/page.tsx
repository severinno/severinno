"use client"

import dynamic from "next/dynamic"

const AdminGeoMetricsDashboard = dynamic(
  () => import("@/components/admin/admin-geo-metrics-dashboard"),
  { ssr: false },
)

export default function AdminGeoMetricsPage() {
  return <AdminGeoMetricsDashboard />
}
