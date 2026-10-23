export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { withRoute } from "@/lib/api-route"
import { getDatabaseHealthReport } from "@/lib/db-health-sentinel"

/**
 * GET /api/admin/system/db-health
 *
 * Retorna telemetria e diagnóstico do PostgreSQL:
 * - Tuplas mortas e risco de bloat por tabela
 * - Histórico de autovacuum e autoanalyze
 * - Buffer cache hit ratio
 * - Saturação de conexões ativas
 * - Recomendações acionáveis de manutenção
 *
 * Requer permissão ADMIN.
 */
export const GET = withRoute("api.admin.system.db-health.GET", async (_request) => {
  await requireRole("ADMIN")

  const report = await getDatabaseHealthReport()

  return NextResponse.json(report)
})
