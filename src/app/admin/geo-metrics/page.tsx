"use client"

import dynamic from "next/dynamic"
import { Providers } from "@/components/providers"

const AdminGeoMetricsDashboard = dynamic(
  () => import("@/components/admin/admin-geo-metrics-dashboard"),
  { ssr: false },
)

export default function AdminGeoMetricsPage() {
  return (
    <Providers>
      <AdminGeoMetricsDashboard />
    </Providers>
  )
}
