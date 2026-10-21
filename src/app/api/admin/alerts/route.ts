export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { withRoute } from "@/lib/api-route"
import { requireRole } from "@/lib/auth"
import { cacheGet } from "@/lib/redis"

const ALERTS_KEY = "admin:alerts:history"

export interface AlertHistoryEntry {
  severity: string
  title: string
  message: string
  metric: string
  timestamp: string
}

export const GET = withRoute("api.admin.alerts.GET", async () => {
  await requireRole("ADMIN")
  const alerts = await cacheGet<AlertHistoryEntry[]>(ALERTS_KEY)
  return NextResponse.json({ alerts: alerts ?? [] })
})
