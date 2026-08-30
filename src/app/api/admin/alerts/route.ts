import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { cacheGet, cacheSet } from "@/lib/redis"

const ALERTS_KEY = "admin:alerts:history"
const MAX_ALERTS = 100
const TTL_SECONDS = 86400

export interface AlertHistoryEntry {
  severity: string
  title: string
  message: string
  metric: string
  timestamp: string
}

export async function GET() {
  await requireRole("ADMIN")
  const alerts = await cacheGet<AlertHistoryEntry[]>(ALERTS_KEY)
  return NextResponse.json({ alerts: alerts ?? [] })
}

export async function recordAlert(entry: AlertHistoryEntry): Promise<void> {
  const existing = (await cacheGet<AlertHistoryEntry[]>(ALERTS_KEY)) ?? []
  existing.unshift(entry)
  if (existing.length > MAX_ALERTS) existing.length = MAX_ALERTS
  await cacheSet(ALERTS_KEY, existing, TTL_SECONDS)
}
