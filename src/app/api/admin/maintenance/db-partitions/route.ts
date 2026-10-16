export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import {
  MONITORED_HOT_TABLES,
  generateRollingPartitionsPlan,
  generateRetentionPruneSql,
  type MonitoredHotTable,
} from "@/lib/db-partition-manager"

function isAuthorized(request: NextRequest, sessionUserRole?: string): boolean {
  if (sessionUserRole === "ADMIN") return true

  const adminKey = request.headers.get("x-admin-key")
  const cronSecret = request.headers.get("x-cron-secret")
  const validSecret = process.env.CRON_SECRET || process.env.ADMIN_SECRET_KEY

  if (validSecret && (adminKey === validSecret || cronSecret === validSecret)) {
    return true
  }

  return false
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!isAuthorized(request, session?.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const plansByTable = MONITORED_HOT_TABLES.map((tableName) => {
    const plans = generateRollingPartitionsPlan(tableName, 3)
    const retention = generateRetentionPruneSql(tableName, 90)
    return {
      tableName,
      partitionsUpcoming: plans,
      retentionPolicy: {
        recommendedRetentionDays: 90,
        cutoffDate: retention.cutoffDate,
        pruneSql: retention.sql,
      },
    }
  })

  return NextResponse.json({
    status: "ok",
    monitoredTables: MONITORED_HOT_TABLES,
    maintenancePlans: plansByTable,
    generatedAt: new Date().toISOString(),
  })
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!isAuthorized(request, session?.role)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { tableName = "WhatsAppMessageLog", monthsAhead = 3, retentionDays = 90 } = body

    if (!MONITORED_HOT_TABLES.includes(tableName as MonitoredHotTable)) {
      return NextResponse.json(
        {
          error: `Tabela '${tableName}' não é suportada. Tabelas permitidas: ${MONITORED_HOT_TABLES.join(", ")}`,
        },
        { status: 400 },
      )
    }

    const partitionPlans = generateRollingPartitionsPlan(tableName, Number(monthsAhead))
    const retentionPrune = generateRetentionPruneSql(tableName, Number(retentionDays))

    return NextResponse.json({
      success: true,
      tableName,
      partitionPlans,
      retentionPrune,
      generatedDdl: partitionPlans.map((p) => p.ddl),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro interno no particionamento de tabelas"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
